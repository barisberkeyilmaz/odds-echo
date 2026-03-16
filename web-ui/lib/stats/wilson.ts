/**
 * Wilson Score Confidence Interval — Lower Bound
 *
 * Küçük sample size'larda hit rate'i aşağı çekerek istatistiksel güvenilirlik sağlar.
 * Büyük sample'larda raw hit rate'e yakınsar.
 *
 * Örnekler:
 *   wilsonLower(0, 0)     → 0       (veri yok)
 *   wilsonLower(2, 5)     → ~0.118  (küçük sample, ağır ceza)
 *   wilsonLower(80, 200)  → ~0.335  (büyük sample, %40'a yakın)
 *   wilsonLower(500, 1000) → ~0.469 (%50'ye yakın)
 *
 * @param hits  - Tutmuş sonuç sayısı
 * @param total - Toplam benzer maç sayısı
 * @param z     - Güven seviyesi z-skoru (1.96 = %95)
 */
export function wilsonLower(hits: number, total: number, z = 1.96): number {
  if (total === 0) return 0

  const p = hits / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)

  return Math.max(0, (centre - spread) / denominator)
}

/**
 * Wilson Score Upper Bound — güven aralığının üst sınırı
 */
export function wilsonUpper(hits: number, total: number, z = 1.96): number {
  if (total === 0) return 0

  const p = hits / total
  const z2 = z * z
  const denominator = 1 + z2 / total
  const centre = p + z2 / (2 * total)
  const spread = z * Math.sqrt((p * (1 - p) + z2 / (4 * total)) / total)

  return Math.min(1, (centre + spread) / denominator)
}

/**
 * Güven ayarlı Expected Value
 * Raw hitRate yerine Wilson lower bound kullanarak EV hesaplar.
 *
 * EV > 1.0 → tarihsel olarak "değerli" bahis
 */
export function wilsonEV(hits: number, total: number, odds: number, z = 1.96): number {
  return wilsonLower(hits, total, z) * odds
}
