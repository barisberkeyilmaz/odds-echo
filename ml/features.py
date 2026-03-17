"""
Feature engineering + bulk data loading.

Grup A — Bahisçi Oranları (implied probability)
Grup B — H2H Pre-Match
Grup C — Rolling Takım İstatistikleri (shift(1) ile leakage-free)
Grup D — Bağlamsal
"""

import re
import json
import logging
import numpy as np
import pandas as pd

from config import supabase
from ml.config import (
    PAGE_SIZE, ODDS_COLUMNS, ROLLING_WINDOWS,
    STAT_COLUMNS_HOME, STAT_COLUMNS_AWAY,
)

logger = logging.getLogger("ml.features")


# ═══════════════════════════════════════════════════════════════════
#  1. BULK DATA LOADING
# ═══════════════════════════════════════════════════════════════════

def _paginated_fetch(table: str, select: str = "*", order_col: str = "match_code") -> pd.DataFrame:
    """Supabase'den tüm satırları sayfalayarak çeker."""
    rows = []
    offset = 0
    while True:
        resp = (
            supabase.table(table)
            .select(select)
            .order(order_col)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
        logger.info(f"  {table}: {len(rows)} satır yüklendi...")
    logger.info(f"✅ {table}: toplam {len(rows)} satır")
    return pd.DataFrame(rows)


def load_all_data() -> pd.DataFrame:
    """matches + match_stats + match_h2h birleştir."""
    logger.info("📥 Veri yükleniyor...")

    df_matches = _paginated_fetch("matches")
    df_stats = _paginated_fetch("match_stats")
    df_h2h = _paginated_fetch("match_h2h")

    # LEFT JOIN
    df = df_matches.copy()
    if not df_stats.empty:
        stats_cols = [c for c in df_stats.columns if c not in ("id", "scraped_at")]
        df = df.merge(df_stats[stats_cols], on="match_code", how="left")
    if not df_h2h.empty:
        h2h_cols = [c for c in df_h2h.columns if c not in ("id", "scraped_at")]
        df = df.merge(df_h2h[h2h_cols], on="match_code", how="left")

    # match_date parse
    df["match_date"] = pd.to_datetime(df["match_date"], errors="coerce")
    df = df.sort_values("match_date").reset_index(drop=True)

    logger.info(f"📊 Birleşik veri: {len(df)} satır, {len(df.columns)} sütun")
    return df


# ═══════════════════════════════════════════════════════════════════
#  2. LABEL (TARGET) ÇIKARIMI
# ═══════════════════════════════════════════════════════════════════

def _parse_score(score_str):
    """'2 - 1' → (2, 1) veya None."""
    if not score_str or not isinstance(score_str, str):
        return None
    m = re.search(r"(\d+)\s*[-:]\s*(\d+)", score_str)
    if m:
        return int(m.group(1)), int(m.group(2))
    return None


def add_labels(df: pd.DataFrame) -> pd.DataFrame:
    """Target sütunlarını ekler."""
    # FT skor parse
    parsed_ft = df["score_ft"].apply(_parse_score)
    df["_home_goals"] = parsed_ft.apply(lambda x: x[0] if x else np.nan)
    df["_away_goals"] = parsed_ft.apply(lambda x: x[1] if x else np.nan)
    df["_total_goals"] = df["_home_goals"] + df["_away_goals"]

    # HT skor parse
    parsed_ht = df["score_ht"].apply(_parse_score)
    df["_ht_home"] = parsed_ht.apply(lambda x: x[0] if x else np.nan)
    df["_ht_away"] = parsed_ht.apply(lambda x: x[1] if x else np.nan)

    # MS (Maç Sonucu): 0=ev, 1=beraberlik, 2=deplasman
    df["target_ms"] = np.where(
        df["_home_goals"] > df["_away_goals"], 0,
        np.where(df["_home_goals"] == df["_away_goals"], 1, 2)
    )
    df.loc[df["_home_goals"].isna(), "target_ms"] = np.nan

    # KG (Karşılıklı Gol): 0=yok, 1=var
    df["target_kg"] = np.where(
        (df["_home_goals"] > 0) & (df["_away_goals"] > 0), 1, 0
    ).astype(float)
    df.loc[df["_home_goals"].isna(), "target_kg"] = np.nan

    # AU 2.5: 0=alt, 1=üst
    df["target_au25"] = np.where(df["_total_goals"] > 2.5, 1, 0).astype(float)
    df.loc[df["_total_goals"].isna(), "target_au25"] = np.nan

    # TG (Toplam Gol): 0="0-1", 1="2-3", 2="4+"
    df["target_tg"] = np.where(
        df["_total_goals"] <= 1, 0,
        np.where(df["_total_goals"] <= 3, 1, 2)
    ).astype(float)
    df.loc[df["_total_goals"].isna(), "target_tg"] = np.nan

    # İY (İlk Yarı): 0=ev, 1=beraberlik, 2=deplasman
    df["target_iy"] = np.where(
        df["_ht_home"] > df["_ht_away"], 0,
        np.where(df["_ht_home"] == df["_ht_away"], 1, 2)
    ).astype(float)
    df.loc[df["_ht_home"].isna(), "target_iy"] = np.nan

    return df


# ═══════════════════════════════════════════════════════════════════
#  3. FEATURE ENGINEERING
# ═══════════════════════════════════════════════════════════════════

# ── Grup A: Bahisçi Oranları ──────────────────────────────────────

def _add_odds_features(df: pd.DataFrame) -> pd.DataFrame:
    """Oran sütunlarından implied probability ve türev features."""

    # Implied probability (1/oran) — NaN kalır NaN
    for col in ODDS_COLUMNS:
        imp_col = f"imp_{col}"
        df[imp_col] = 1.0 / df[col].replace(0, np.nan)

    # MS implied normalize (vigorish kaldır)
    ms_sum = df["imp_ms_1"] + df["imp_ms_x"] + df["imp_ms_2"]
    for suffix in ["ms_1", "ms_x", "ms_2"]:
        df[f"imp_{suffix}_norm"] = df[f"imp_{suffix}"] / ms_sum

    # Oran türevleri
    df["odds_home_away_ratio"] = df["ms_1"] / df["ms_2"].replace(0, np.nan)

    # Shannon entropy (MS olasılıkları)
    for suffix in ["ms_1", "ms_x", "ms_2"]:
        col = f"imp_{suffix}_norm"
        df[f"_log_{suffix}"] = df[col].apply(
            lambda p: p * np.log2(p) if p and p > 0 else 0
        )
    df["odds_entropy"] = -(df["_log_ms_1"] + df["_log_ms_x"] + df["_log_ms_2"])
    df.drop(columns=["_log_ms_1", "_log_ms_x", "_log_ms_2"], inplace=True)

    return df


# ── Grup B: H2H Pre-Match ────────────────────────────────────────

def _form_score(form_str):
    """'GBM' → G=3, B=1, M=0 toplamı."""
    if not form_str or not isinstance(form_str, str):
        return np.nan
    mapping = {"G": 3, "B": 1, "M": 0}
    return sum(mapping.get(c.upper(), 0) for c in form_str)


def _add_h2h_features(df: pd.DataFrame) -> pd.DataFrame:
    """match_h2h verilerinden feature'lar.

    LEAKAGE UYARISI: Tüm H2H verileri maç sonrası arşivden scrape edildiği
    için form, sıralama, KG%, AU%, TG dağılımı ve H2H özeti maçın kendi
    sonucunu içeriyor. Backtest/eğitimde kullanılamaz.
    İleride maç öncesi canlı scrape yapılırsa bu fonksiyon aktifleştirilebilir.
    """
    # Şimdilik H2H feature üretilmiyor — tüm H2H sütunları exclude listesinde.
    return df


def _extract_tg_pct(val, bucket):
    """JSONB tg_dist'ten belirli bucket'ın pct'sini çıkarır."""
    if not val:
        return np.nan
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return np.nan
    if isinstance(val, dict):
        entry = val.get(bucket, {})
        if isinstance(entry, dict):
            return entry.get("pct", np.nan)
    return np.nan


def _extract_h2h_field(val, numerator_key, denominator_key):
    """H2H JSONB'den oran hesapla."""
    if not val:
        return np.nan
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return np.nan
    if isinstance(val, dict):
        total = val.get(denominator_key, 0)
        if total and total > 0:
            return val.get(numerator_key, 0) / total
    return np.nan


def _safe_json_get(val, key):
    """JSONB'den tek alan çek."""
    if not val:
        return np.nan
    if isinstance(val, str):
        try:
            val = json.loads(val)
        except (json.JSONDecodeError, TypeError):
            return np.nan
    if isinstance(val, dict):
        v = val.get(key)
        return v if v is not None else np.nan
    return np.nan


# ── Grup C: Rolling Takım İstatistikleri ──────────────────────────

def _add_rolling_features(df: pd.DataFrame) -> pd.DataFrame:
    """Takım bazlı rolling ortalamalar. shift(1) ile leakage-free."""

    # Skor parse edilmiş olmalı (_home_goals, _away_goals)
    # Her maçtan 2 satır: home perspective + away perspective
    home_rows = df[["match_code", "match_date", "home_team",
                     "_home_goals", "_away_goals",
                     "shots_home", "shots_away",
                     "shots_on_home", "shots_on_away",
                     "corners_home", "corners_away",
                     "possession_home", "possession_away",
                     "fouls_home", "fouls_away"]].copy()
    home_rows = home_rows.rename(columns={
        "home_team": "team",
        "_home_goals": "goals_scored", "_away_goals": "goals_conceded",
        "shots_home": "shots", "shots_away": "shots_against",
        "shots_on_home": "shots_on", "shots_on_away": "shots_on_against",
        "corners_home": "corners", "corners_away": "corners_against",
        "possession_home": "possession", "possession_away": "possession_against",
        "fouls_home": "fouls", "fouls_away": "fouls_against",
    })
    home_rows["perspective"] = "home"

    away_rows = df[["match_code", "match_date", "away_team",
                     "_away_goals", "_home_goals",
                     "shots_away", "shots_home",
                     "shots_on_away", "shots_on_home",
                     "corners_away", "corners_home",
                     "possession_away", "possession_home",
                     "fouls_away", "fouls_home"]].copy()
    away_rows = away_rows.rename(columns={
        "away_team": "team",
        "_away_goals": "goals_scored", "_home_goals": "goals_conceded",
        "shots_away": "shots", "shots_home": "shots_against",
        "shots_on_away": "shots_on", "shots_on_home": "shots_on_against",
        "corners_away": "corners", "corners_home": "corners_against",
        "possession_away": "possession", "possession_home": "possession_against",
        "fouls_away": "fouls", "fouls_home": "fouls_against",
    })
    away_rows["perspective"] = "away"

    team_df = pd.concat([home_rows, away_rows], ignore_index=True)
    team_df = team_df.sort_values(["team", "match_date"]).reset_index(drop=True)

    # Türev istatistikler
    team_df["shot_efficiency"] = (
        team_df["shots_on"] / team_df["shots"].replace(0, np.nan)
    )
    team_df["win"] = (team_df["goals_scored"] > team_df["goals_conceded"]).astype(float)
    team_df["clean_sheet"] = (team_df["goals_conceded"] == 0).astype(float)
    team_df["btts"] = (
        (team_df["goals_scored"] > 0) & (team_df["goals_conceded"] > 0)
    ).astype(float)

    # Rolling features
    roll_cols = [
        "goals_scored", "goals_conceded", "shots", "shots_on",
        "corners", "possession", "fouls",
        "shot_efficiency", "win", "clean_sheet", "btts",
    ]

    rolling_results = {}

    for window in ROLLING_WINDOWS:
        for col in roll_cols:
            feat_name = f"avg{window}_{col}"
            team_df[feat_name] = (
                team_df.groupby("team")[col]
                .transform(lambda s: s.rolling(window, min_periods=1).mean().shift(1))
            )
            rolling_results[feat_name] = True

    # Geri pivot: match_code × perspective → home/away features
    home_feats = team_df[team_df["perspective"] == "home"].copy()
    away_feats = team_df[team_df["perspective"] == "away"].copy()

    roll_feat_cols = [c for c in team_df.columns if c.startswith("avg")]

    home_rename = {c: f"home_{c}" for c in roll_feat_cols}
    away_rename = {c: f"away_{c}" for c in roll_feat_cols}

    home_feats = home_feats[["match_code"] + roll_feat_cols].rename(columns=home_rename)
    away_feats = away_feats[["match_code"] + roll_feat_cols].rename(columns=away_rename)

    df = df.merge(home_feats, on="match_code", how="left")
    df = df.merge(away_feats, on="match_code", how="left")

    # Fark features
    for window in ROLLING_WINDOWS:
        for col in ["goals_scored", "shots", "shots_on", "possession", "win"]:
            feat = f"avg{window}_{col}"
            df[f"diff{window}_{col}"] = df[f"home_{feat}"] - df[f"away_{feat}"]

    return df


# ── Grup D: Bağlamsal ─────────────────────────────────────────────

def _add_contextual_features(df: pd.DataFrame) -> pd.DataFrame:
    """Tarih ve lig bazlı features."""
    df["day_of_week"] = df["match_date"].dt.dayofweek  # 0=Pzt, 6=Paz
    df["month"] = df["match_date"].dt.month

    # League label encoding (frequency-based)
    league_counts = df["league"].value_counts()
    df["league_encoded"] = df["league"].map(league_counts).fillna(0)

    return df


# ═══════════════════════════════════════════════════════════════════
#  4. ANA PIPELINE
# ═══════════════════════════════════════════════════════════════════

def get_feature_columns(df: pd.DataFrame) -> list:
    """Model'e girecek feature sütunlarını belirle."""
    # Raw match_stats sütunları maç sonu istatistiği → leakage.
    # Sadece rolling türevleri (home_avg5_*, away_avg10_* vb.) kullanılabilir.
    from ml.config import STAT_COLUMNS_HOME, STAT_COLUMNS_AWAY
    raw_stats = tuple(STAT_COLUMNS_HOME + STAT_COLUMNS_AWAY)

    # Tüm H2H sütunları maç sonrası scrape → leakage.
    h2h_raw = (
        "form_home", "form_away", "form_home_score", "form_away_score", "form_diff",
        "standing_home", "standing_away", "standing_diff",
        "points_home", "points_away", "points_diff",
        "kg_pct_home", "kg_pct_away", "kg_pct_combined",
        "au25_over_pct_home", "au25_over_pct_away",
        "h2h_total", "h2h_total_matches", "h2h_home_win_pct", "h2h_draw_pct",
        "tg_dist_home", "tg_dist_away",
        "referee_stats", "scorers_home", "scorers_away",
    )

    exclude_prefixes = ("target_", "_", "id", "match_code", "home_team", "away_team",
                        "league", "season", "match_date", "score_ft", "score_ht",
                        "status", "scraped_at",
                        "tg_dist_",  # tg_dist_home_* türev feature'ları da dahil
                        ) + raw_stats + h2h_raw

    feature_cols = []
    for col in df.columns:
        if any(col.startswith(p) or col == p for p in exclude_prefixes):
            continue
        if df[col].dtype in [np.float64, np.int64, float, int, np.float32]:
            feature_cols.append(col)

    return sorted(feature_cols)


def build_features(df: pd.DataFrame = None) -> pd.DataFrame:
    """Tam feature pipeline: load → label → features → return."""
    if df is None:
        df = load_all_data()

    logger.info("🏷️  Label çıkarımı...")
    df = add_labels(df)

    logger.info("📊 Grup A: Oran features...")
    df = _add_odds_features(df)

    logger.info("🤝 Grup B: H2H features...")
    df = _add_h2h_features(df)

    logger.info("📈 Grup C: Rolling features...")
    df = _add_rolling_features(df)

    logger.info("🗓️  Grup D: Bağlamsal features...")
    df = _add_contextual_features(df)

    feature_cols = get_feature_columns(df)
    logger.info(f"✅ Feature engineering tamamlandı: {len(feature_cols)} feature")

    return df
