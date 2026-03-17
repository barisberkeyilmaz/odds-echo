"""
ML Pipeline sabitleri ve konfigürasyonu.
"""

# ── Rolling pencere boyutları ──────────────────────────────────────
ROLLING_WINDOWS = [5, 10]

# ── LightGBM parametreleri ─────────────────────────────────────────
LGBM_PARAMS = {
    "learning_rate": 0.05,
    "num_leaves": 31,
    "max_depth": 6,
    "min_child_samples": 50,
    "subsample": 0.8,
    "colsample_bytree": 0.8,
    "reg_alpha": 0.1,
    "reg_lambda": 1.0,
    "n_estimators": 500,
    "verbose": -1,
}

EARLY_STOPPING_ROUNDS = 50

# ── Bahis marketleri ───────────────────────────────────────────────
MARKETS = ["ms", "kg", "au25", "tg", "iy"]

# ── Value bet eşiği ───────────────────────────────────────────────
MIN_EDGE = 0.05

# ── Temporal split (tarih bazlı) ──────────────────────────────────
# Test: son TEST_MONTHS ay, Val: ondan önceki VAL_MONTHS ay, Train: geri kalan
TEST_MONTHS = 6
VAL_MONTHS = 2

# ── Supabase pagination ───────────────────────────────────────────
PAGE_SIZE = 1000

# ── Model dizini ──────────────────────────────────────────────────
import os

ML_MODELS_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "ml_models")

# ── Oran sütunları (matches tablosundaki) ─────────────────────────
ODDS_COLUMNS = [
    "ms_1", "ms_x", "ms_2",
    "cs_1x", "cs_12", "cs_x2",
    "iyms_11", "iyms_1x", "iyms_12",
    "iyms_x1", "iyms_xx", "iyms_x2",
    "iyms_21", "iyms_2x", "iyms_22",
    "au_15_alt", "au_15_ust",
    "au_25_alt", "au_25_ust",
    "kg_var", "kg_yok",
    "tg_0_1", "tg_2_3", "tg_4_5", "tg_6_plus",
]

# ── match_stats sütunları ─────────────────────────────────────────
STAT_COLUMNS_HOME = [
    "shots_home", "shots_on_home", "corners_home",
    "possession_home", "fouls_home", "offsides_home",
]
STAT_COLUMNS_AWAY = [
    "shots_away", "shots_on_away", "corners_away",
    "possession_away", "fouls_away", "offsides_away",
]
