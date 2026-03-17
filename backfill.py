"""
Backfill — Son N ay için match_stats ve match_h2h verilerini doldurur.
Resumable ve idempotent: zaten kaydı olan maçları atlar.
"""

import time
from datetime import datetime, timedelta

from config import supabase
from scraping_client import fetch_static
from scraper_engine import parse_match_stats, get_text


def run_backfill(months: int = 6, batch_size: int = 200):
    cutoff = (datetime.now() - timedelta(days=months * 30)).strftime("%Y-%m-%d")
    print(f"📦 Backfill başlatılıyor (cutoff={cutoff}, batch_size={batch_size})")

    total_processed = 0
    total_stats = 0
    total_h2h = 0

    while True:
        matches = fetch_unprocessed(cutoff, batch_size)

        if not matches:
            break

        print(f"   🔄 {len(matches)} maç işlenecek...")

        for match in matches:
            match_code = match["match_code"]

            # Stats backfill (statik sayfa ile — browser gerektirmez)
            if not match.get("has_stats"):
                try:
                    from scrapling import Selector
                except ImportError:
                    from scrapling import Adaptor as Selector
                try:
                    url = f"https://arsiv.mackolik.com/Match/Default.aspx?id={match_code}"
                    page_resp = fetch_static(url)
                    stats = parse_match_stats(page_resp)
                    if stats:
                        stats["match_code"] = match_code
                        supabase.table("match_stats").upsert(stats, on_conflict="match_code").execute()
                        total_stats += 1
                except Exception as e:
                    print(f"      Stats error {match_code}: {e}")

            # H2H backfill — pre-match kaydı korumak için insert (upsert değil).
            # has_h2h=False ise zaten kayıt yok, insert güvenli.
            if not match.get("has_h2h"):
                try:
                    from h2h_scraper import scrape_h2h
                    h2h = scrape_h2h(match_code)
                    if h2h:
                        h2h["match_code"] = match_code
                        supabase.table("match_h2h").insert(h2h).execute()
                        total_h2h += 1
                except Exception as e:
                    print(f"      H2H error {match_code}: {e}")

            total_processed += 1
            time.sleep(0.5)

        print(f"   ✅ Batch tamamlandı (toplam: {total_processed}, stats: {total_stats}, h2h: {total_h2h})")

    print(f"\n🏁 Backfill tamamlandı! Toplam: {total_processed} maç, {total_stats} stats, {total_h2h} h2h")


def fetch_unprocessed(cutoff: str, limit: int) -> list:
    """
    matches tablosundan cutoff tarihinden sonra, score_ft NOT NULL,
    match_stats veya match_h2h kaydı olmayanları döner.
    Pagination ile tüm maçları tarar.
    """
    # 1. Tüm maçları pagination ile çek
    all_codes = []
    page_size = 1000
    offset = 0

    while True:
        resp = (
            supabase.table("matches")
            .select("match_code")
            .gte("match_date", cutoff)
            .not_.is_("score_ft", "null")
            .order("match_date")
            .range(offset, offset + page_size - 1)
            .execute()
        )
        batch = [m["match_code"] for m in (resp.data or []) if m.get("match_code")]
        all_codes.extend(batch)
        if len(batch) < page_size:
            break
        offset += page_size

    if not all_codes:
        return []

    # 2. Zaten stats kaydı olanları bul
    stats_codes = set()
    for i in range(0, len(all_codes), 200):
        chunk = all_codes[i:i+200]
        resp = supabase.table("match_stats").select("match_code").in_("match_code", chunk).execute()
        stats_codes.update(r["match_code"] for r in (resp.data or []))

    # 3. Zaten h2h kaydı olanları bul
    h2h_codes = set()
    for i in range(0, len(all_codes), 200):
        chunk = all_codes[i:i+200]
        resp = supabase.table("match_h2h").select("match_code").in_("match_code", chunk).execute()
        h2h_codes.update(r["match_code"] for r in (resp.data or []))

    # 4. En az birinde eksik olanları filtrele
    result = []
    for mc in all_codes:
        has_stats = mc in stats_codes
        has_h2h = mc in h2h_codes
        if not has_stats or not has_h2h:
            result.append({
                "match_code": mc,
                "has_stats": has_stats,
                "has_h2h": has_h2h,
            })
        if len(result) >= limit:
            break

    return result


if __name__ == "__main__":
    run_backfill()
