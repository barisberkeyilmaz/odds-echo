"""
Tahmin uretimi -- upcoming fixtures icin.

Egitilmis modelleri yukler, feature'lari hesaplar,
confident pick sinyalleri uretir ve ml_predictions tablosuna yazar.
"""

import os
import json
import logging
from datetime import datetime

import numpy as np
import pandas as pd
import joblib

from config import supabase
from ml.config import MARKETS, ML_MODELS_DIR, PAGE_SIZE, CONFIDENCE_LEVEL_OFFSETS
from ml.features import build_features, get_feature_columns, load_all_data

logger = logging.getLogger("ml.predict")


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


def predict_upcoming():
    """Gelecek maclar icin tahmin uret ve DB'ye yaz."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    logger.info("  Tahmin uretimi basliyor...")

    # Modelleri yukle
    models = _load_models()
    if not models:
        logger.error("  Hic model bulunamadi. Once train-models calistirin.")
        return

    feature_cols = _load_feature_cols()
    model_version = _load_model_version()
    thresholds = _load_thresholds()

    # Upcoming match codes
    upcoming_codes = _fetch_upcoming_match_codes()
    if not upcoming_codes:
        logger.info("  Gelecek mac bulunamadi.")
        return

    logger.info(f"  {len(upcoming_codes)} gelecek mac bulundu")

    # Tum veriyi yukle ve feature hesapla (rolling stats icin gecmis veri gerekli)
    df = build_features()

    # Sadece upcoming maclari filtrele
    upcoming_df = df[df["match_code"].isin(upcoming_codes)].copy()
    if upcoming_df.empty:
        logger.info("  Feature hesaplanabilir gelecek mac yok.")
        return

    logger.info(f"  {len(upcoming_df)} mac icin feature hesaplandi")

    # Her market icin tahmin
    total_predictions = 0
    total_confident = 0

    for market, model in models.items():
        labels = _market_labels(market)
        num_classes = len(labels)

        # Threshold bilgisi
        mkt_threshold = thresholds.get(market, {})
        threshold_val = mkt_threshold.get("threshold", 0.60)

        # Feature sutunlarini kontrol et
        missing_cols = [c for c in feature_cols if c not in upcoming_df.columns]
        if missing_cols:
            logger.warning(f"  {market}: {len(missing_cols)} eksik feature sutunu")

        X = upcoming_df.reindex(columns=feature_cols)

        try:
            proba = model.predict_proba(X)
        except Exception as e:
            logger.error(f"  {market} tahmin hatasi: {e}")
            continue

        # Her mac icin tahmin ve confident pick
        predictions = []
        for idx, (_, row) in enumerate(upcoming_df.iterrows()):
            prob_dict = {labels[i]: round(float(proba[idx, i]), 4) for i in range(num_classes)}

            # En yuksek olasilikli sonuc
            best_idx = int(np.argmax(proba[idx]))
            predicted_outcome = labels[best_idx]
            confidence = float(proba[idx, best_idx])

            # Confident pick tespiti
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

        # Toplu upsert
        if predictions:
            try:
                supabase.table("ml_predictions").upsert(
                    predictions,
                    on_conflict="match_code,market,model_version",
                ).execute()
                total_predictions += len(predictions)
                cp_count = sum(1 for p in predictions if p["confident_picks"])
                logger.info(f"  {market.upper()}: {len(predictions)} tahmin, {cp_count} emin tahmin")
            except Exception as e:
                logger.error(f"  {market} DB yazim hatasi: {e}")

    # Ozet
    logger.info(f"\n{'='*60}")
    logger.info(f"  TAHMIN TAMAMLANDI")
    logger.info(f"   Toplam tahmin: {total_predictions}")
    logger.info(f"   Emin tahmin sinyali: {total_confident}")
    logger.info(f"   Model versiyonu: {model_version}")


if __name__ == "__main__":
    predict_upcoming()
