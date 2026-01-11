import time
from config import supabase
from link_harvester import fetch_season_matches

def fill_queue_from_db():
    print("📡 Veritabanından aktif sezonlar çekiliyor...")
    
    # Aktif sezonları ve lig isimlerini çek
    response = supabase.table("seasons").select("*, leagues(name)").eq("is_active", True).execute()
    seasons = response.data
    
    if not seasons:
        print("⚠️ Aktif sezon bulunamadı.")
        return

    print(f"🚀 {len(seasons)} sezon için tarama başlıyor...\n")

    for s in seasons:
        season_name = f"{s['leagues']['name']} {s['season_year']}"
        print(f"🏆 İşleniyor: {season_name}")
        
        matches = fetch_season_matches(s['mackolik_id'], s['total_weeks'])
        
        # Toplu Kayıt Hazırlığı
        queue_data = []
        for m in matches:
            # Sadece MS (Maç Sonu) olanları alıyoruz (Geçmiş veri için)
            if m['status'] == 'MS':
                queue_data.append({
                    "match_code": m['id'],
                    "match_url": f"https://arsiv.mackolik.com/Match/Default.aspx?id={m['id']}",
                    "season_id": s['mackolik_id'],
                    "season_name": season_name,
                    "week": m['week'],
                    "status": "PENDING"
                })
        
        # Veritabanına Yaz (Chunking ile - Supabase limiti olabilir)
        if queue_data:
            batch_size = 100
            for i in range(0, len(queue_data), batch_size):
                batch = queue_data[i:i+batch_size]
                supabase.table("match_queue").upsert(batch, on_conflict="match_code", ignore_duplicates=True).execute()
            
            print(f"   ✅ {len(queue_data)} maç kuyruğa eklendi.\n")

if __name__ == "__main__":
    fill_queue_from_db()