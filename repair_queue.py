from config import supabase
import time

def repair_queue_status():
    print("🚑 Kuyruk Onarım Modülü Başlatılıyor (Matches -> Queue Sync)...")
    
    # Kullanıcının talebi: "matches içini kontrol edecek tüm maçları gezecek"
    # Strateji: Matches tablosunu parça parça oku, validasyon yap, Queue tablosunu güncelle.
    
    page_size = 1000
    offset = 0
    total_synced = 0
    
    # Matches tablosundaki toplam kayıt sayısı
    try:
        count_res = supabase.table("matches").select("*", count="exact", head=True).execute()
        total_matches = count_res.count
        print(f"📊 Matches tablosunda toplam {total_matches} kayıt var.")
    except Exception as e:
        print(f"❌ Sayaç hatası: {e}")
        return

    while offset < total_matches:
        print(f"   🔄 Batch işleniyor: {offset} - {offset + page_size} arası...")
        
        try:
            # Matches'dan verileri çek
            response = supabase.table("matches").select("*").range(offset, offset + page_size - 1).execute()
            rows = response.data
            
            if not rows:
                break
            
            updates_success = []
            updates_bad_data = []
            
            for m in rows:
                # Validasyon (Scraper mantığı)
                is_valid = True
                missing_fields = []
                
                if not m.get('home_team'): missing_fields.append('home')
                if not m.get('away_team'): missing_fields.append('away')
                if not m.get('league'): missing_fields.append('league')
                if not m.get('season'): missing_fields.append('season')
                if not m.get('score_ft'): missing_fields.append('score_ft')
                if not m.get('score_ht'): missing_fields.append('score_ht')
                
                # Sadece bitmiş maçlar (skoru olanlar) SUCCESS olabilir.
                # Eğer matches içinde skoru olmayan (fikstür) varsa, bu SUCCESS değildir.
                # Ancak kullanıcı "tüm maçları gezecek" dedi. Fikstürler MONITORING olmalı.
                
                # Ancak matches tablosu artık hem geçmiş hem fikstür barındırıyor.
                # O yüzden statüyü belirlerken tarihe ve skora bakmalıyız.
                
                status_to_set = "PENDING" # Default
                
                has_score = bool(m.get('score_ft') and m.get('score_ht'))
                
                if missing_fields:
                    # Eksik saha varsa BAD_DATA
                    status_to_set = "BAD_DATA"
                elif has_score:
                    # Skoru tam ise SUCCESS
                    status_to_set = "SUCCESS"
                else:
                    # Skoru yoksa ama matches tablosundaysa MONITORING (Fikstür)
                    status_to_set = "MONITORING"
                
                # Queue'yu güncellemek için listeye ekle
                # Upsert kullanamayız çünkü queue'daki diğer fieldları ezmek istemeyiz (url, week vs?)
                # Ama repair sadece status düzeltiyorsa update yeterli.
                # Ama update için queue'da kaydın olması lazım. Repair queue olmayan bir kaydı yaratmalı mı?
                # Genelde fill-queue ile yaratılır. Biz sadece var olanı güncelleyelim.
                
                # Performans için tek tek update yapmak yerine batch update yapabiliriz ama
                # Supabase'de farklı ID'ler için farklı değerlerle batch update zordur.
                # Bu yüzden RPC veya tek tek update gerekir. Ortalama hız için gruplama yapabiliriz.
                
                if status_to_set == "SUCCESS":
                    updates_success.append(m['match_code'])
                elif status_to_set == "BAD_DATA":
                    updates_bad_data.append(m['match_code'])
                # MONITORING durumunu ellemiyoruz, çünkü scraper onu yönetiyor. 
                # Sadece kesin bitmişleri SUCCESS işaretleyelim.
            
            # Toplu Güncellemeler
            if updates_success:
                supabase.table("match_queue")\
                    .update({"status": "SUCCESS", "error_log": "Synced from matches (Valid)"})\
                    .in_("match_code", updates_success)\
                    .execute()
                print(f"      ✅ {len(updates_success)} maç -> SUCCESS")
                
            if updates_bad_data:
                supabase.table("match_queue")\
                    .update({"status": "BAD_DATA", "error_log": "Synced from matches (Invalid Data)"})\
                    .in_("match_code", updates_bad_data)\
                    .execute()
                print(f"      ⚠️ {len(updates_bad_data)} maç -> BAD_DATA")

            total_synced += len(rows)
            offset += len(rows)
            
        except Exception as e:
            print(f"      ❌ Hata: {e}")
            break
            
        time.sleep(0.5)

    print(f"\n🎉 Onarım Tamamlandı. Taranan Matches Kaydı: {total_synced}")

if __name__ == "__main__":
    repair_queue_status()
