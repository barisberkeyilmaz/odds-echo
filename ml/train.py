"""
Model eğitimi + değerlendirme.

Her market için ayrı LightGBM modeli eğitir.
Temporal split: train %80, val %10, test %10.
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

from config import supabase
from ml.config import (
    LGBM_PARAMS, EARLY_STOPPING_ROUNDS, MARKETS,
    TRAIN_RATIO, VAL_RATIO, MIN_EDGE, ML_MODELS_DIR,
)
from ml.features import build_features, get_feature_columns

logger = logging.getLogger("ml.train")


def _temporal_split(df: pd.DataFrame):
    """Zamana göre train/val/test böl."""
    df = df.sort_values("match_date").reset_index(drop=True)
    n = len(df)
    train_end = int(n * TRAIN_RATIO)
    val_end = int(n * (TRAIN_RATIO + VAL_RATIO))

    train = df.iloc[:train_end]
    val = df.iloc[train_end:val_end]
    test = df.iloc[val_end:]

    logger.info(f"📊 Split — Train: {len(train)}, Val: {len(val)}, Test: {len(test)}")
    logger.info(f"   Train: {train['match_date'].min()} → {train['match_date'].max()}")
    logger.info(f"   Val:   {val['match_date'].min()} → {val['match_date'].max()}")
    logger.info(f"   Test:  {test['match_date'].min()} → {test['match_date'].max()}")

    return train, val, test


def _get_target_info(market: str) -> dict:
    """Market'e göre target sütunu ve model tipi."""
    return {
        "ms":   {"target": "target_ms",   "objective": "multiclass", "num_class": 3, "labels": ["Ev", "Beraberlik", "Deplasman"]},
        "kg":   {"target": "target_kg",   "objective": "binary",     "num_class": 1, "labels": ["Yok", "Var"]},
        "au25": {"target": "target_au25", "objective": "binary",     "num_class": 1, "labels": ["Alt", "Üst"]},
        "tg":   {"target": "target_tg",   "objective": "multiclass", "num_class": 3, "labels": ["0-1", "2-3", "4+"]},
        "iy":   {"target": "target_iy",   "objective": "multiclass", "num_class": 3, "labels": ["Ev", "Beraberlik", "Deplasman"]},
    }[market]


def _brier_score(y_true, y_proba, num_class):
    """Brier score hesapla."""
    if num_class <= 2:
        # Binary
        return np.mean((y_proba - y_true) ** 2)
    else:
        # Multi-class: one-hot
        one_hot = np.zeros((len(y_true), num_class))
        for i, val in enumerate(y_true):
            if not np.isnan(val):
                one_hot[i, int(val)] = 1
        return np.mean(np.sum((y_proba - one_hot) ** 2, axis=1))


def _roi_simulation(y_true, y_proba, implied_probs, num_class, min_edge=MIN_EDGE):
    """Model prob > implied prob + edge ise bahis simülasyonu."""
    total_bets = 0
    total_return = 0.0

    if num_class <= 2:
        # Binary: y_proba = array of P(1)
        for i in range(len(y_true)):
            if np.isnan(y_true.iloc[i]) if hasattr(y_true, 'iloc') else np.isnan(y_true[i]):
                continue
            model_p = y_proba[i]
            imp_p = implied_probs[i] if i < len(implied_probs) else np.nan
            if np.isnan(imp_p):
                continue
            if model_p > imp_p + min_edge:
                total_bets += 1
                actual = int(y_true.iloc[i] if hasattr(y_true, 'iloc') else y_true[i])
                if actual == 1:
                    total_return += (1.0 / imp_p) - 1  # Net profit
                else:
                    total_return -= 1  # Lost stake
    else:
        # Multi-class
        for i in range(len(y_true)):
            yi = y_true.iloc[i] if hasattr(y_true, 'iloc') else y_true[i]
            if np.isnan(yi):
                continue
            for cls in range(num_class):
                model_p = y_proba[i, cls]
                imp_p = implied_probs[i, cls] if i < len(implied_probs) else np.nan
                if np.isnan(imp_p):
                    continue
                if model_p > imp_p + min_edge:
                    total_bets += 1
                    if int(yi) == cls:
                        total_return += (1.0 / imp_p) - 1
                    else:
                        total_return -= 1

    roi = (total_return / total_bets * 100) if total_bets > 0 else 0.0
    return {"total_bets": total_bets, "total_return": round(total_return, 2), "roi_pct": round(roi, 2)}


def _get_implied_probs(df_subset, market, num_class):
    """Market'e uygun implied probability dizisi."""
    if market == "ms":
        cols = ["imp_ms_1_norm", "imp_ms_x_norm", "imp_ms_2_norm"]
        arr = df_subset[cols].values  # (n, 3)
        return arr
    elif market == "kg":
        return df_subset["imp_kg_var"].values
    elif market == "au25":
        return df_subset["imp_au_25_ust"].values
    elif market == "tg":
        # tg_0_1, tg_2_3, tg_4_5+tg_6_plus → 3 class
        imp_01 = 1.0 / df_subset["tg_0_1"].replace(0, np.nan)
        imp_23 = 1.0 / df_subset["tg_2_3"].replace(0, np.nan)
        imp_4p = 1.0 / (df_subset["tg_4_5"].replace(0, np.nan))  # Approximate
        total = imp_01 + imp_23 + imp_4p
        arr = np.column_stack([imp_01 / total, imp_23 / total, imp_4p / total])
        return arr
    elif market == "iy":
        # İY oranları doğrudan yok, IYMS'den türet
        # iyms_11 + iyms_1x + iyms_12 → P(IY=home)
        imp_cols = {
            "iy_home": ["iyms_11", "iyms_1x", "iyms_12"],
            "iy_draw": ["iyms_x1", "iyms_xx", "iyms_x2"],
            "iy_away": ["iyms_21", "iyms_2x", "iyms_22"],
        }
        probs = {}
        for key, cols in imp_cols.items():
            # Her iyms oranı 1/o → implied prob, sonra topla
            imp_sum = sum(1.0 / df_subset[c].replace(0, np.nan) for c in cols)
            probs[key] = imp_sum
        total = probs["iy_home"] + probs["iy_draw"] + probs["iy_away"]
        arr = np.column_stack([
            probs["iy_home"] / total,
            probs["iy_draw"] / total,
            probs["iy_away"] / total,
        ])
        return arr
    return None


