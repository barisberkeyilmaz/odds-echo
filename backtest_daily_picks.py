#!/usr/bin/env python3
"""
Backtest — Günün Önerileri algoritmasının geçmiş performans simülasyonu.

Kullanım:
  python backtest_daily_picks.py --days 30
  python backtest_daily_picks.py --from 2026-02-01 --to 2026-03-01
  python backtest_daily_picks.py --incremental
  python backtest_daily_picks.py --dry-run --days 7
  python backtest_daily_picks.py --clear
"""

import argparse
import math
import re
import uuid
from datetime import datetime, timedelta, timezone
from config import supabase
from logging_config import setup_logging

logger = setup_logging("backtest")

# ---------------------------------------------------------------------------
# Wilson Score (generate_daily_picks.py ile aynı)
# ---------------------------------------------------------------------------

def wilson_lower(hits: int, total: int, z: float = 1.96) -> float:
    if total == 0:
        return 0.0
    p = hits / total
    z2 = z * z
    denominator = 1 + z2 / total
    centre = p + z2 / (2 * total)
    spread = z * math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
    return max(0.0, (centre - spread) / denominator)


def wilson_ev(hits: int, total: int, odds: float, z: float = 1.96) -> float:
    return wilson_lower(hits, total, z) * odds


# ---------------------------------------------------------------------------
# Sabitler (generate_daily_picks.py ile aynı)
# ---------------------------------------------------------------------------

SCORE_RE = re.compile(r"(\d+)\s*-\s*(\d+)")

MATCH_CORE_FIELDS = ["id", "match_code", "home_team", "away_team", "match_date", "league", "season"]
SCORE_FIELDS = ["score_ht", "score_ft"]

ODDS_FIELDS = [
    "ms_1", "ms_x", "ms_2",
    "iyms_11", "iyms_1x", "iyms_12",
    "iyms_x1", "iyms_xx", "iyms_x2",
    "iyms_21", "iyms_2x", "iyms_22",
    "au_25_alt", "au_25_ust",
    "kg_var", "kg_yok",
    "tg_0_1", "tg_2_3", "tg_4_5", "tg_6_plus",
]

MS_PROFILE_FIELDS = ["ms_1", "ms_x", "ms_2"]

IYMS_KEYS = {
    "iyms_11", "iyms_1x", "iyms_12",
    "iyms_x1", "iyms_xx", "iyms_x2",
    "iyms_21", "iyms_2x", "iyms_22",
}

OUTCOME_LABELS = {
    "ms_1": "MS 1", "ms_x": "MS X", "ms_2": "MS 2",
    "iyms_11": "1/1", "iyms_1x": "1/X", "iyms_12": "1/2",
    "iyms_x1": "X/1", "iyms_xx": "X/X", "iyms_x2": "X/2",
    "iyms_21": "2/1", "iyms_2x": "2/X", "iyms_22": "2/2",
    "au_25_alt": "2.5 Alt", "au_25_ust": "2.5 Üst",
    "kg_var": "KG Var", "kg_yok": "KG Yok",
    "tg_0_1": "TG 0-1", "tg_2_3": "TG 2-3", "tg_4_5": "TG 4-5", "tg_6_plus": "TG 6+",
}

OUTCOME_CATEGORY = {
    "ms_1": "MS", "ms_x": "MS", "ms_2": "MS",
    "iyms_11": "İY/MS", "iyms_1x": "İY/MS", "iyms_12": "İY/MS",
    "iyms_x1": "İY/MS", "iyms_xx": "İY/MS", "iyms_x2": "İY/MS",
    "iyms_21": "İY/MS", "iyms_2x": "İY/MS", "iyms_22": "İY/MS",
    "au_25_alt": "2.5 A/Ü", "au_25_ust": "2.5 A/Ü",
    "kg_var": "KG", "kg_yok": "KG",
    "tg_0_1": "TG", "tg_2_3": "TG", "tg_4_5": "TG", "tg_6_plus": "TG",
}

SELECT_FIELDS = ", ".join(MATCH_CORE_FIELDS + SCORE_FIELDS + ODDS_FIELDS)

MIN_SAMPLES = 50


# ---------------------------------------------------------------------------
# Score & Outcome Yardımcıları (generate_daily_picks.py ile aynı)
# ---------------------------------------------------------------------------

def _parse_score(value):
    if not value:
        return None
    m = SCORE_RE.search(str(value))
    if not m:
        return None
    return {"home": int(m.group(1)), "away": int(m.group(2))}


