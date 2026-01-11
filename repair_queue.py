from config import supabase
import time

def repair_queue_status():
    print("🚑 Kuyruk Onarım Modülü Başlatılıyor...")
    
    # 1. Matches tablosundaki tüm ID'leri çek (Pagination ile)
    # 16.000 veri olduğu için parça parça çekmek gerekebilir, ama şimdilik limitli çekelim
    # Daha iyi yol: match_queue'da STATUS='MONITORING' veya 'PENDING' olanları alıp,
    # "Bunlar matches'da var mı?" diye sormak.
    
    # Adım 1: Hatalı olabilecek kayıtları çek (MONITORING olarak işaretlenmiş ama aslında bitmiş olabilirler)
    print("📡 Kuyruktaki MONITORING/PENDING kayıtları analiz ediliyor...")
    
    page_size = 1000
    offset = 0
    total_fixed = 0
    
    while True:
        # PENDING, MONITORING ve BAD_DATA olanları kontrol et
        response = supabase.table("match_queue")\
            .select("match_code, status")\
            .in_("status", ["MONITORING", "PENDING", "BAD_DATA"])\
            .range(offset, offset + page_size - 1)\
            .execute()
            
        queue_items = response.data
        if not queue_items:
            break
            
        print(f"   🔍 {len(queue_items)} aday kayıt inceleniyor (Offset: {offset})...")
        
        # Bu ID'lerin hangileri MATCHES tablosunda var?
        match_codes = [q['match_code'] for q in queue_items]
        
        # Matches tablosunda bu kodları ara
        sub_batch_size = 100
        for i in range(0, len(match_codes), sub_batch_size):
            sub_batch_codes = match_codes[i : i + sub_batch_size]
            sub_batch_items = queue_items[i : i + sub_batch_size]
            
            # Matches tablosunda var mı? (Veri kalitesini kontrol etmek için tüm sütunları çek)
            res_matches = supabase.table("matches")\
                .select("*")\
                .in_("match_code", sub_batch_codes)\
                .execute()
                
            found_matches = res_matches.data
            
            valid_success_ids = []
            invalid_bad_data_ids = []
            
            for m in found_matches:
                # Veri Kalitesi Kontrolü (Scraper Engine mantığının aynısı)
                # Fikstür durumunu burada kontrol etmiyoruz çünkü 'matches' tablosunda sadece bitmiş maçlar olmalı.
                
                is_valid = True
                missing_fields = []
                
                if not m.get('home_team'): missing_fields.append('home')
                if not m.get('away_team'): missing_fields.append('away')
                if not m.get('league'): missing_fields.append('league')
                if not m.get('season'): missing_fields.append('season')
                if not m.get('score_ft'): missing_fields.append('score_ft')
                # score_ht opsiyonel/zorunlu durumu: Scraper'da zorunlu.
                if not m.get('score_ht'): missing_fields.append('score_ht')
                
                if missing_fields:
                    is_valid = False
                
                if is_valid:
                    valid_success_ids.append(m['match_code'])
                else:
                    invalid_bad_data_ids.append(m['match_code'])

            # 1. Verisi SAĞLAM olanları SUCCESS yap
            if valid_success_ids:
                supabase.table("match_queue")\
                    .update({"status": "SUCCESS", "error_log": "Repaired by script (Verified Valid Data)"})\
                    .in_("match_code", valid_success_ids)\
                    .execute()
                total_fixed += len(valid_success_ids)
                print(f"      ✅ {len(valid_success_ids)} kayıt doğrulanıp SUCCESS yapıldı.")
            
            # 2. Verisi BOZUK olanları BAD_DATA yap
            if invalid_bad_data_ids:
                supabase.table("match_queue")\
                    .update({"status": "BAD_DATA", "error_log": "Repaired by script (Found Invalid Data in matches)"})\
                    .in_("match_code", invalid_bad_data_ids)\
                    .execute()
                print(f"      ⚠️ {len(invalid_bad_data_ids)} kayıt matches tablosunda bulundu ama eksik veri içeriyor -> BAD_DATA.")
            
            # found_so_success listesi artık valid olanlar + invalid olanların toplamı (yani matches'da bulunanlar)
            found_match_codes = [m['match_code'] for m in found_matches]
            
            # 3. Matches'da yok ama BAD_DATA -> PENDING yap (Tekrar denensin)
            missing_in_matches = [item for item in sub_batch_items if item['match_code'] not in found_match_codes]
            
            # Bunlardan statüsü BAD_DATA olanları bul
            to_reset_pending = [item['match_code'] for item in missing_in_matches if item['status'] == 'BAD_DATA']
            
            if to_reset_pending:
                 supabase.table("match_queue")\
                    .update({"status": "PENDING", "error_log": "Reset from BAD_DATA by repair script"})\
                    .in_("match_code", to_reset_pending)\
                    .execute()
                 print(f"      🔄 {len(to_reset_pending)} BAD_DATA kayıt PENDING'e çevrildi.")

        offset += page_size
        time.sleep(0.5)

    print(f"\n🎉 Onarım Tamamlandı. Toplam Düzeltilen: {total_fixed}")

if __name__ == "__main__":
    repair_queue_status()
