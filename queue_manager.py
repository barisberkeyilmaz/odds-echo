import time
from config import supabase
from link_harvester import fetch_season_matches

def fill_queue_from_db(mode="history"):
    """
    mode='history': Sadece bitmiş (MS) maçları alır.
    mode='fixtures': Sadece oynanmamış (MS ve Ert hariç) maçları alır.
    """
    print(f"📡 Veritabanından aktif sezonlar çekiliyor... (Mod: {mode.upper()})")
    
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
            # Filtreleme Mantığı
            is_finished = (m['status'] == 'MS')
            is_valid_fixture = (m['status'] != 'MS' and m['status'] != 'Ert')
            
            should_add = False
            if mode == 'history' and is_finished: should_add = True
            elif mode == 'fixtures' and is_valid_fixture: should_add = True
            
            if should_add:
                # Fikstür maçları sürekli takip edilmeli (MONITORING)
                # Geçmiş maçlar bir kere taranır (PENDING)
                status = "MONITORING" if mode == "fixtures" else "PENDING"
                
                queue_data.append({
                    "match_code": m['id'],
                    "match_url": f"https://arsiv.mackolik.com/Match/Default.aspx?id={m['id']}",
                    "season_id": s['mackolik_id'],
                    "season_name": season_name,
                    "week": m['week'],
                    "status": status
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