import type { OddsKey } from '../match/types'

/** İY/MS sürpriz sonuçları — ilk yarı sonucu maç sonucundan farklı */
export const IYMS_SURPRISE_KEYS: OddsKey[] = [
  'iyms_12', // 1/2 — İY ev sahibi önde, MS deplasman kazanır
  'iyms_21', // 2/1 — İY deplasman önde, MS ev sahibi kazanır
  'iyms_2x', // 2/X — İY deplasman önde, MS berabere
  'iyms_x2', // X/2 — İY berabere, MS deplasman kazanır
  'iyms_1x', // 1/X — İY ev sahibi önde, MS berabere
  'iyms_x1', // X/1 — İY berabere, MS ev sahibi kazanır
]

/** Tüm oran alanları (eşik kontrolü için) */
export const ALL_ODDS_KEYS: OddsKey[] = [
  'ms_1', 'ms_x', 'ms_2',
  'iyms_11', 'iyms_1x', 'iyms_12',
  'iyms_x1', 'iyms_xx', 'iyms_x2',
  'iyms_21', 'iyms_2x', 'iyms_22',
  'au_15_alt', 'au_15_ust',
  'au_25_alt', 'au_25_ust',
  'kg_var', 'kg_yok',
  'tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus',
]

/** İY/MS sonuçlarının okunabilir etiketleri */
export const IYMS_KEYS: OddsKey[] = [
  'iyms_11', 'iyms_1x', 'iyms_12',
  'iyms_x1', 'iyms_xx', 'iyms_x2',
  'iyms_21', 'iyms_2x', 'iyms_22',
]

export const OUTCOME_LABELS: Record<OddsKey, string> = {
  ms_1: 'MS 1', ms_x: 'MS X', ms_2: 'MS 2',
  iyms_11: '1/1', iyms_1x: '1/X', iyms_12: '1/2',
  iyms_x1: 'X/1', iyms_xx: 'X/X', iyms_x2: 'X/2',
  iyms_21: '2/1', iyms_2x: '2/X', iyms_22: '2/2',
  au_15_alt: '1.5 Alt', au_15_ust: '1.5 Üst',
  au_25_alt: '2.5 Alt', au_25_ust: '2.5 Üst',
  kg_var: 'KG Var', kg_yok: 'KG Yok',
  tg_0_1: 'TG 0-1', tg_2_3: 'TG 2-3', tg_4_5: 'TG 4-5', tg_6_plus: 'TG 6+',
}

/** Sonucun hangi kategoriye ait olduğu */
export const OUTCOME_CATEGORY: Record<OddsKey, string> = {
  ms_1: 'MS', ms_x: 'MS', ms_2: 'MS',
  iyms_11: 'İY/MS', iyms_1x: 'İY/MS', iyms_12: 'İY/MS',
  iyms_x1: 'İY/MS', iyms_xx: 'İY/MS', iyms_x2: 'İY/MS',
  iyms_21: 'İY/MS', iyms_2x: 'İY/MS', iyms_22: 'İY/MS',
  au_15_alt: '1.5 A/Ü', au_15_ust: '1.5 A/Ü',
  au_25_alt: '2.5 A/Ü', au_25_ust: '2.5 A/Ü',
  kg_var: 'KG', kg_yok: 'KG',
  tg_0_1: 'TG', tg_2_3: 'TG', tg_4_5: 'TG', tg_6_plus: 'TG',
}

export const DEFAULT_SURPRISE_THRESHOLD = 10.0
export const MIN_SURPRISE_THRESHOLD = 0
export const MAX_SURPRISE_THRESHOLD = 20.0
export const THRESHOLD_STEP = 0.5

export const DEFAULT_TOLERANCE_PCT = 5
export const MIN_TOLERANCE_PCT = 0
export const MAX_TOLERANCE_PCT = 20
