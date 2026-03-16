#!/usr/bin/env python3
"""
Günün Kuponu — Wilson Score tabanlı günlük kupon üretici.

Her gün 17:00'da çalıştırılır:
  python main.py generate-daily-picks
  python main.py generate-daily-picks --date 2026-03-14
  python main.py generate-daily-picks --dry-run

2 güvenli kupon × 3 pick üretir (wilsonLower sıralamalı).
Kupon 1: En iyi 3 pick | Kupon 2: Sonraki en iyi 3 pick
"""

import argparse
import math
import re
from datetime import datetime, timezone
from config import supabase
from logging_config import setup_logging

logger = setup_logging("daily_picks")

# ---------------------------------------------------------------------------
# Wilson Score
# ---------------------------------------------------------------------------

def wilson_lower(hits: int, total: int, z: float = 1.96) -> float:
    """Wilson Score Lower Bound — küçük sample'ı cezalandırır."""
    if total == 0:
        return 0.0
    p = hits / total
    z2 = z * z
    denominator = 1 + z2 / total
    centre = p + z2 / (2 * total)
    spread = z * math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)
    return max(0.0, (centre - spread) / denominator)


def wilson_ev(hits: int, total: int, odds: float, z: float = 1.96) -> float:
    """Güven ayarlı Expected Value."""
    return wilson_lower(hits, total, z) * odds


# ---------------------------------------------------------------------------
# Sabitler
# ---------------------------------------------------------------------------

SCORE_RE = re.compile(r"(\d+)\s*-\s*(\d+)")

MATCH_CORE_FIELDS = ["id", "match_code", "home_team", "away_team", "match_date", "league", "season"]
SCORE_FIELDS = ["score_ht", "score_ft"]

ODDS_FIELDS = [
    "ms_1", "ms_x", "ms_2",
    "iyms_11", "iyms_1x", "iyms_12",
    "iyms_x1", "iyms_xx", "iyms_x2",
    "iyms_21", "iyms_2x", "iyms_22",
    "au_15_alt", "au_15_ust",
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
    "au_15_alt": "1.5 Alt", "au_15_ust": "1.5 Üst",
    "au_25_alt": "2.5 Alt", "au_25_ust": "2.5 Üst",
    "kg_var": "KG Var", "kg_yok": "KG Yok",
    "tg_0_1": "TG 0-1", "tg_2_3": "TG 2-3", "tg_4_5": "TG 4-5", "tg_6_plus": "TG 6+",
}

SELECT_FIELDS = ", ".join(MATCH_CORE_FIELDS + SCORE_FIELDS + ODDS_FIELDS)

COUPON_CONFIG = {
    "odds_min": 1.30,
    "odds_max": 2.50,
    "min_samples": 50,
    "pick_count": 3,
}


# ---------------------------------------------------------------------------
# Score & Outcome Yardımcıları
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
    """Maç sonuçlarından oluşan outcome key seti (TypeScript getOutcomeKeys ile birebir)."""
    outcome_keys = set()
    ft = _parse_score(match.get("score_ft"))
    if not ft:
        return outcome_keys

    # MS 1/X/2
    ft_result = _get_result_key(ft["home"], ft["away"])
    outcome_keys.add(f"ms_{ft_result.lower()}")

    total_goals = ft["home"] + ft["away"]

    # Alt/Üst 1.5
    if total_goals > 1.5:
        outcome_keys.add("au_15_ust")
    else:
        outcome_keys.add("au_15_alt")

    # Alt/Üst 2.5
    if total_goals > 2.5:
        outcome_keys.add("au_25_ust")
    else:
        outcome_keys.add("au_25_alt")

    # Karşılıklı Gol
    if ft["home"] > 0 and ft["away"] > 0:
        outcome_keys.add("kg_var")
    else:
        outcome_keys.add("kg_yok")

    # Toplam Gol
    if total_goals <= 1:
        outcome_keys.add("tg_0_1")
    elif total_goals <= 3:
        outcome_keys.add("tg_2_3")
    elif total_goals <= 5:
        outcome_keys.add("tg_4_5")
    else:
        outcome_keys.add("tg_6_plus")

    # İY/MS
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


def _is_unplayed(match: dict) -> bool:
    score_ft = match.get("score_ft")
    if not score_ft:
        return True
    return not SCORE_RE.search(str(score_ft))


# ---------------------------------------------------------------------------
# Supabase Batch Fetch (1000 satır limiti aşmak için)
# ---------------------------------------------------------------------------

def _fetch_all_rows(query_builder_fn) -> list:
    """Supabase 1000 satır limitini aşmak için batch fetch."""
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
# Ana Algoritma
# ---------------------------------------------------------------------------

