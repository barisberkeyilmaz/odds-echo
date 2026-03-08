from config import supabase
from datetime import datetime, timedelta
import time

from utils import parse_match_date

MONITORING_STATUSES = {"PENDING", "BAD_DATA", "FAILED", "ERROR"}


def _chunk_list(items: list, size: int) -> list[list]:
    return [items[i : i + size] for i in range(0, len(items), size)]


def _format_timestamp(value: datetime) -> str:
    return value.isoformat(sep=" ", timespec="seconds")


def promote_future_matches_to_monitoring(days_ahead: int = 14) -> None:
    print("🧭 Future match promotion started...")

    if days_ahead < 0:
        print("⚠️ days_ahead must be >= 0")
        return

    now = datetime.now()
    end = now + timedelta(days=days_ahead)
    now_str = _format_timestamp(now)
    end_str = _format_timestamp(end)

    page_size = 1000
    offset = 0
    future_matches_found = 0
    inserted = 0
    updated_to_monitoring = 0
    skipped = 0
    example_inserted = []
    example_updated = []

    while True:
        response = (
            supabase.table("matches")
            .select("match_code, match_date")
            .gt("match_date", now_str)
            .lte("match_date", end_str)
            .not_.is_("match_code", "null")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        rows = response.data or []
        if not rows:
            break

        future_matches_found += len(rows)
        match_codes = [row.get("match_code") for row in rows if row.get("match_code")]
        if not match_codes:
            offset += len(rows)
            continue

        existing_status = {}
        for chunk in _chunk_list(match_codes, 200):
            qres = (
                supabase.table("match_queue")
                .select("match_code, status")
                .in_("match_code", chunk)
                .execute()
            )
            for item in qres.data or []:
                existing_status[item["match_code"]] = item.get("status")

        to_insert = []
        to_update = []
        for code in match_codes:
            status = existing_status.get(code)
            if status is None:
                to_insert.append(
                    {
                        "match_code": code,
                        "status": "MONITORING",
                        "match_url": f"https://arsiv.mackolik.com/Match/Default.aspx?id={code}",
                        "error_log": None,
                    }
                )
            elif status in ("BAD_DATA", "FAILED", "ERROR"):
                to_update.append(code)
            else:
                skipped += 1

        if to_insert:
            for chunk in _chunk_list(to_insert, 100):
                supabase.table("match_queue").upsert(
                    chunk, on_conflict="match_code", ignore_duplicates=True
                ).execute()
            inserted += len(to_insert)
            if len(example_inserted) < 5:
                example_inserted.extend([row["match_code"] for row in to_insert[:5]])

        if to_update:
            for chunk in _chunk_list(to_update, 200):
                supabase.table("match_queue").update(
                    {"status": "MONITORING", "error_log": None}
                ).in_("match_code", chunk).execute()
            updated_to_monitoring += len(to_update)
            if len(example_updated) < 5:
                example_updated.extend(to_update[:5])

        offset += len(rows)

    print(
        "✅ Promotion complete: "
        f"future_matches_found={future_matches_found} "
        f"inserted={inserted} updated_to_monitoring={updated_to_monitoring} "
        f"skipped={skipped}"
    )
    if example_inserted:
        print(f"   examples inserted: {', '.join(example_inserted[:5])}")
    if example_updated:
        print(f"   examples updated: {', '.join(example_updated[:5])}")

def repair_queue_status():
    print("🚑 Kuyruk Onarım Modülü Başlatılıyor (Matches -> Queue Sync)...")
    
    # Kullanıcının talebi: "matches içini kontrol edecek tüm maçları gezecek"
    # Strateji: Matches tablosunu parça parça oku, validasyon yap, Queue tablosunu güncelle.
    
    page_size = 1000
    offset = 0
    total_synced = 0
    unknown_date_count = 0
    unknown_date_examples = []
    grace_period = timedelta(hours=48)
    
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
            updates_monitoring = []
            
            for m in rows:
                # Validasyon (Scraper mantığı)
                missing_fields = []

                if not m.get('home_team'): missing_fields.append('home')
                if not m.get('away_team'): missing_fields.append('away')
                if not m.get('league'): missing_fields.append('league')
                if not m.get('season'): missing_fields.append('season')
                
                # Sadece bitmiş maçlar (skoru olanlar) SUCCESS olabilir.
                # Eğer matches içinde skoru olmayan (fikstür) varsa, bu SUCCESS değildir.
                # Ancak kullanıcı "tüm maçları gezecek" dedi. Fikstürler MONITORING olmalı.
                
                # Ancak matches tablosu artık hem geçmiş hem fikstür barındırıyor.
                # O yüzden statüyü belirlerken tarihe ve skora bakmalıyız.
                
                status_to_set = "PENDING" # Default

                match_code = m.get("match_code")
                match_date = parse_match_date(m.get("match_date"))
                has_score = bool(m.get('score_ft') and m.get('score_ht'))
                now = datetime.now()

                if match_date is None:
                    unknown_date_count += 1
                    if match_code and len(unknown_date_examples) < 5:
                        unknown_date_examples.append(match_code)
                    legacy_missing = list(missing_fields)
                    if not m.get('score_ft'): legacy_missing.append('score_ft')
                    if not m.get('score_ht'): legacy_missing.append('score_ht')
                    if legacy_missing:
                        status_to_set = "BAD_DATA"
                    elif has_score:
                        status_to_set = "SUCCESS"
                    else:
                        status_to_set = "MONITORING"
                else:
                    if has_score:
                        status_to_set = "SUCCESS"
                    elif match_date > now:
                        status_to_set = "MONITORING"
                    else:
                        if missing_fields:
                            status_to_set = "BAD_DATA"
                        else:
                            match_status = str(m.get("status") or "").strip().upper()
                            if match_status != "MS":
                                if match_date < now - grace_period:
                                    status_to_set = "BAD_DATA"
                                else:
                                    status_to_set = "MONITORING"
                            else:
                                status_to_set = "BAD_DATA"
                
                # Queue'yu güncellemek için listeye ekle
                # Upsert kullanamayız çünkü queue'daki diğer fieldları ezmek istemeyiz (url, week vs?)
                # Ama repair sadece status düzeltiyorsa update yeterli.
                # Ama update için queue'da kaydın olması lazım. Repair queue olmayan bir kaydı yaratmalı mı?
                # Genelde fill-queue ile yaratılır. Biz sadece var olanı güncelleyelim.
                
                # Performans için tek tek update yapmak yerine batch update yapabiliriz ama
                # Supabase'de farklı ID'ler için farklı değerlerle batch update zordur.
                # Bu yüzden RPC veya tek tek update gerekir. Ortalama hız için gruplama yapabiliriz.
                
                if not match_code:
                    continue
                if status_to_set == "SUCCESS":
                    updates_success.append(match_code)
                elif status_to_set == "BAD_DATA":
                    updates_bad_data.append(match_code)
                elif status_to_set == "MONITORING":
                    updates_monitoring.append(match_code)
            
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

            if updates_monitoring:
                for chunk in _chunk_list(updates_monitoring, 200):
                    supabase.table("match_queue")\
                        .update({"status": "MONITORING", "error_log": None})\
                        .in_("match_code", chunk)\
                        .in_("status", list(MONITORING_STATUSES))\
                        .execute()
                print(f"      🧭 {len(updates_monitoring)} maç -> MONITORING")

            total_synced += len(rows)
            offset += len(rows)
            
        except Exception as e:
            print(f"      ❌ Hata: {e}")
            break
            
        time.sleep(0.5)

    if unknown_date_count:
        print(
            f"⚠️ {unknown_date_count} matches missing match_date; legacy rules applied."
        )
        if unknown_date_examples:
            print(f"   examples: {', '.join(unknown_date_examples)}")
    print(f"\n🎉 Onarım Tamamlandı. Taranan Matches Kaydı: {total_synced}")

if __name__ == "__main__":
    repair_queue_status()