def _get_result_key(home, away):
    if home > away:
        return "1"
    if home < away:
        return "2"
    return "X"


def _get_outcome_keys(match: dict) -> set:
    outcome_keys = set()
    ft = _parse_score(match.get("score_ft"))
    if not ft:
        return outcome_keys

    ft_result = _get_result_key(ft["home"], ft["away"])
    outcome_keys.add(f"ms_{ft_result.lower()}")

    total_goals = ft["home"] + ft["away"]

    if total_goals > 1.5:
        outcome_keys.add("au_15_ust")
    else:
        outcome_keys.add("au_15_alt")

    if total_goals > 2.5:
        outcome_keys.add("au_25_ust")
    else:
        outcome_keys.add("au_25_alt")

    if ft["home"] > 0 and ft["away"] > 0:
        outcome_keys.add("kg_var")
    else:
        outcome_keys.add("kg_yok")

    if total_goals <= 1:
        outcome_keys.add("tg_0_1")
    elif total_goals <= 3:
        outcome_keys.add("tg_2_3")
    elif total_goals <= 5:
        outcome_keys.add("tg_4_5")
    else:
        outcome_keys.add("tg_6_plus")

    ht = _parse_score(match.get("score_ht"))
    if ht:
        ht_result = _get_result_key(ht["home"], ht["away"])
        iyms_key_map = {
            "1-1": "iyms_11", "1-X": "iyms_1x", "1-2": "iyms_12",
            "X-1": "iyms_x1", "X-X": "iyms_xx", "X-2": "iyms_x2",
            "2-1": "iyms_21", "2-X": "iyms_2x", "2-2": "iyms_22",
        }
        combined_key = f"{ht_result}-{ft_result}"
        iyms_key = iyms_key_map.get(combined_key)
        if iyms_key:
            outcome_keys.add(iyms_key)

    return outcome_keys


def _is_valid_odd(value) -> bool:
    if value is None:
        return False
    try:
        v = float(value)
        return math.isfinite(v) and v > 0
    except (TypeError, ValueError):
        return False


# ---------------------------------------------------------------------------
# Supabase Batch Fetch
# ---------------------------------------------------------------------------

def _fetch_all_rows(query_builder_fn) -> list:
    batch_size = 1000
    all_data = []
    offset = 0

    while True:
        response = query_builder_fn().range(offset, offset + batch_size - 1).execute()
        rows = response.data or []
        all_data.extend(rows)
        if len(rows) < batch_size:
            break
        offset += batch_size

    return all_data


# ---------------------------------------------------------------------------
# Tolerance Aralığı
# ---------------------------------------------------------------------------

def _tolerance_range(value: float, tolerance: float) -> tuple:
    tolerance_abs = max(value * tolerance, tolerance)
    return (value - tolerance_abs, value + tolerance_abs)


# ---------------------------------------------------------------------------
# Backtest Algoritması
# ---------------------------------------------------------------------------

def _get_day_fixtures(date_key: str) -> list:
    """O günün maçlarını çek (oranlar dahil)."""
    try:
        response = (supabase.table("matches")
                    .select(SELECT_FIELDS)
                    .gte("match_date", f"{date_key}T00:00:00")
                    .lte("match_date", f"{date_key}T23:59:59")
                    .order("match_date", desc=False)
                    .execute())
    except Exception as e:
        logger.error(f"Fixture çekme hatası ({date_key}): {e}")
        return []

    all_matches = response.data or []

    # Geçerli oranları olan maçları filtrele (backtest'te oynanmış maçları DA dahil ediyoruz)
    fixtures = [
        m for m in all_matches
        if _is_valid_odd(m.get("ms_1"))
        and _is_valid_odd(m.get("ms_x"))
    ]

    return fixtures