def _compute_candidates(fixtures: list, tolerance_pct: float) -> list:
    """
    Her fixture × her outcome_key için tarihsel hit rate hesapla.
    Sonuç: [{fixture, outcome_key, odds, hits, total, wilson, ev, ...}, ...]
    """
    tolerance = tolerance_pct / 100.0
    candidates = []

    for i, fixture in enumerate(fixtures):
        match_id = fixture["id"]
        logger.info(f"  [{i+1}/{len(fixtures)}] {fixture.get('home_team')} vs {fixture.get('away_team')}")

        # MS profili bir kez hesapla (tüm outcome'lar için ortak)
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

            # Tarihsel benzer maçları çek
            def build_query(ok=outcome_key, tl=target_lower, tu=target_upper,
                            ms=ms_ranges, mid=match_id, iy=is_iyms):
                q = (supabase.table("matches")
                     .select(", ".join(SCORE_FIELDS))
                     .filter("score_ft", "not.is", "null")
                     .neq("id", mid)
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

            # Valid score'ları filtrele
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
            if total_similar == 0:
                continue

            # Hit count
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
                "odds_value": odd_value,
                "wilson_lower": round(wl, 4),
                "hit_rate": round(hit_rate, 4),
                "total_similar": total_similar,
                "hit_count": hit_count,
                "ev": round(ev, 4),
                "implied_prob": round(implied_prob, 4),
            })

    return candidates


def _generate_coupon(candidates: list, config: dict, exclude_matches: set = None) -> list:
    """Kupon konfigürasyonuna göre en iyi 3 pick'i seç.

    exclude_matches: Daha önceki kuponlarda kullanılan maç ID'leri (tekrar seçilmez).
    """
    if exclude_matches is None:
        exclude_matches = set()

    # Filtreleme
    filtered = [
        c for c in candidates
        if config["odds_min"] <= c["odds_value"] <= config["odds_max"]
        and c["total_similar"] >= config["min_samples"]
        and c["match_id"] not in exclude_matches
    ]

    # Sıralama: wilsonLower desc
    filtered.sort(key=lambda c: c["wilson_lower"], reverse=True)

    # Max 1 pick per match
    picks = []
    seen_matches = set()
    for c in filtered:
        if c["match_id"] in seen_matches:
            continue
        seen_matches.add(c["match_id"])
        picks.append(c)
        if len(picks) >= config["pick_count"]:
            break

    return picks


def _save_coupon(date_key: str, coupon_type: str, picks: list, dry_run: bool):
    """Kuponu daily_picks tablosuna upsert et."""
    if not picks:
        logger.warning(f"  {coupon_type} kuponu için yeterli pick bulunamadı — atlanıyor.")
        return

    combined_odds = 1.0
    for p in picks:
        combined_odds *= p["odds_value"]

    avg_wilson = sum(p["wilson_lower"] for p in picks) / len(picks)
    avg_ev = sum(p["ev"] for p in picks) / len(picks)

    row = {
        "pick_date": date_key,
        "coupon_type": coupon_type,
        "picks": picks,
        "combined_odds": round(combined_odds, 2),
        "avg_wilson": round(avg_wilson, 4),
        "avg_ev": round(avg_ev, 4),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    }

    if dry_run:
        logger.info(f"  [DRY-RUN] {coupon_type} kupon:")
        for i, p in enumerate(picks):
            logger.info(f"    {i+1}. {p['home_team']} vs {p['away_team']} — "
                        f"{p['outcome_label']} @{p['odds_value']:.2f} "
                        f"(wilson={p['wilson_lower']:.3f}, ev={p['ev']:.3f}, "
                        f"sample={p['total_similar']})")
        logger.info(f"  Toplam oran: {combined_odds:.2f} | Ort. wilson: {avg_wilson:.3f} | Ort. EV: {avg_ev:.3f}")
        return

    try:
        supabase.table("daily_picks").upsert(row, on_conflict="pick_date,coupon_type").execute()
        logger.info(f"  ✅ {coupon_type} kupon kaydedildi ({len(picks)} pick, toplam oran {combined_odds:.2f})")
    except Exception as e:
        logger.error(f"  ❌ {coupon_type} kupon kayıt hatası: {e}")


# ---------------------------------------------------------------------------
# Settlement — Geçmiş kuponların sonuçlarını güncelle
# ---------------------------------------------------------------------------

