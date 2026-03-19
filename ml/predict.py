"""
Tahmin uretimi -- upcoming fixtures ve retrospektif backtest.

Egitilmis modelleri yukler, feature'lari hesaplar,
confident pick sinyalleri uretir ve ml_predictions tablosuna yazar.
"""

import os
import json
import logging
import re
from datetime import datetime

import numpy as np
import pandas as pd
import joblib

from config import supabase
from ml.config import MARKETS, ML_MODELS_DIR, PAGE_SIZE, CONFIDENCE_LEVEL_OFFSETS
from ml.features import build_features, get_feature_columns, load_all_data

logger = logging.getLogger("ml.predict")

# ---------------------------------------------------------------------------
# Ortak yardimci fonksiyonlar
# ---------------------------------------------------------------------------

SCORE_RE = re.compile(r"\d+\s*[-:]\s*\d+")


def _load_models() -> dict:
    """Kaydedilmis modelleri yukle."""
    models = {}
    for market in MARKETS:
        path = os.path.join(ML_MODELS_DIR, f"{market}_model.pkl")
        if os.path.exists(path):
            models[market] = joblib.load(path)
            logger.info(f"  {market} modeli yuklendi")
        else:
            logger.warning(f"  {market} modeli bulunamadi: {path}")
    return models


def _load_feature_cols() -> list:
    """Feature sutun listesini yukle."""
    path = os.path.join(ML_MODELS_DIR, "feature_cols.pkl")
    if os.path.exists(path):
        return joblib.load(path)
    raise FileNotFoundError(f"Feature sutunlari bulunamadi: {path}")


def _load_model_version() -> str:
    """Model versiyonunu yukle."""
    path = os.path.join(ML_MODELS_DIR, "model_version.txt")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def _load_thresholds() -> dict:
    """Pazar bazli confidence threshold'larini yukle."""
    path = os.path.join(ML_MODELS_DIR, "thresholds.json")
    if os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    logger.warning("  thresholds.json bulunamadi, varsayilan degerler kullanilacak.")
    return {}


def _get_implied_prob(row, market, outcome_idx):
    """Tek satir icin implied probability hesapla."""
    try:
        if market == "ms":
            cols = ["imp_ms_1_norm", "imp_ms_x_norm", "imp_ms_2_norm"]
            return row.get(cols[outcome_idx], np.nan)
        elif market == "kg":
            return row.get("imp_kg_var", np.nan) if outcome_idx == 1 else row.get("imp_kg_yok", np.nan)
        elif market == "au25":
            return row.get("imp_au_25_ust", np.nan) if outcome_idx == 1 else row.get("imp_au_25_alt", np.nan)
        elif market == "tg":
            cols = ["imp_tg_0_1_norm", "imp_tg_2_3_norm", "imp_tg_4_5_norm", "imp_tg_6_plus_norm"]
            return row.get(cols[outcome_idx], np.nan) if outcome_idx < len(cols) else np.nan
        elif market == "iyms":
            cols = ["imp_iyms_11_norm", "imp_iyms_1x_norm", "imp_iyms_12_norm",
                    "imp_iyms_x1_norm", "imp_iyms_xx_norm", "imp_iyms_x2_norm",
                    "imp_iyms_21_norm", "imp_iyms_2x_norm", "imp_iyms_22_norm"]
            return row.get(cols[outcome_idx], np.nan) if outcome_idx < len(cols) else np.nan
    except Exception:
        return np.nan
    return np.nan


def _market_labels(market: str) -> list:
    """Market sonuc etiketleri."""
    return {
        "ms": ["1", "X", "2"],
        "kg": ["Yok", "Var"],
        "au25": ["Alt", "Ust"],
        "tg": ["0-1", "2-3", "4-5", "6+"],
        "iyms": ["1/1", "1/X", "1/2", "X/1", "X/X", "X/2", "2/1", "2/X", "2/2"],
    }[market]


def _get_confidence_level(confidence: float, threshold: float) -> str:
    """Confidence degerine gore seviye belirle."""
    for level, offset in sorted(CONFIDENCE_LEVEL_OFFSETS.items(),
                                  key=lambda x: x[1], reverse=True):
        if confidence >= threshold + offset:
            return level
    return None


