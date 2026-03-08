import random
import time
from datetime import datetime, timedelta, timezone

from batch_processor import create_driver, force_cleanup
from config import supabase
from logging_config import setup_logging
from scraper_engine import process_full_match
from utils import is_match_finished, parse_match_date

logger = setup_logging("monitoring_worker")


def run_monitoring_worker(
    window_hours_before: int = 24,
    window_hours_after: int = 24,
    include_missing_dates: bool = True,
) -> None:
    mode = "normal" if include_missing_dates else "fast"
    logger.info(
        "Monitoring worker started (mode=%s, window=-%dh/+%dh)",
        mode, window_hours_before, window_hours_after,
    )

    now = datetime.now()
    window_start = now - timedelta(hours=window_hours_before)
    window_end = now + timedelta(hours=window_hours_after)

    # DB-side filtering: get match_codes within the date window first
    window_start_str = window_start.strftime("%Y-%m-%d %H:%M:%S")
    window_end_str = window_end.strftime("%Y-%m-%d %H:%M:%S")

    matches_in_window = (
        supabase.table("matches")
        .select("match_code")
        .gte("match_date", window_start_str)
        .lte("match_date", window_end_str)
        .execute()
    )
    window_match_codes = {
        m["match_code"] for m in (matches_in_window.data or []) if m.get("match_code")
    }

    if not window_match_codes and not include_missing_dates:
        logger.info("No matches within date window. Nothing to process.")
        return

    # Get non-SUCCESS, non-PERMANENT_ERROR queue items for those match_codes
    queue = []
    missing_date_count = 0

    if window_match_codes:
        # Supabase .in_() has a limit, chunk it
        code_list = list(window_match_codes)
        for i in range(0, len(code_list), 200):
            chunk = code_list[i : i + 200]
            response = (
                supabase.table("match_queue")
                .select("match_code, match_url, status, retry_count")
                .neq("status", "SUCCESS")
                .neq("status", "PERMANENT_ERROR")
                .in_("match_code", chunk)
                .execute()
            )
            queue.extend(response.data or [])

    if include_missing_dates:
        # Also include queue items whose match_code is NOT in matches table
        all_non_success = (
            supabase.table("match_queue")
            .select("match_code, match_url, status, retry_count")
            .neq("status", "SUCCESS")
            .neq("status", "PERMANENT_ERROR")
            .execute()
        )
        existing_codes = {item["match_code"] for item in queue}
        for item in (all_non_success.data or []):
            mc = item.get("match_code")
            if mc and mc not in existing_codes:
                # Check if this match_code has a record in matches
                if mc not in window_match_codes:
                    # Check if it exists in matches at all
                    check = (
                        supabase.table("matches")
                        .select("match_code")
                        .eq("match_code", mc)
                        .limit(1)
                        .execute()
                    )
                    if not (check.data or []):
                        missing_date_count += 1
                        queue.append(item)
                        existing_codes.add(mc)

    if not queue:
        logger.info(
            "No matches to process (window=-%dh/+%dh).",
            window_hours_before, window_hours_after,
        )
        return

    logger.info(
        "Found %d matches to process (missing_date=%d)",
        len(queue), missing_date_count,
    )

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
        retry_count = item.get("retry_count") or 0

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

            if match_row and is_match_finished(match_row):
                new_status = "SUCCESS"
                success_count += 1
            else:
                new_status = "MONITORING"
                still_monitoring_count += 1

            supabase.table("match_queue").update(
                {
                    "status": new_status,
                    "error_log": None,
                    "last_try_at": datetime.now(timezone.utc).isoformat(),
                }
            ).eq("match_code", match_code).execute()
        except Exception as exc:
            error_count += 1
            new_retry_count = retry_count + 1
            new_status = "PERMANENT_ERROR" if new_retry_count >= 5 else "ERROR"
            supabase.table("match_queue").update(
                {
                    "status": new_status,
                    "error_log": str(exc),
                    "last_try_at": datetime.now(timezone.utc).isoformat(),
                    "retry_count": new_retry_count,
                }
            ).eq("match_code", match_code).execute()
            if new_status == "PERMANENT_ERROR":
                logger.warning("Match %s reached max retries, marked PERMANENT_ERROR", match_code)
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

    logger.info(
        "Monitoring summary: processed=%d success=%d monitoring=%d error=%d",
        processed, success_count, still_monitoring_count, error_count,
    )


if __name__ == "__main__":
    run_monitoring_worker()