def _compute_candidates(pick_date: str, fixtures: list, tolerance_pct: float) -> list:
    """
    KRİTİK: match_date < pick_date filtresi — look-ahead bias yok.
    """
    tolerance = tolerance_pct / 100.0
    candidates = []

    for i, fixture in enumerate(fixtures):
        match_id = fixture["id"]

        ms_ranges = []
        for ms_field in MS_PROFILE_FIELDS:
            ms_value = fixture.get(ms_field)
            if _is_valid_odd(ms_value):
                lower, upper = _tolerance_range(float(ms_value), tolerance)
                ms_ranges.append({"field": ms_field, "lower": lower, "upper": upper})

        for outcome_key in ODDS_FIELDS:
            odd_value = fixture.get(outcome_key)
            if not _is_valid_odd(odd_value):
                continue
            odd_value = float(odd_value)

            is_iyms = outcome_key in IYMS_KEYS
            target_lower, target_upper = _tolerance_range(odd_value, tolerance)

            # KRİTİK: match_date < pick_date — sadece geçmiş maçları kullan
            def build_query(ok=outcome_key, tl=target_lower, tu=target_upper,
                            ms=ms_ranges, pd=pick_date, iy=is_iyms):
                q = (supabase.table("matches")
                     .select(", ".join(SCORE_FIELDS))
                     .filter("score_ft", "not.is", "null")
                     .lt("match_date", f"{pd}T00:00:00")
                     .gte(ok, tl)
                     .lte(ok, tu))
                for ms_range in ms:
                    q = q.gte(ms_range["field"], ms_range["lower"]).lte(ms_range["field"], ms_range["upper"])
                if iy:
                    q = q.filter("score_ht", "not.is", "null")
                return q

            try:
                historical = _fetch_all_rows(build_query)
            except Exception as e:
                logger.warning(f"    {outcome_key} sorgu hatası: {e}")
                continue

            valid = []
            for h in historical:
                ft = h.get("score_ft")
                if not ft or not SCORE_RE.search(str(ft)):
                    continue
                if is_iyms:
                    ht = h.get("score_ht")
                    if not ht or not SCORE_RE.search(str(ht)):
                        continue
                valid.append(h)

            total_similar = len(valid)
            if total_similar < MIN_SAMPLES:
                continue

            hit_count = sum(1 for v in valid if outcome_key in _get_outcome_keys(v))

            wl = wilson_lower(hit_count, total_similar)
            ev = wilson_ev(hit_count, total_similar, odd_value)
            hit_rate = hit_count / total_similar
            implied_prob = 1.0 / odd_value

            candidates.append({
                "match_id": match_id,
                "match_code": fixture.get("match_code", ""),
                "home_team": fixture.get("home_team", ""),
                "away_team": fixture.get("away_team", ""),
                "league": fixture.get("league", ""),
                "match_date": fixture.get("match_date", ""),
                "outcome_key": outcome_key,
                "outcome_label": OUTCOME_LABELS.get(outcome_key, outcome_key),
                "category_label": OUTCOME_CATEGORY.get(outcome_key, ""),
                "odds_value": odd_value,
                "wilson_lower": round(wl, 4),
                "hit_rate": round(hit_rate, 4),
                "total_similar": total_similar,
                "hit_count": hit_count,
                "ev": round(ev, 4),
                "implied_prob": round(implied_prob, 4),
            })

    return candidates


def _deduplicate_picks(candidates: list) -> list:
    """match_id + category_label dedup — en iyi Wilson kalır."""
    candidates.sort(key=lambda c: c["wilson_lower"], reverse=True)

    seen = set()
    deduplicated = []
    for c in candidates:
        key = f"{c['match_id']}::{c['category_label']}"
        if key in seen:
            continue
        seen.add(key)
        deduplicated.append(c)

    return deduplicated


def _settle_pick(pick: dict, fixture: dict) -> dict:
    """Gerçek sonuçla karşılaştır → is_hit, score_ft, score_ht belirle."""
    score_ft = fixture.get("score_ft")
    score_ht = fixture.get("score_ht")

    pick["score_ft"] = str(score_ft) if score_ft else None
    pick["score_ht"] = str(score_ht) if score_ht else None

    if not score_ft or not SCORE_RE.search(str(score_ft)):
        pick["is_hit"] = None
        pick["is_settled"] = False
        return pick

    outcome_keys = _get_outcome_keys(fixture)
    pick["is_hit"] = pick["outcome_key"] in outcome_keys
    pick["is_settled"] = True
    return pick


def _run_single_day(date_key: str, tolerance_pct: float) -> list:
    """Bir günü simüle et → pick listesi döndür."""
    fixtures = _get_day_fixtures(date_key)
    if not fixtures:
        return []

    # Fixture'ları ID ile indexle (settle için)
    fixture_map = {f["id"]: f for f in fixtures}

    # Kandidatları hesapla (look-ahead bias yok)
    candidates = _compute_candidates(date_key, fixtures, tolerance_pct)
    if not candidates:
        return []

    # Dedup
    picks = _deduplicate_picks(candidates)

    # Settle
    for pick in picks:
        fixture = fixture_map.get(pick["match_id"])
        if fixture:
            _settle_pick(pick, fixture)
        else:
            pick["is_hit"] = None
            pick["is_settled"] = False

    return picks


