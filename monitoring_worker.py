import random
import time
from datetime import datetime, timedelta

from batch_processor import create_driver, force_cleanup
from config import supabase
from scraper_engine import process_full_match

# Maçın bitmiş sayılabilmesi için maç başlangıcından geçmesi gereken minimum süre
MIN_MATCH_DURATION = timedelta(hours=3)


def _parse_match_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt_value = value
    elif isinstance(value, str):
        try:
            dt_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt_value = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None
    else:
        return None

    if dt_value.tzinfo:
        return dt_value.astimezone().replace(tzinfo=None)
    return dt_value


def _is_match_finished(match_row: dict) -> bool:
    now = datetime.now()
    match_date = _parse_match_date(match_row.get("match_date"))
    if match_date and match_date > now:
        return False

    status = str(match_row.get("status") or "").strip().upper()
    if status == "MS":
        return True

    # FT skoru varsa VE maç başlangıcından en az 3 saat geçtiyse bitmiş say
    # Bu sayede canlı maçlar yanlışlıkla SUCCESS olarak işaretlenmez
    score_ft = match_row.get("score_ft")
    if score_ft and match_date and (now - match_date) >= MIN_MATCH_DURATION:
        return True

    return False


def run_monitoring_worker() -> None:
    print("Monitoring worker started...")

    now = datetime.now()
    time_window = timedelta(hours=24)

    # SUCCESS dışındaki tüm maçları çek
    response = (
        supabase.table("match_queue")
        .select("match_code, match_url, status")
        .neq("status", "SUCCESS")
        .execute()
    )
    all_pending = response.data or []

    if not all_pending:
        print("No pending matches to process.")
        return

    # match_code listesi ile matches tablosundan match_date bilgisini al
    match_codes = [item["match_code"] for item in all_pending if item.get("match_code")]
    
    if not match_codes:
        print("No valid match codes found.")
        return

    # Supabase'den maç tarihlerini çek
    matches_response = (
        supabase.table("matches")
        .select("match_code, match_date")
        .in_("match_code", match_codes)
        .execute()
    )
    matches_data = {m["match_code"]: m.get("match_date") for m in (matches_response.data or [])}

    # ±12 saat içindeki maçları filtrele
    queue = []
    for item in all_pending:
        match_code = item.get("match_code")
        match_date_raw = matches_data.get(match_code)
        match_date = _parse_match_date(match_date_raw)
        
        if match_date:
            time_diff = abs(now - match_date)
            if time_diff <= time_window:
                queue.append(item)
        # match_date yoksa queue'ya ekleme

    if not queue:
        print(f"No matches within ±24 hours window. Total pending: {len(all_pending)}")
        return
    
    print(f"Found {len(queue)} matches within ±24 hours (out of {len(all_pending)} pending)")

    processed = 0
    success_count = 0
    still_monitoring_count = 0
    error_count = 0

    force_cleanup()
    driver = create_driver()

    for item in queue:
        match_code = item.get("match_code")
        if not match_code:
            continue
        match_url = item.get("match_url") or (
            f"https://arsiv.mackolik.com/Match/Default.aspx?id={match_code}"
        )

        try:
            process_full_match(match_url, driver)

            match_res = (
                supabase.table("matches")
                .select("match_date, score_ft, status")
                .eq("match_code", match_code)
                .limit(1)
                .execute()
            )
            match_row = (match_res.data or [None])[0]

            if match_row and _is_match_finished(match_row):
                new_status = "SUCCESS"
                success_count += 1
            else:
                new_status = "MONITORING"
                still_monitoring_count += 1

            supabase.table("match_queue").update(
                {
                    "status": new_status,
                    "error_log": None,
                    "last_try_at": "now()",
                }
            ).eq("match_code", match_code).execute()
        except Exception as exc:
            error_count += 1
            supabase.table("match_queue").update(
                {
                    "status": "ERROR",
                    "error_log": str(exc),
                    "last_try_at": "now()",
                }
            ).eq("match_code", match_code).execute()
            try:
                driver.quit()
            except Exception:
                pass
            driver = create_driver()

        processed += 1
        time.sleep(random.uniform(0.5, 1.5))

    try:
        driver.quit()
    except Exception:
        pass

    print(
        "Monitoring summary: "
        f"processed={processed} success={success_count} "
        f"monitoring={still_monitoring_count} error={error_count}"
    )


if __name__ == "__main__":
    run_monitoring_worker()