def _settle_past_coupons():
    """Bitmemiş kuponların sonuçlarını kontrol et ve güncelle."""
    try:
        response = supabase.table("daily_picks").select("*").eq("is_settled", False).execute()
    except Exception as e:
        logger.error(f"Settlement sorgu hatası: {e}")
        return

    unsettled = response.data or []
    if not unsettled:
        return

    logger.info(f"🔄 {len(unsettled)} adet bitmemiş kupon kontrol ediliyor...")

    for coupon in unsettled:
        picks = coupon.get("picks") or []
        all_settled = True
        results = []
        hits = 0

        for pick in picks:
            match_id = pick.get("match_id")
            try:
                match_res = (supabase.table("matches")
                             .select("score_ft, score_ht")
                             .eq("id", match_id)
                             .limit(1)
                             .execute())
            except Exception:
                all_settled = False
                continue

            match_data = (match_res.data or [None])[0]
            if not match_data:
                all_settled = False
                continue

            score_ft = match_data.get("score_ft")
            if not score_ft or not SCORE_RE.search(str(score_ft)):
                all_settled = False
                continue

            outcome_keys = _get_outcome_keys(match_data)
            is_hit = pick.get("outcome_key") in outcome_keys
            if is_hit:
                hits += 1

            results.append({
                "match_id": match_id,
                "outcome_key": pick.get("outcome_key"),
                "score_ft": score_ft,
                "score_ht": match_data.get("score_ht"),
                "hit": is_hit,
            })

        if all_settled and len(results) == len(picks):
            try:
                supabase.table("daily_picks").update({
                    "results": results,
                    "is_settled": True,
                    "hits_count": hits,
                    "coupon_hit": hits == len(picks),
                    "settled_at": datetime.now(timezone.utc).isoformat(),
                }).eq("id", coupon["id"]).execute()
                logger.info(f"  ✅ {coupon['pick_date']} {coupon['coupon_type']}: {hits}/{len(picks)} tuttu")
            except Exception as e:
                logger.error(f"  ❌ Settlement güncelleme hatası: {e}")


# ---------------------------------------------------------------------------
# Ana Çalıştırma
# ---------------------------------------------------------------------------

def run(date_key: str = None, dry_run: bool = False, tolerance_pct: float = 5.0):
    if not date_key:
        date_key = datetime.now().strftime("%Y-%m-%d")

    logger.info(f"🎯 Günün Kuponu üretiliyor: {date_key} (tolerance={tolerance_pct}%)")

    # 1. Settle geçmiş kuponları
    _settle_past_coupons()

    # 2. Günün fixture'larını çek
    logger.info("📋 Fixture'lar çekiliyor...")
    try:
        response = (supabase.table("matches")
                    .select(SELECT_FIELDS)
                    .gte("match_date", f"{date_key}T00:00:00")
                    .lte("match_date", f"{date_key}T23:59:59")
                    .order("match_date", desc=False)
                    .execute())
    except Exception as e:
        logger.error(f"Fixture çekme hatası: {e}")
        return

    all_matches = response.data or []

    # Oynanmamış ve en az MS oranları olan maçları filtrele
    fixtures = [
        m for m in all_matches
        if _is_unplayed(m)
        and _is_valid_odd(m.get("ms_1"))
        and _is_valid_odd(m.get("ms_x"))
    ]

    logger.info(f"  {len(all_matches)} maçtan {len(fixtures)} geçerli fixture bulundu.")

    if not fixtures:
        logger.warning("Fixture bulunamadı — çıkılıyor.")
        return

    # 3. Tüm kandidatları hesapla
    logger.info("🔍 Tarihsel benzerlik hesaplanıyor...")
    candidates = _compute_candidates(fixtures, tolerance_pct)
    logger.info(f"  {len(candidates)} aday üretildi.")

    if not candidates:
        logger.warning("Hiç aday bulunamadı — çıkılıyor.")
        return

    # 4. 2 güvenli kupon oluştur
    logger.info("🛡️ Kupon 1 oluşturuluyor...")
    picks_1 = _generate_coupon(candidates, COUPON_CONFIG)
    _save_coupon(date_key, "safe_1", picks_1, dry_run)

    # Kupon 2: İlk kuponda kullanılan maçları hariç tut
    used_matches = {p["match_id"] for p in picks_1}
    logger.info("🛡️ Kupon 2 oluşturuluyor...")
    picks_2 = _generate_coupon(candidates, COUPON_CONFIG, exclude_matches=used_matches)
    _save_coupon(date_key, "safe_2", picks_2, dry_run)

    logger.info("✅ Günün kuponu tamamlandı.")


def run_from_main(argv):
    parser = argparse.ArgumentParser(description="Günün Kuponu üretici — Wilson Score tabanlı.")
    parser.add_argument("--date", help="Hedef tarih (YYYY-MM-DD). Varsayılan: bugün.")
    parser.add_argument("--dry-run", action="store_true", help="DB'ye yazmadan sonuçları logla.")
    parser.add_argument("--tolerance", type=float, default=5.0, help="Tolerans yüzdesi (varsayılan: 5).")
    args = parser.parse_args(argv)
    run(date_key=args.date, dry_run=args.dry_run, tolerance_pct=args.tolerance)


if __name__ == "__main__":
    import sys
    run_from_main(sys.argv[1:])