def _insert_picks(picks: list, run_id: str, date_key: str):
    """Pick'leri backtest_picks tablosuna yaz."""
    if not picks:
        return

    rows = []
    for p in picks:
        rows.append({
            "run_id": run_id,
            "pick_date": date_key,
            "match_id": p["match_id"],
            "match_code": p.get("match_code"),
            "home_team": p["home_team"],
            "away_team": p["away_team"],
            "league": p.get("league"),
            "match_date": p["match_date"],
            "outcome_key": p["outcome_key"],
            "outcome_label": p["outcome_label"],
            "category_label": p["category_label"],
            "odds_value": p["odds_value"],
            "wilson_lower": p["wilson_lower"],
            "hit_rate": p["hit_rate"],
            "total_similar": p["total_similar"],
            "hit_count": p["hit_count"],
            "ev": p["ev"],
            "implied_prob": p["implied_prob"],
            "score_ft": p.get("score_ft"),
            "score_ht": p.get("score_ht"),
            "is_hit": p.get("is_hit"),
            "is_settled": p.get("is_settled", False),
        })

    # Batch insert (Supabase max ~1000 satır)
    batch_size = 500
    for i in range(0, len(rows), batch_size):
        batch = rows[i:i + batch_size]
        try:
            supabase.table("backtest_picks").insert(batch).execute()
        except Exception as e:
            logger.error(f"  ❌ DB insert hatası (batch {i // batch_size + 1}): {e}")


# ---------------------------------------------------------------------------
# Ana Döngüler
# ---------------------------------------------------------------------------

def run_backtest(from_date: str, to_date: str, tolerance_pct: float = 5.0,
                 dry_run: bool = False):
    """Belirli tarih aralığı için backtest çalıştır."""
    run_id = str(uuid.uuid4())
    start = datetime.strptime(from_date, "%Y-%m-%d").date()
    end = datetime.strptime(to_date, "%Y-%m-%d").date()

    total_days = (end - start).days + 1
    logger.info(f"🔬 Backtest başlıyor: {from_date} → {to_date} ({total_days} gün)")
    logger.info(f"   Run ID: {run_id}")
    logger.info(f"   Tolerance: {tolerance_pct}% | Dry-run: {dry_run}")

    total_picks = 0
    total_hits = 0
    total_settled = 0
    all_settled_picks = []

    current = start
    day_num = 0
    while current <= end:
        day_num += 1
        date_key = current.strftime("%Y-%m-%d")
        logger.info(f"📅 [{day_num}/{total_days}] {date_key}")

        picks = _run_single_day(date_key, tolerance_pct)

        settled = [p for p in picks if p.get("is_settled")]
        hits = sum(1 for p in settled if p.get("is_hit"))

        total_picks += len(picks)
        total_settled += len(settled)
        total_hits += hits
        all_settled_picks.extend(settled)

        hit_pct = f"{hits / len(settled) * 100:.1f}%" if settled else "N/A"
        logger.info(f"   {len(picks)} pick, {len(settled)} settled, {hits} hit ({hit_pct})")

        if not dry_run and picks:
            _insert_picks(picks, run_id, date_key)

        current += timedelta(days=1)

    # ROI hesapla
    roi_pct = 0.0
    avg_odds = 0.0
    avg_ev = 0.0
    if total_settled > 0:
        roi_pct = sum(
            (p["odds_value"] - 1) if p.get("is_hit") else -1
            for p in all_settled_picks
        ) / total_settled * 100
        avg_odds = sum(p["odds_value"] for p in all_settled_picks) / total_settled
        avg_ev = sum(p["ev"] for p in all_settled_picks) / total_settled

    # Kategori bazlı ROI
    cat_stats = {}
    for p in all_settled_picks:
        cat = p.get("category_label", "?")
        if cat not in cat_stats:
            cat_stats[cat] = {"settled": 0, "hits": 0, "profit": 0.0}
        cat_stats[cat]["settled"] += 1
        cat_stats[cat]["hits"] += 1 if p.get("is_hit") else 0
        cat_stats[cat]["profit"] += (p["odds_value"] - 1) if p.get("is_hit") else -1

    # Özet
    logger.info("=" * 60)
    logger.info(f"📊 Backtest Özeti:")
    logger.info(f"   Tarih aralığı: {from_date} → {to_date} ({total_days} gün)")
    logger.info(f"   Toplam pick: {total_picks} | Settled: {total_settled}")
    logger.info(f"   Ort. pick/gün: {total_picks / total_days:.1f}")
    if total_settled > 0:
        logger.info(f"   İsabet: {total_hits}/{total_settled} ({total_hits / total_settled * 100:.1f}%)")
        logger.info(f"   Ort. oran: {avg_odds:.2f} | Ort. EV: {avg_ev:.3f}")
        logger.info(f"   💰 ROI: {roi_pct:+.1f}%")
        logger.info(f"   --- Kategori Bazlı ---")
        for cat, s in sorted(cat_stats.items()):
            cat_roi = s["profit"] / s["settled"] * 100 if s["settled"] > 0 else 0
            cat_hit = s["hits"] / s["settled"] * 100 if s["settled"] > 0 else 0
            logger.info(f"   {cat:8s}: {s['settled']:3d} pick, {cat_hit:5.1f}% isabet, ROI {cat_roi:+.1f}%")
    logger.info("=" * 60)



