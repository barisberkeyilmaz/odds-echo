import random
import time
from datetime import datetime, timedelta, timezone

from config import supabase
from logging_config import setup_logging
from scraping_client import create_browser, close_browser
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

    queue = []
    missing_date_count = 0

    if window_match_codes:
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
        logger.info("Checking for missing-date matches...")
        all_non_success = (
            supabase.table("match_queue")
            .select("match_code, match_url, status, retry_count")
            .neq("status", "SUCCESS")
            .neq("status", "PERMANENT_ERROR")
            .execute()
        )
        existing_codes = {item["match_code"] for item in queue}
        candidates = [
            item for item in (all_non_success.data or [])
            if item.get("match_code")
            and item["match_code"] not in existing_codes
            and item["match_code"] not in window_match_codes
        ]
        logger.info("Found %d candidates to check against matches table", len(candidates))
        candidate_codes = [item["match_code"] for item in candidates]
        codes_in_matches = set()
        for i in range(0, len(candidate_codes), 200):
            chunk = candidate_codes[i : i + 200]
            check_res = (
                supabase.table("matches")
                .select("match_code")
                .in_("match_code", chunk)
                .execute()
            )
            codes_in_matches.update(
                r["match_code"] for r in (check_res.data or []) if r.get("match_code")
            )
            if len(candidate_codes) > 200:
                logger.info("  Checked %d/%d candidates...", min(i + 200, len(candidate_codes)), len(candidate_codes))
        candidate_map = {item["match_code"]: item for item in candidates}
        for mc in candidate_codes:
            if mc not in codes_in_matches:
                missing_date_count += 1
                queue.append(candidate_map[mc])
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

    browser = create_browser()
    page = browser.new_page()

    for item in queue:
        match_code = item.get("match_code")
        if not match_code:
            continue
        match_url = item.get("match_url") or (
            f"https://arsiv.mackolik.com/Match/Default.aspx?id={match_code}"
        )
        retry_count = item.get("retry_count") or 0

        try:
            process_full_match(match_url, page)

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

            # Sayfa çöktüyse yeni sayfa aç
            try:
                page.close()
                page = browser.new_page()
            except Exception:
                try:
                    close_browser(browser)
                except Exception:
                    pass
                browser = create_browser()
                page = browser.new_page()

        processed += 1
        time.sleep(random.uniform(0.5, 1.5))

    close_browser(browser)

    logger.info(
        "Monitoring summary: processed=%d success=%d monitoring=%d error=%d",
        processed, success_count, still_monitoring_count, error_count,
    )


if __name__ == "__main__":
    run_monitoring_worker()
