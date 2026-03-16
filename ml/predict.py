"""
Tahmin üretimi — upcoming fixtures için.

Eğitilmiş modelleri yükler, feature'ları hesaplar,
value bet sinyalleri üretir ve ml_predictions tablosuna yazar.
"""

import os
import json
import logging
from datetime import datetime

import numpy as np
import pandas as pd
import joblib

from config import supabase
from ml.config import MARKETS, MIN_EDGE, ML_MODELS_DIR, PAGE_SIZE
from ml.features import build_features, get_feature_columns, load_all_data

logger = logging.getLogger("ml.predict")


def _load_models() -> dict:
    """Kaydedilmiş modelleri yükle."""
    models = {}
    for market in MARKETS:
        path = os.path.join(ML_MODELS_DIR, f"{market}_model.pkl")
        if os.path.exists(path):
            models[market] = joblib.load(path)
            logger.info(f"✅ {market} modeli yüklendi")
        else:
            logger.warning(f"⚠️  {market} modeli bulunamadı: {path}")
    return models


def _load_feature_cols() -> list:
    """Feature sütun listesini yükle."""
    path = os.path.join(ML_MODELS_DIR, "feature_cols.pkl")
    if os.path.exists(path):
        return joblib.load(path)
    raise FileNotFoundError(f"Feature sütunları bulunamadı: {path}")


def _load_model_version() -> str:
    """Model versiyonunu yükle."""
    path = os.path.join(ML_MODELS_DIR, "model_version.txt")
    if os.path.exists(path):
        with open(path) as f:
            return f.read().strip()
    return f"v_{datetime.now().strftime('%Y%m%d_%H%M%S')}"


def _fetch_upcoming_match_codes() -> list:
    """Gelecek maçların match_code'larını getir."""
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
    """Tek satır için implied probability hesapla."""
    try:
        if market == "ms":
            cols = ["imp_ms_1_norm", "imp_ms_x_norm", "imp_ms_2_norm"]
            return row.get(cols[outcome_idx], np.nan)
        elif market == "kg":
            return row.get("imp_kg_var", np.nan) if outcome_idx == 1 else row.get("imp_kg_yok", np.nan)
        elif market == "au25":
            return row.get("imp_au_25_ust", np.nan) if outcome_idx == 1 else row.get("imp_au_25_alt", np.nan)
        elif market == "tg":
            cols = ["imp_tg_0_1", "imp_tg_2_3", "imp_tg_4_5"]
            return row.get(cols[outcome_idx], np.nan) if outcome_idx < len(cols) else np.nan
        elif market == "iy":
            return np.nan  # İY implied prob karmaşık, şimdilik atla
    except Exception:
        return np.nan
    return np.nan


def _market_labels(market: str) -> list:
    """Market sonuç etiketleri."""
    return {
        "ms": ["1", "X", "2"],
        "kg": ["Yok", "Var"],
        "au25": ["Alt", "Üst"],
        "tg": ["0-1", "2-3", "4+"],
        "iy": ["1", "X", "2"],
    }[market]


def predict_upcoming():
    """Gelecek maçlar için tahmin üret ve DB'ye yaz."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")

    logger.info("🔮 Tahmin üretimi başlıyor...")

    # Modelleri yükle
    models = _load_models()
    if not models:
        logger.error("❌ Hiç model bulunamadı. Önce train-models çalıştırın.")
        return

    feature_cols = _load_feature_cols()
    model_version = _load_model_version()

    # Upcoming match codes
    upcoming_codes = _fetch_upcoming_match_codes()
    if not upcoming_codes:
        logger.info("ℹ️  Gelecek maç bulunamadı.")
        return

    logger.info(f"📅 {len(upcoming_codes)} gelecek maç bulundu")

    # Tüm veriyi yükle ve feature hesapla (rolling stats için geçmiş veri gerekli)
    df = build_features()

    # Sadece upcoming maçları filtrele
    upcoming_df = df[df["match_code"].isin(upcoming_codes)].copy()
    if upcoming_df.empty:
        logger.info("ℹ️  Feature hesaplanabilir gelecek maç yok.")
        return

    logger.info(f"📊 {len(upcoming_df)} maç için feature hesaplandı")

    # Her market için tahmin
    total_predictions = 0
    total_value_bets = 0

    for market, model in models.items():
        labels = _market_labels(market)
        num_classes = len(labels)

        # Feature sütunlarını kontrol et
        missing_cols = [c for c in feature_cols if c not in upcoming_df.columns]
        if missing_cols:
            logger.warning(f"⚠️  {market}: {len(missing_cols)} eksik feature sütunu")

        X = upcoming_df.reindex(columns=feature_cols)

        try:
            proba = model.predict_proba(X)
        except Exception as e:
            logger.error(f"❌ {market} tahmin hatası: {e}")
            continue

        # Her maç için tahmin ve value bet
        predictions = []
        for idx, (_, row) in enumerate(upcoming_df.iterrows()):
            prob_dict = {labels[i]: round(float(proba[idx, i]), 4) for i in range(num_classes)}

            # En yüksek olasılıklı sonuç
            best_idx = int(np.argmax(proba[idx]))
            predicted_outcome = labels[best_idx]
            confidence = float(proba[idx, best_idx])

            # Value bet tespiti
            value_bets = []
            for cls_idx in range(num_classes):
                model_p = float(proba[idx, cls_idx])
                impl_p = _get_implied_prob(row, market, cls_idx)
                if not np.isnan(impl_p) and model_p > impl_p + MIN_EDGE:
                    edge = model_p - impl_p
                    value_bets.append({
                        "outcome": labels[cls_idx],
                        "model_prob": round(model_p, 4),
                        "implied_prob": round(float(impl_p), 4),
                        "edge": round(float(edge), 4),
                    })

            pred_row = {
                "match_code": row["match_code"],
                "market": market,
                "probabilities": json.dumps(prob_dict, ensure_ascii=False),
                "predicted_outcome": predicted_outcome,
                "confidence": round(confidence, 4),
                "value_bets": json.dumps(value_bets, ensure_ascii=False) if value_bets else None,
                "model_version": model_version,
            }
            predictions.append(pred_row)
            total_value_bets += len(value_bets)

        # Toplu upsert
        if predictions:
            try:
                supabase.table("ml_predictions").upsert(
                    predictions,
                    on_conflict="match_code,market,model_version",
                ).execute()
                total_predictions += len(predictions)
                vb_count = sum(1 for p in predictions if p["value_bets"])
                logger.info(f"✅ {market.upper()}: {len(predictions)} tahmin, {vb_count} value bet maçı")
            except Exception as e:
                logger.error(f"❌ {market} DB yazım hatası: {e}")

    # Özet
    logger.info(f"\n{'='*60}")
    logger.info(f"🏁 TAHMİN TAMAMLANDI")
    logger.info(f"   Toplam tahmin: {total_predictions}")
    logger.info(f"   Value bet sinyali: {total_value_bets}")
    logger.info(f"   Model versiyonu: {model_version}")