def run_incremental(tolerance_pct: float = 5.0, dry_run: bool = False):
    """Sadece DB'de olmayan günleri hesapla."""
    today = datetime.now(timezone.utc).date()
    yesterday = today - timedelta(days=1)

    # DB'deki en son pick_date'i bul
    try:
        response = (supabase.table("backtest_picks")
                    .select("pick_date")
                    .order("pick_date", desc=True)
                    .limit(1)
                    .execute())
    except Exception as e:
        logger.error(f"DB sorgu hatası: {e}")
        return

    data = response.data or []
    if data:
        last_date = datetime.strptime(data[0]["pick_date"], "%Y-%m-%d").date()
        start_date = last_date + timedelta(days=1)
        logger.info(f"📋 Son kayıtlı tarih: {last_date}")
    else:
        start_date = today - timedelta(days=30)
        logger.info(f"📋 DB boş — son 30 günden başlanıyor: {start_date}")

    if start_date > yesterday:
        logger.info("✅ Tüm günler zaten hesaplanmış — çıkılıyor.")
        return

    from_str = start_date.strftime("%Y-%m-%d")
    to_str = yesterday.strftime("%Y-%m-%d")
    run_backtest(from_str, to_str, tolerance_pct=tolerance_pct, dry_run=dry_run)


def clear_backtest():
    """Tüm backtest verilerini sil."""
    logger.info("🗑️ Backtest verileri siliniyor...")
    try:
        # Supabase delete requires a filter — use a broad one
        supabase.table("backtest_picks").delete().gte("id", 0).execute()
        logger.info("✅ Tüm backtest verileri silindi.")
    except Exception as e:
        logger.error(f"❌ Silme hatası: {e}")


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main():
    parser = argparse.ArgumentParser(
        description="Backtest — Günün Önerileri algoritmasının geçmiş performans simülasyonu."
    )
    parser.add_argument("--days", type=int, help="Son N günü hesapla (dünden geriye).")
    parser.add_argument("--from", dest="from_date", help="Başlangıç tarihi (YYYY-MM-DD).")
    parser.add_argument("--to", dest="to_date", help="Bitiş tarihi (YYYY-MM-DD).")
    parser.add_argument("--incremental", action="store_true",
                        help="Sadece DB'de olmayan günleri hesapla.")
    parser.add_argument("--dry-run", action="store_true",
                        help="Sadece istatistik göster, DB'ye yazma.")
    parser.add_argument("--clear", action="store_true",
                        help="Tüm backtest verilerini sil.")
    parser.add_argument("--tolerance", type=float, default=5.0,
                        help="Tolerans yüzdesi (varsayılan: 5).")

    args = parser.parse_args()

    if args.clear:
        clear_backtest()
        return

    if args.incremental:
        run_incremental(tolerance_pct=args.tolerance, dry_run=args.dry_run)
        return

    if args.days:
        today = datetime.now(timezone.utc).date()
        yesterday = today - timedelta(days=1)
        from_date = (yesterday - timedelta(days=args.days - 1)).strftime("%Y-%m-%d")
        to_date = yesterday.strftime("%Y-%m-%d")
        run_backtest(from_date, to_date, tolerance_pct=args.tolerance, dry_run=args.dry_run)
        return

    if args.from_date and args.to_date:
        run_backtest(args.from_date, args.to_date,
                     tolerance_pct=args.tolerance, dry_run=args.dry_run)
        return

    parser.print_help()


if __name__ == "__main__":
    main()