def _predict_and_write(target_df, models, feature_cols, model_version, thresholds, label):
    """Ortak tahmin + DB yazma mantigi."""
    total_predictions = 0
    total_confident = 0

    for market, model in models.items():
        labels = _market_labels(market)
        num_classes = len(labels)

        mkt_threshold = thresholds.get(market, {})
        threshold_val = mkt_threshold.get("threshold", 0.60)

        X = target_df.reindex(columns=feature_cols)

        try:
            proba = model.predict_proba(X)
        except Exception as e:
            logger.error(f"  {market} tahmin hatasi: {e}")
            continue

        predictions = []
        for idx, (_, row) in enumerate(target_df.iterrows()):
            prob_dict = {labels[i]: round(float(proba[idx, i]), 4) for i in range(num_classes)}

            best_idx = int(np.argmax(proba[idx]))
            predicted_outcome = labels[best_idx]
            confidence = float(proba[idx, best_idx])

            confident_picks = []
            conf_level = _get_confidence_level(confidence, threshold_val)
            if conf_level:
                impl_p = _get_implied_prob(row, market, best_idx)
                pick = {
                    "outcome": predicted_outcome,
                    "confidence": round(confidence, 4),
                    "threshold": threshold_val,
                    "confidence_level": conf_level,
                    "implied_prob": round(float(impl_p), 4) if not np.isnan(impl_p) else None,
                }
                confident_picks.append(pick)

            pred_row = {
                "match_code": row["match_code"],
                "market": market,
                "probabilities": json.dumps(prob_dict, ensure_ascii=False),
                "predicted_outcome": predicted_outcome,
                "confidence": round(confidence, 4),
                "confident_picks": json.dumps(confident_picks, ensure_ascii=False) if confident_picks else None,
                "model_version": model_version,
            }
            predictions.append(pred_row)
            total_confident += len(confident_picks)

        # Toplu upsert (500'lik batch'ler halinde)
        if predictions:
            batch_size = 500
            for i in range(0, len(predictions), batch_size):
                batch = predictions[i:i + batch_size]
                try:
                    supabase.table("ml_predictions").upsert(
                        batch,
                        on_conflict="match_code,market,model_version",
                    ).execute()
                except Exception as e:
                    logger.error(f"  {market} DB yazim hatasi (batch {i}): {e}")

            total_predictions += len(predictions)
            cp_count = sum(1 for p in predictions if p["confident_picks"])
            logger.info(f"  {market.upper()}: {len(predictions)} tahmin, {cp_count} emin tahmin")

    logger.info(f"\n{'='*60}")
    logger.info(f"  {label} TAMAMLANDI")
    logger.info(f"   Toplam tahmin: {total_predictions}")
    logger.info(f"   Emin tahmin sinyali: {total_confident}")
    logger.info(f"   Model versiyonu: {model_version}")


# ---------------------------------------------------------------------------
# Upcoming predict (mevcut islevsellik)
# ---------------------------------------------------------------------------

def _fetch_upcoming_match_codes() -> list:
    """Gelecek maclarin match_code'larini getir."""
    now = datetime.now().isoformat()
    codes = []
    offset = 0
    while True:
        resp = (
            supabase.table("matches")
            .select("match_code")
            .gte("match_date", now)
            .order("match_date")
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data
        if not batch:
            break
        codes.extend([r["match_code"] for r in batch])
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return codes


def predict_upcoming():
    """Hem gelecek hem oyanmis maclar icin tahmin uret ve DB'ye yaz."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("  Tahmin uretimi basliyor...")

    models = _load_models()
    if not models:
        logger.error("  Hic model bulunamadi. Once train-models calistirin.")
        return

    feature_cols = _load_feature_cols()
    model_version = _load_model_version()
    thresholds = _load_thresholds()

    # Upcoming + settled match code'larini topla
    upcoming_codes = _fetch_upcoming_match_codes()
    settled_codes = _fetch_settled_match_codes()
    all_codes = list(set(upcoming_codes + settled_codes))

    if not all_codes:
        logger.info("  Tahmin edilecek mac bulunamadi.")
        return

    logger.info(f"  {len(upcoming_codes)} gelecek + {len(settled_codes)} oyanmis = {len(all_codes)} mac bulundu")

    # Feature hesapla (tum veri — rolling stats icin gecmis gerekli)
    df = build_features()
    target_df = df[df["match_code"].isin(all_codes)].copy()
    if target_df.empty:
        logger.info("  Feature hesaplanabilir mac yok.")
        return

    logger.info(f"  {len(target_df)} mac icin feature hesaplandi")
    _predict_and_write(target_df, models, feature_cols, model_version, thresholds, "TAHMIN")


# ---------------------------------------------------------------------------
# Retrospektif backtest
# ---------------------------------------------------------------------------

def _fetch_settled_match_codes() -> list:
    """Oyanmis maclarin match_code'larini getir (score_ft gercek skor iceren)."""
    codes = []
    offset = 0
    while True:
        resp = (
            supabase.table("matches")
            .select("match_code, score_ft")
            .neq("score_ft", "v")
            .order("match_date", desc=True)
            .range(offset, offset + PAGE_SIZE - 1)
            .execute()
        )
        batch = resp.data
        if not batch:
            break
        for r in batch:
            if r.get("score_ft") and SCORE_RE.search(r["score_ft"]):
                codes.append(r["match_code"])
        if len(batch) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return codes


def predict_backtest():
    """Gecmiste oyanmis maclar icin retrospektif tahmin uret ve DB'ye yaz."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    logger.info("  Retrospektif backtest basliyor...")

    models = _load_models()
    if not models:
        logger.error("  Hic model bulunamadi. Once train-models calistirin.")
        return

    feature_cols = _load_feature_cols()
    model_version = _load_model_version()
    thresholds = _load_thresholds()

    settled_codes = _fetch_settled_match_codes()
    if not settled_codes:
        logger.info("  Oyanmis mac bulunamadi.")
        return

    logger.info(f"  {len(settled_codes)} oyanmis mac bulundu")

    # Feature hesapla (tum veri uzerinden — rolling stats icin gecmis gerekli)
    df = build_features()

    settled_df = df[df["match_code"].isin(settled_codes)].copy()
    if settled_df.empty:
        logger.info("  Feature hesaplanabilir oyanmis mac yok.")
        return

    logger.info(f"  {len(settled_df)} mac icin feature hesaplandi, tahmin uretiliyor...")
    _predict_and_write(settled_df, models, feature_cols, model_version, thresholds, "RETROSPEKTIF BACKTEST")


if __name__ == "__main__":
    predict_upcoming()