def train_single_model(market: str, df: pd.DataFrame, feature_cols: list) -> dict:
    """Tek market için model eğit ve değerlendir."""
    info = _get_target_info(market)
    target_col = info["target"]
    objective = info["objective"]
    num_class = info["num_class"]

    # Target NaN olmayan satırlar
    valid = df[df[target_col].notna()].copy()
    logger.info(f"\n{'='*60}")
    logger.info(f"🎯 Market: {market.upper()} | Hedef: {target_col} | Satır: {len(valid)}")

    if len(valid) < 1000:
        logger.warning(f"⚠️  Yetersiz veri ({len(valid)} satır), atlanıyor.")
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
    else:
        params["metric"] = "binary_logloss"

    # Eğitim
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

    # Metrikler
    if objective == "binary":
        y_proba_pos = y_proba[:, 1]
        ll = log_loss(y_test, y_proba)
        acc = accuracy_score(y_test, y_pred)
        brier = _brier_score(y_test, y_proba_pos, num_class=2)
        impl_probs = _get_implied_probs(test, market, num_class=2)
        roi_info = _roi_simulation(y_test, y_proba_pos, impl_probs, num_class=2)
    else:
        ll = log_loss(y_test, y_proba)
        acc = accuracy_score(y_test, y_pred)
        brier = _brier_score(y_test, y_proba, num_class)
        impl_probs = _get_implied_probs(test, market, num_class)
        roi_info = _roi_simulation(y_test, y_proba, impl_probs, num_class)

    # Feature importance (top 20)
    importance = pd.Series(
        model.feature_importances_, index=feature_cols
    ).sort_values(ascending=False).head(20)

    metrics = {
        "log_loss": round(ll, 4),
        "accuracy": round(acc, 4),
        "brier_score": round(brier, 4),
        "roi_simulation": roi_info,
        "feature_importance": {k: int(v) for k, v in importance.items()},
        "best_iteration": model.best_iteration_ if hasattr(model, "best_iteration_") else None,
    }

    # Konsol çıktısı
    logger.info(f"📈 Sonuçlar:")
    logger.info(f"   Log Loss:    {metrics['log_loss']}")
    logger.info(f"   Accuracy:    {metrics['accuracy']}")
    logger.info(f"   Brier Score: {metrics['brier_score']}")
    logger.info(f"   ROI Sim:     {roi_info['roi_pct']}% ({roi_info['total_bets']} bahis)")
    logger.info(f"   Top 5 Feature: {list(importance.head(5).index)}")

    return {
        "model": model,
        "metrics": metrics,
        "train_size": len(train),
        "test_size": len(test),
    }


def train_all_models():
    """Tüm marketler için modelleri eğit, kaydet, raporla."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    logger.info("🚀 ML Model eğitimi başlıyor...")

    # Feature engineering
    df = build_features()
    feature_cols = get_feature_columns(df)

    logger.info(f"📋 Feature sütunları: {len(feature_cols)}")

    # Model versiyonu
    model_version = f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    os.makedirs(ML_MODELS_DIR, exist_ok=True)

    all_metrics = {}

    for market in MARKETS:
        result = train_single_model(market, df, feature_cols)
        if result is None:
            continue

        # Model kaydet
        model_path = os.path.join(ML_MODELS_DIR, f"{market}_model.pkl")
        joblib.dump(result["model"], model_path)
        logger.info(f"💾 Model kaydedildi: {model_path}")

        all_metrics[market] = result["metrics"]

    # Feature sütunlarını kaydet
    feature_path = os.path.join(ML_MODELS_DIR, "feature_cols.pkl")
    joblib.dump(feature_cols, feature_path)
    logger.info(f"💾 Feature sütunları kaydedildi: {feature_path}")

    # Model version bilgisini kaydet
    version_path = os.path.join(ML_MODELS_DIR, "model_version.txt")
    with open(version_path, "w") as f:
        f.write(model_version)

    # Supabase'e model run kaydı
    try:
        run_data = {
            "model_version": model_version,
            "train_size": int(len(df) * TRAIN_RATIO),
            "test_size": int(len(df) * (1 - TRAIN_RATIO - VAL_RATIO)),
            "metrics": json.dumps(all_metrics, ensure_ascii=False),
            "feature_count": len(feature_cols),
            "notes": f"Markets: {', '.join(all_metrics.keys())}",
        }
        supabase.table("ml_model_runs").upsert(
            run_data, on_conflict="model_version"
        ).execute()
        logger.info(f"✅ Model run kaydedildi: {model_version}")
    except Exception as e:
        logger.warning(f"⚠️  Model run DB kaydı başarısız: {e}")

    # Özet
    logger.info(f"\n{'='*60}")
    logger.info(f"🏁 EĞİTİM TAMAMLANDI — {model_version}")
    logger.info(f"   Marketler: {list(all_metrics.keys())}")
    for m, met in all_metrics.items():
        logger.info(f"   {m.upper():5s} → LogLoss={met['log_loss']}, Acc={met['accuracy']}, ROI={met['roi_simulation']['roi_pct']}%")

    return all_metrics
