from __future__ import annotations

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

    # Pagination ile tüm maçları çek (Supabase varsayılan 1000 limit)
    window_match_codes = set()
    page_size = 1000
    offset = 0
    while True:
        matches_in_window = (
            supabase.table("matches")
            .select("match_code")
            .gte("match_date", window_start_str)
            .lte("match_date", window_end_str)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = [m["match_code"] for m in (matches_in_window.data or []) if m.get("match_code")]
        window_match_codes.update(batch)
        if len(batch) < page_size:
            break
        offset += page_size

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
        logger.info("Checking for never-processed and stale matches...")
        existing_codes = {item["match_code"] for item in queue}

        # 1. Hiç işlenmemiş maçlar (last_try_at IS NULL) — livedata'dan gelip hiç scrape edilmemiş
        never_tried = []
        offset = 0
        while True:
            page_resp = (
                supabase.table("match_queue")
                .select("match_code, match_url, status, retry_count")
                .neq("status", "SUCCESS")
                .neq("status", "PERMANENT_ERROR")
                .is_("last_try_at", "null")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            batch = page_resp.data or []
            never_tried.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size

        for item in never_tried:
            mc = item.get("match_code")
            if mc and mc not in existing_codes:
                missing_date_count += 1
                queue.append(item)
                existing_codes.add(mc)

        # 2. Eski MONITORING/ERROR maçlar (last_try > 3 saat önce) — takılmış olabilir
        stale_cutoff = (now - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
        stale = []
        offset = 0
        while True:
            page_resp = (
                supabase.table("match_queue")
                .select("match_code, match_url, status, retry_count")
                .in_("status", ["MONITORING", "ERROR"])
                .lt("last_try_at", stale_cutoff)
                .range(offset, offset + page_size - 1)
                .execute()
            )
            batch = page_resp.data or []
            stale.extend(batch)
            if len(batch) < page_size:
                break
            offset += page_size

        stale_count = 0
        for item in stale:
            mc = item.get("match_code")
            if mc and mc not in existing_codes:
                stale_count += 1
                queue.append(item)
                existing_codes.add(mc)

        # 3. Maç tarihi 3+ saat geçmiş ama hâlâ skor girilmemiş maçlar
        finished_cutoff = (now - timedelta(hours=3)).strftime("%Y-%m-%d %H:%M:%S")
        unsettled_codes: set[str] = set()
        offset = 0
        while True:
            page_resp = (
                supabase.table("matches")
                .select("match_code")
                .lt("match_date", finished_cutoff)
                .or_("score_ft.is.null,score_ft.eq.v")
                .range(offset, offset + page_size - 1)
                .execute()
            )
            batch = page_resp.data or []
            unsettled_codes.update(m["match_code"] for m in batch if m.get("match_code"))
            if len(batch) < page_size:
                break
            offset += page_size

        # Bu maçların queue'daki durumunu kontrol et
        unsettled_count = 0
        unsettled_list = [c for c in unsettled_codes if c not in existing_codes]
        for i in range(0, len(unsettled_list), 200):
            chunk = unsettled_list[i : i + 200]
            resp = (
                supabase.table("match_queue")
                .select("match_code, match_url, status, retry_count")
                .neq("status", "SUCCESS")
                .neq("status", "PERMANENT_ERROR")
                .in_("match_code", chunk)
                .execute()
            )
            for item in (resp.data or []):
                mc = item.get("match_code")
                if mc and mc not in existing_codes:
                    unsettled_count += 1
                    queue.append(item)
                    existing_codes.add(mc)

        logger.info(
            "Added %d never-processed + %d stale + %d unsettled matches",
            missing_date_count, stale_count, unsettled_count,
        )

    if not queue:
        logger.info(
            "No matches to process (window=-%dh/+%dh).",
            window_hours_before, window_hours_after,
        )
        return

    logger.info(
        "Found %d matches to process",
        len(queue),
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

    # --- Hafif queue/matches senkronizasyonu ---
    if include_missing_dates:
        _sync_queue_with_matches(logger)


def _sync_queue_with_matches(logger) -> None:
    """
    Hafif queue ↔ matches senkronizasyonu. Her monitoring çalışmasının sonunda koşar.

    1. matches'da bitmiş (score_ft dolu, != 'v') ama queue'da SUCCESS olmayan → SUCCESS yap
    2. matches'da var ama queue'da hiç kaydı olmayan → queue'ya MONITORING ekle
    """
    page_size = 1000
    sync_success = 0
    sync_inserted = 0

    # --- 1. Bitmiş maçlar: queue'yu SUCCESS'e çek ---
    # Queue'da SUCCESS olmayan kayıtları al
    non_success_codes: dict[str, str] = {}  # match_code → current status
    offset = 0
    while True:
        resp = (
            supabase.table("match_queue")
            .select("match_code, status")
            .neq("status", "SUCCESS")
            .neq("status", "PERMANENT_ERROR")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        for item in batch:
            mc = item.get("match_code")
            if mc:
                non_success_codes[mc] = item.get("status", "")
        if len(batch) < page_size:
            break
        offset += page_size

    if non_success_codes:
        # Bu maçlardan hangilerinin skoru var?
        code_list = list(non_success_codes.keys())
        finished_codes: list[str] = []
        for i in range(0, len(code_list), 200):
            chunk = code_list[i : i + 200]
            resp = (
                supabase.table("matches")
                .select("match_code, score_ft")
                .in_("match_code", chunk)
                .execute()
            )
            for row in (resp.data or []):
                score = row.get("score_ft")
                if score and score != "v":
                    finished_codes.append(row["match_code"])

        # Toplu SUCCESS güncelleme
        for i in range(0, len(finished_codes), 200):
            chunk = finished_codes[i : i + 200]
            supabase.table("match_queue").update(
                {"status": "SUCCESS", "error_log": "Synced: score exists in matches"}
            ).in_("match_code", chunk).execute()
        sync_success = len(finished_codes)

    # --- 2. matches'da var ama queue'da yok → queue'ya ekle ---
    # Son 7 gündeki maçlara bak (çok eski maçları karıştırmamak için)
    cutoff = (datetime.now() - timedelta(days=7)).strftime("%Y-%m-%d %H:%M:%S")
    recent_codes: set[str] = set()
    offset = 0
    while True:
        resp = (
            supabase.table("matches")
            .select("match_code")
            .gte("match_date", cutoff)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = resp.data or []
        recent_codes.update(m["match_code"] for m in batch if m.get("match_code"))
        if len(batch) < page_size:
            break
        offset += page_size

    if recent_codes:
        # Queue'da hangileri var?
        existing_in_queue: set[str] = set()
        code_list = list(recent_codes)
        for i in range(0, len(code_list), 200):
            chunk = code_list[i : i + 200]
            resp = (
                supabase.table("match_queue")
                .select("match_code")
                .in_("match_code", chunk)
                .execute()
            )
            existing_in_queue.update(m["match_code"] for m in (resp.data or []) if m.get("match_code"))

        missing = recent_codes - existing_in_queue
        if missing:
            rows_to_insert = [
                {
                    "match_code": mc,
                    "match_url": f"https://arsiv.mackolik.com/Match/Default.aspx?id={mc}",
                    "status": "MONITORING",
                    "error_log": "Auto-created: found in matches but not in queue",
                }
                for mc in missing
            ]
            for i in range(0, len(rows_to_insert), 100):
                batch = rows_to_insert[i : i + 100]
                try:
                    supabase.table("match_queue").insert(batch, returning="minimal").execute()
                    sync_inserted += len(batch)
                except Exception:
                    # Tek tek dene (duplicate olabilir)
                    for row in batch:
                        try:
                            supabase.table("match_queue").insert(row, returning="minimal").execute()
                            sync_inserted += 1
                        except Exception:
                            pass

    if sync_success or sync_inserted:
        logger.info(
            "Queue sync: %d → SUCCESS, %d new queue entries created",
            sync_success, sync_inserted,
        )


if __name__ == "__main__":
    run_monitoring_worker()
