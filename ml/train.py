"""
Model egitimi + degerlendirme.

Her market icin ayri LightGBM modeli egitir.
Birincil metrik: Precision @ Confidence (tutan bet odakli).
Temporal split: train / val / test.
"""

import os
import json
import logging
from datetime import datetime

import numpy as np
import pandas as pd
import joblib
import lightgbm as lgb
from sklearn.metrics import log_loss, accuracy_score
from sklearn.calibration import calibration_curve

from config import supabase
from ml.config import (
    LGBM_PARAMS, EARLY_STOPPING_ROUNDS, MARKETS,
    TEST_MONTHS, VAL_MONTHS, ML_MODELS_DIR,
    CONFIDENCE_THRESHOLDS, TARGET_PRECISION, ODDS_COLUMNS,
)
from ml.features import build_features, get_feature_columns

logger = logging.getLogger("ml.train")


# ── Feature grup tanimlari (diagnostics icin) ────────────────────

ODDS_FEATURE_PREFIXES = ("imp_", "odds_", "ms_", "cs_", "iyms_", "au_", "kg_", "tg_")
ROLLING_FEATURE_PREFIXES = ("home_avg", "away_avg", "diff")
ELO_FEATURE_PREFIXES = ("elo_",)
REST_FEATURE_PREFIXES = ("rest_days_",)
CONTEXTUAL_FEATURES = ("day_of_week", "month", "league_encoded")


def _temporal_split(df: pd.DataFrame):
    """Tarih bazli train/val/test bol."""
    from dateutil.relativedelta import relativedelta

    df = df.sort_values("match_date").reset_index(drop=True)

    max_date = df["match_date"].max()
    test_start = max_date - relativedelta(months=TEST_MONTHS)
    val_start = test_start - relativedelta(months=VAL_MONTHS)

    train = df[df["match_date"] < val_start]
    val = df[(df["match_date"] >= val_start) & (df["match_date"] < test_start)]
    test = df[df["match_date"] >= test_start]

    logger.info(f"  Split -- Train: {len(train)}, Val: {len(val)}, Test: {len(test)}")
    logger.info(f"   Train: {train['match_date'].min()} -> {train['match_date'].max()}")
    logger.info(f"   Val:   {val['match_date'].min()} -> {val['match_date'].max()}")
    logger.info(f"   Test:  {test['match_date'].min()} -> {test['match_date'].max()}")

    return train, val, test


