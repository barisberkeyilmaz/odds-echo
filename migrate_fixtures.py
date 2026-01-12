import sys
from config import supabase

def migrate():
    print("📦 Migrasyon başlatılıyor: weekly_fixtures -> matches")
    
    # 1. Toplam sayıyı al
    try:
        count_res = supabase.table("weekly_fixtures").select("*", count="exact", head=True).execute()
        total_count = count_res.count
        print(f"🔍 Toplam {total_count} kayıt bulundu. Aktarım başlıyor...")
    except Exception as e:
        print(f"❌ Veri sayma hatası: {e}")
        return

    if total_count == 0:
        print("⚠️ Tablo boş.")
        return
        
    BATCH_SIZE = 1000
    processed = 0
    
    while processed < total_count:
        print(f"   � Batch işleniyor: {processed} - {processed + BATCH_SIZE} arası...")
        try:
            # Sayfalama ile çek
            response = supabase.table("weekly_fixtures").select("*").range(processed, processed + BATCH_SIZE - 1).execute()
            fixtures = response.data
            
            if not fixtures:
                break
                
            # Batch için hazırlık
            batch_to_upsert = []
            for item in fixtures:
                match_code = item.get("match_code")
                if not match_code: continue

                # "id" kolonunu çıkar
                data_to_move = item.copy()
                if "id" in data_to_move:
                    del data_to_move["id"]
                
                batch_to_upsert.append(data_to_move)
            
            # Toplu Upsert (ignore_duplicates=True ile çakışanları atlar)
            if batch_to_upsert:
                supabase.table("matches").upsert(batch_to_upsert, on_conflict="match_code", ignore_duplicates=True).execute()
            
            processed += len(fixtures)
            
        except Exception as e:
            print(f"      ❌ Batch Hatası: {e}")
            # Hata durumunda döngüden çıkmalı veya retry mantığı eklenmeli
            # Şimdilik devam edip bir sonraki batch'e geçmek riskli olabilir (sonsuz döngü), o yüzden çıkalım.
            break

    print(f"✅ İşlem tamamlandı. Toplam taranan: {processed}")

if __name__ == "__main__":
    migrate()