def _get_target_info(market: str) -> dict:
    """Market'e gore target sutunu ve model tipi."""
    return {
        "ms":   {"target": "target_ms",   "objective": "multiclass", "num_class": 3,  "labels": ["1", "X", "2"]},
        "kg":   {"target": "target_kg",   "objective": "binary",     "num_class": 2,  "labels": ["Yok", "Var"]},
        "au25": {"target": "target_au25", "objective": "binary",     "num_class": 2,  "labels": ["Alt", "Ust"]},
        "tg":   {"target": "target_tg",   "objective": "multiclass", "num_class": 4,  "labels": ["0-1", "2-3", "4-5", "6+"]},
        "iyms": {"target": "target_iyms", "objective": "multiclass", "num_class": 9,  "labels": ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"]},
    }[market]


def _brier_score(y_true, y_proba, num_class):
    """Brier score hesapla."""
    if num_class <= 2:
        return np.mean((y_proba - y_true) ** 2)
    else:
        one_hot = np.zeros((len(y_true), num_class))
        for i, val in enumerate(y_true):
            if not np.isnan(val):
                one_hot[i, int(val)] = 1
        return np.mean(np.sum((y_proba - one_hot) ** 2, axis=1))


# ── Precision @ Confidence (birincil metrik) ──────────────────────

def _precision_at_confidence(y_true, y_proba, num_class, thresholds=None):
    """Her confidence threshold icin precision, coverage ve pick sayisi hesapla.

    Multiclass: argmax class'in probability'si threshold'u asarsa pick sayilir.
    Binary: positive class probability'si threshold'u asarsa pick sayilir.
    """
    if thresholds is None:
        thresholds = CONFIDENCE_THRESHOLDS

    results = {}

    if num_class <= 2:
        # Binary: positive class probability
        pred_classes = (y_proba >= 0.5).astype(int)
        max_probs = np.where(y_proba >= 0.5, y_proba, 1 - y_proba)
    else:
        pred_classes = np.argmax(y_proba, axis=1)
        max_probs = np.max(y_proba, axis=1)

    y_arr = np.array(y_true, dtype=float)
    total = np.sum(~np.isnan(y_arr))

    for thr in thresholds:
        mask = (max_probs >= thr) & (~np.isnan(y_arr))
        n_picks = int(np.sum(mask))
        if n_picks == 0:
            results[thr] = {"n_picks": 0, "precision": 0.0, "coverage": 0.0}
            continue

        correct = np.sum(pred_classes[mask] == y_arr[mask].astype(int))
        precision = float(correct / n_picks)
        coverage = float(n_picks / total) if total > 0 else 0.0

        results[thr] = {
            "n_picks": n_picks,
            "precision": round(precision, 4),
            "coverage": round(coverage, 4),
        }

    return results


# ── Kalibrasyon ───────────────────────────────────────────────────

def _calibration_analysis(y_true, y_proba, num_class, n_bins=10):
    """Kalibrasyon analizi: bin bazli predicted vs actual, ECE hesabi."""
    bins = []
    y_arr = np.array(y_true, dtype=float)
    valid = ~np.isnan(y_arr)

    if num_class <= 2:
        # Binary: positive class
        probs = y_proba[valid]
        actuals = y_arr[valid].astype(int)
    else:
        # Multiclass: argmax class probability vs correct
        pred_classes = np.argmax(y_proba[valid], axis=1)
        probs = np.max(y_proba[valid], axis=1)
        actuals = (pred_classes == y_arr[valid].astype(int)).astype(int)

    ece = 0.0
    total_samples = len(probs)

    for i in range(n_bins):
        low = i / n_bins
        high = (i + 1) / n_bins
        mask = (probs >= low) & (probs < high)
        count = int(np.sum(mask))
        if count == 0:
            bins.append({
                "bracket": f"{int(low*100)}-{int(high*100)}%",
                "count": 0, "avg_predicted": 0.0, "avg_actual": 0.0, "diff": 0.0,
            })
            continue

        avg_pred = float(np.mean(probs[mask]))
        avg_actual = float(np.mean(actuals[mask]))
        diff = avg_actual - avg_pred
        ece += (count / total_samples) * abs(diff)

        bins.append({
            "bracket": f"{int(low*100)}-{int(high*100)}%",
            "count": count,
            "avg_predicted": round(avg_pred, 4),
            "avg_actual": round(avg_actual, 4),
            "diff": round(diff, 4),
        })

    return {"bins": bins, "ece": round(ece, 4)}


# ── Optimal threshold secimi ──────────────────────────────────────

def _select_threshold(precision_results: dict, market: str) -> dict:
    """Pazar icin optimal confidence threshold sec.

    precision >= target_precision olan en dusuk threshold'u sec (max coverage).
    Hicbiri hedefi tutmazsa en yuksek precision'li threshold'u sec.
    """
    target = TARGET_PRECISION.get(market, 0.60)

    best_above_target = None
    best_overall = None

    for thr, res in sorted(precision_results.items()):
        if res["n_picks"] == 0:
            continue

        if best_overall is None or res["precision"] > best_overall["precision"]:
            best_overall = {"threshold": thr, **res}

        if res["precision"] >= target and best_above_target is None:
            best_above_target = {"threshold": thr, **res}

    if best_above_target:
        return {**best_above_target, "target_precision": target, "met_target": True}

    if best_overall:
        return {**best_overall, "target_precision": target, "met_target": False}

    return {"threshold": 0.60, "n_picks": 0, "precision": 0.0, "coverage": 0.0,
            "target_precision": target, "met_target": False}


# ── Naive Odds Baseline (bahisciyi kopyaliyor mu testi) ──────────

def _naive_odds_baseline(df_test, market, num_class, thresholds=None):
    """Bahiscinin implied probability'sinden naive tahmin yap ve precision hesapla.

    Bu baseline, modelin eklenen degerini olcmek icin kullanilir.
    Eger model bu baseline'dan iyi degilse, bahisciyi kopyaliyor demektir.
    """
    if thresholds is None:
        thresholds = CONFIDENCE_THRESHOLDS

    imp_probs = _get_implied_probs(df_test, market, num_class)
    if imp_probs is None:
        return None

    target_col = _get_target_info(market)["target"]
    y_true = df_test[target_col].values

    results = {}

    if num_class <= 2:
        # Binary: imp_prob zaten positive class icin
        imp_arr = np.array(imp_probs, dtype=float)
        pred_classes = (imp_arr >= 0.5).astype(int)
        max_probs = np.where(imp_arr >= 0.5, imp_arr, 1 - imp_arr)
    else:
        # Multiclass: argmax — all-NaN satirlari handle et
        imp_arr = np.array(imp_probs, dtype=float)
        # All-NaN satirlar icin varsayilan degerler
        all_nan_mask = np.all(np.isnan(imp_arr), axis=1)
        pred_classes = np.zeros(len(imp_arr), dtype=int)
        max_probs = np.full(len(imp_arr), np.nan)

        valid_rows = ~all_nan_mask
        if np.any(valid_rows):
            pred_classes[valid_rows] = np.nanargmax(imp_arr[valid_rows], axis=1)
            max_probs[valid_rows] = np.nanmax(imp_arr[valid_rows], axis=1)

    y_arr = np.array(y_true, dtype=float)
    total = np.sum(~np.isnan(y_arr) & ~np.isnan(max_probs))

    for thr in thresholds:
        mask = (max_probs >= thr) & (~np.isnan(y_arr)) & (~np.isnan(max_probs))
        n_picks = int(np.sum(mask))
        if n_picks == 0:
            results[thr] = {"n_picks": 0, "precision": 0.0, "coverage": 0.0}
            continue

        correct = np.sum(pred_classes[mask] == y_arr[mask].astype(int))
        precision = float(correct / n_picks)
        coverage = float(n_picks / total) if total > 0 else 0.0

        results[thr] = {
            "n_picks": n_picks,
            "precision": round(precision, 4),
            "coverage": round(coverage, 4),
        }

    return results


def _compute_lift(model_prec: dict, baseline_prec: dict, threshold: float) -> float:
    """Model precision / baseline precision = lift."""
    m = model_prec.get(threshold, {}).get("precision", 0)
    b = baseline_prec.get(threshold, {}).get("precision", 0)
    if b <= 0:
        return float("inf") if m > 0 else 1.0
    return round(m / b, 4)


# ── Feature Importance Gruplama ──────────────────────────────────

def _group_feature_importance(feature_importances: pd.Series) -> dict:
    """Feature importance'i odds/rolling/elo/rest/contextual olarak grupla."""
    total = feature_importances.sum()
    if total == 0:
        return {"odds_derived": 0.0, "rolling_stats": 0.0, "elo": 0.0,
                "rest_days": 0.0, "contextual": 0.0, "other": 0.0}

    groups = {"odds_derived": 0, "rolling_stats": 0, "elo": 0,
              "rest_days": 0, "contextual": 0, "other": 0}

    for feat, imp in feature_importances.items():
        if any(feat.startswith(p) for p in ODDS_FEATURE_PREFIXES):
            groups["odds_derived"] += imp
        elif any(feat.startswith(p) for p in ROLLING_FEATURE_PREFIXES):
            groups["rolling_stats"] += imp
        elif any(feat.startswith(p) for p in ELO_FEATURE_PREFIXES):
            groups["elo"] += imp
        elif any(feat.startswith(p) for p in REST_FEATURE_PREFIXES):
            groups["rest_days"] += imp
        elif feat in CONTEXTUAL_FEATURES:
            groups["contextual"] += imp
        else:
            groups["other"] += imp

    return {k: round(v / total, 4) for k, v in groups.items()}


# ── Implied probs & real odds (bilgilendirici) ────────────────────

def _get_implied_probs(df_subset, market, num_class):
    """Market'e uygun implied probability dizisi."""
    if market == "ms":
        cols = ["imp_ms_1_norm", "imp_ms_x_norm", "imp_ms_2_norm"]
        return df_subset[cols].values
    elif market == "kg":
        return df_subset["imp_kg_var"].values
    elif market == "au25":
        return df_subset["imp_au_25_ust"].values
    elif market == "tg":
        cols = ["imp_tg_0_1_norm", "imp_tg_2_3_norm", "imp_tg_4_5_norm", "imp_tg_6_plus_norm"]
        return df_subset[cols].values
    elif market == "iyms":
        cols = ["imp_iyms_11_norm", "imp_iyms_1x_norm", "imp_iyms_12_norm",
                "imp_iyms_x1_norm", "imp_iyms_xx_norm", "imp_iyms_x2_norm",
                "imp_iyms_21_norm", "imp_iyms_2x_norm", "imp_iyms_22_norm"]
        return df_subset[cols].values
    return None


def _get_real_odds(df_subset, market, num_class):
    """Gercek bahis oranlari (bilgilendirici ROI hesabi icin)."""
    if market == "ms":
        return df_subset[["ms_1", "ms_x", "ms_2"]].values
    elif market == "kg":
        return df_subset["kg_var"].values
    elif market == "au25":
        return df_subset["au_25_ust"].values
    elif market == "tg":
        return df_subset[["tg_0_1", "tg_2_3", "tg_4_5", "tg_6_plus"]].values
    elif market == "iyms":
        return df_subset[["iyms_11", "iyms_1x", "iyms_12",
                          "iyms_x1", "iyms_xx", "iyms_x2",
                          "iyms_21", "iyms_2x", "iyms_22"]].values
    return None


# ── Model egitimi ─────────────────────────────────────────────────

def train_single_model(market: str, df: pd.DataFrame, feature_cols: list) -> dict:
    """Tek market icin model egit ve degerlendir."""
    info = _get_target_info(market)
    target_col = info["target"]
    objective = info["objective"]
    num_class = info["num_class"]

    valid = df[df[target_col].notna()].copy()
    logger.info(f"\n{'='*60}")
    logger.info(f"  Market: {market.upper()} | Hedef: {target_col} | Satir: {len(valid)}")

    if len(valid) < 1000:
        logger.warning(f"  Yetersiz veri ({len(valid)} satir), atlaniyor.")
        return None

    train, val, test = _temporal_split(valid)

    X_train = train[feature_cols]
    y_train = train[target_col].astype(int)
    X_val = val[feature_cols]
    y_val = val[target_col].astype(int)
    X_test = test[feature_cols]
    y_test = test[target_col].astype(int)

    # LightGBM parametreleri
    params = LGBM_PARAMS.copy()
    params["objective"] = objective
    if objective == "multiclass":
        params["num_class"] = num_class
        params["metric"] = "multi_logloss"
        if num_class >= 4:
            params["is_unbalance"] = True
    else:
        params["metric"] = "binary_logloss"

    # Egitim
    model = lgb.LGBMClassifier(**params)
    model.fit(
        X_train, y_train,
        eval_set=[(X_val, y_val)],
        callbacks=[
            lgb.early_stopping(EARLY_STOPPING_ROUNDS),
            lgb.log_evaluation(50),
        ],
    )

    # Tahmin
    y_proba = model.predict_proba(X_test)
    y_pred = model.predict(X_test)

    # Temel metrikler
    ll = log_loss(y_test, y_proba)
    acc = accuracy_score(y_test, y_pred)

    if objective == "binary":
        y_proba_eval = y_proba[:, 1]
        brier = _brier_score(y_test, y_proba_eval, num_class=2)
    else:
        y_proba_eval = y_proba
        brier = _brier_score(y_test, y_proba, num_class)

    # Birincil metrik: Precision @ Confidence
    prec_results = _precision_at_confidence(y_test, y_proba_eval, num_class)

    # Optimal threshold secimi
    threshold_info = _select_threshold(prec_results, market)

    # Kalibrasyon analizi
    calib = _calibration_analysis(y_test, y_proba_eval, num_class)

    # Feature importance (top 20 + full for gruplama)
    full_importance = pd.Series(
        model.feature_importances_, index=feature_cols
    ).sort_values(ascending=False)
    importance = full_importance.head(20)

    # ── Baseline karsilastirma (bahisciyi kopyaliyor mu?) ─────────
    baseline_prec = _naive_odds_baseline(test, market, num_class)
    selected_thr = threshold_info["threshold"]
    lift = _compute_lift(prec_results, baseline_prec, selected_thr) if baseline_prec else None

    # ── Feature importance gruplama ───────────────────────────────
    feat_groups = _group_feature_importance(full_importance)

    # Diagnostics
    diagnostics = {
        "selected_threshold": selected_thr,
        "model_precision": threshold_info.get("precision", 0),
        "baseline_precision": baseline_prec.get(selected_thr, {}).get("precision", 0) if baseline_prec else None,
        "lift": lift,
        "feature_group_importance": feat_groups,
        "baseline_at_thresholds": {str(k): v for k, v in baseline_prec.items()} if baseline_prec else None,
    }

    metrics = {
        "log_loss": round(ll, 4),
        "accuracy": round(acc, 4),
        "brier_score": round(brier, 4),
        "precision_at_confidence": {str(k): v for k, v in prec_results.items()},
        "selected_threshold": threshold_info,
        "calibration": calib,
        "feature_importance": {k: int(v) for k, v in importance.items()},
        "best_iteration": model.best_iteration_ if hasattr(model, "best_iteration_") else None,
        "diagnostics": diagnostics,
    }

    # Konsol ciktisi
    logger.info(f"  Sonuclar:")
    logger.info(f"   Log Loss:    {metrics['log_loss']}")
    logger.info(f"   Accuracy:    {metrics['accuracy']}")
    logger.info(f"   Brier Score: {metrics['brier_score']}")
    logger.info(f"   ECE:         {calib['ece']}")
    logger.info(f"")
    logger.info(f"   Precision @ Confidence Thresholds:")
    for thr, res in sorted(prec_results.items()):
        if res["n_picks"] > 0:
            logger.info(f"     >= {thr:.0%}: {res['precision']:.1%} precision, {res['n_picks']} pick ({res['coverage']:.0%} coverage)")
    logger.info(f"")
    thr_info = threshold_info
    logger.info(f"   Secilen Threshold: {thr_info['threshold']:.0%} "
                f"(precision={thr_info['precision']:.1%}, coverage={thr_info['coverage']:.0%}, "
                f"hedef={'TUTTU' if thr_info['met_target'] else 'TUTMADI'})")
    logger.info(f"   Top 5 Feature: {list(importance.head(5).index)}")

    # Baseline karsilastirma ciktisi
    logger.info(f"")
    logger.info(f"   ── BASELINE KARSILASTIRMA ──")
    if baseline_prec:
        bp = baseline_prec.get(selected_thr, {})
        logger.info(f"   Naive Odds Baseline @ {selected_thr:.0%}: "
                     f"precision={bp.get('precision', 0):.1%}, picks={bp.get('n_picks', 0)}")
        if lift is not None:
            emoji = "✅" if lift > 1.05 else ("⚠️" if lift >= 0.95 else "❌")
            logger.info(f"   Lift: {lift:.3f} {emoji}")
            if lift <= 1.05:
                logger.info(f"   ⚠️  Model bahisciyi kopyaliyor olabilir!")
    else:
        logger.info(f"   Baseline hesaplanamadi (implied prob eksik)")

    logger.info(f"")
    logger.info(f"   ── FEATURE GRUPLAMA ──")
    logger.info(f"   Odds-derived:  {feat_groups['odds_derived']:.1%}")
    logger.info(f"   Rolling stats: {feat_groups['rolling_stats']:.1%}")
    logger.info(f"   Contextual:    {feat_groups['contextual']:.1%}")
    if feat_groups.get('other', 0) > 0:
        logger.info(f"   Other:         {feat_groups['other']:.1%}")
    if feat_groups['odds_derived'] > 0.80:
        logger.info(f"   ⚠️  Odds features baskin (>%80), model buyuk olcude bahisciyi kopyaliyor!")

    return {
        "model": model,
        "metrics": metrics,
        "train_size": len(train),
        "test_size": len(test),
        "threshold_info": threshold_info,
        "calibration": calib,
        "diagnostics": diagnostics,
    }


def train_all_models():
    """Tum marketler icin modelleri egit, kaydet, raporla."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    logger.info("  ML Model egitimi basliyor...")

    # Feature engineering
    df = build_features()
    feature_cols = get_feature_columns(df)

    logger.info(f"  Feature sutunlari: {len(feature_cols)}")

    # Model versiyonu
    model_version = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    os.makedirs(ML_MODELS_DIR, exist_ok=True)

    all_metrics = {}
    all_results = {}
    all_thresholds = {}
    all_calibration = {}
    all_diagnostics = {}

    for market in MARKETS:
        result = train_single_model(market, df, feature_cols)
        if result is None:
            continue

        # Model kaydet
        model_path = os.path.join(ML_MODELS_DIR, f"{market}_model.pkl")
        joblib.dump(result["model"], model_path)
        logger.info(f"  Model kaydedildi: {model_path}")

        all_metrics[market] = result["metrics"]
        all_results[market] = result
        all_thresholds[market] = result["threshold_info"]
        all_calibration[market] = result["calibration"]
        all_diagnostics[market] = result.get("diagnostics", {})

    # Feature sutunlarini kaydet
    feature_path = os.path.join(ML_MODELS_DIR, "feature_cols.pkl")
    joblib.dump(feature_cols, feature_path)

    # Model version
    version_path = os.path.join(ML_MODELS_DIR, "model_version.txt")
    with open(version_path, "w") as f:
        f.write(model_version)

    # Threshold'lari kaydet
    thresholds_path = os.path.join(ML_MODELS_DIR, "thresholds.json")
    with open(thresholds_path, "w") as f:
        # float key'leri string'e cevir
        serializable = {}
        for market, info in all_thresholds.items():
            serializable[market] = {k: (round(v, 4) if isinstance(v, float) else v)
                                     for k, v in info.items()}
        json.dump(serializable, f, indent=2, ensure_ascii=False)
    logger.info(f"  Threshold'lar kaydedildi: {thresholds_path}")

    # Kalibrasyon verilerini kaydet
    calib_path = os.path.join(ML_MODELS_DIR, "calibration.json")
    with open(calib_path, "w") as f:
        json.dump(all_calibration, f, indent=2, ensure_ascii=False)

    # Diagnostics kaydet (baseline karsilastirma + feature gruplama)
    diag_path = os.path.join(ML_MODELS_DIR, "diagnostics.json")
    with open(diag_path, "w") as f:
        json.dump(all_diagnostics, f, indent=2, ensure_ascii=False)
    logger.info(f"  Diagnostics kaydedildi: {diag_path}")

    # Supabase'e model run kaydi
    try:
        first_result = next(iter(all_results.values()), {})
        run_data = {
            "model_version": model_version,
            "train_size": first_result.get("train_size", 0),
            "test_size": first_result.get("test_size", 0),
            "metrics": json.dumps(all_metrics, ensure_ascii=False),
            "feature_count": len(feature_cols),
            "notes": f"Markets: {', '.join(all_metrics.keys())} | Precision-focused",
        }
        supabase.table("ml_model_runs").upsert(
            run_data, on_conflict="model_version"
        ).execute()
        logger.info(f"  Model run kaydedildi: {model_version}")
    except Exception as e:
        logger.warning(f"  Model run DB kaydi basarisiz: {e}")

    # Ozet
    logger.info(f"\n{'='*60}")
    logger.info(f"  EGITIM TAMAMLANDI -- {model_version}")
    logger.info(f"   Marketler: {list(all_metrics.keys())}")
    for m, met in all_metrics.items():
        thr = all_thresholds.get(m, {})
        diag = all_diagnostics.get(m, {})
        lift_val = diag.get("lift")
        lift_str = f", Lift={lift_val:.3f}" if lift_val is not None else ""
        logger.info(
            f"   {m.upper():5s} -> Acc={met['accuracy']}, "
            f"Threshold={thr.get('threshold', '?')}, "
            f"Precision={thr.get('precision', '?')}, "
            f"Picks={thr.get('n_picks', 0)}{lift_str}"
        )

    # Diagnostics ozet tablosu
    logger.info(f"\n{'='*60}")
    logger.info(f"  DIAGNOSTICS OZET")
    logger.info(f"  {'Market':6s} {'Model%':>8s} {'Baseline%':>10s} {'Lift':>8s} {'Odds%':>8s} {'Rolling%':>10s} {'ELO%':>6s} {'Rest%':>6s}")
    logger.info(f"  {'-'*66}")
    for m, diag in all_diagnostics.items():
        mp = f"{diag.get('model_precision', 0):.1%}"
        bp = f"{diag.get('baseline_precision', 0):.1%}" if diag.get('baseline_precision') is not None else "N/A"
        lf = f"{diag.get('lift', 0):.3f}" if diag.get('lift') is not None else "N/A"
        fg = diag.get("feature_group_importance", {})
        od = f"{fg.get('odds_derived', 0):.1%}"
        rs = f"{fg.get('rolling_stats', 0):.1%}"
        el = f"{fg.get('elo', 0):.1%}"
        rd = f"{fg.get('rest_days', 0):.1%}"
        logger.info(f"  {m.upper():6s} {mp:>8s} {bp:>10s} {lf:>8s} {od:>8s} {rs:>10s} {el:>6s} {rd:>6s}")

    return all_metrics


if __name__ == "__main__":
    train_all_models()
