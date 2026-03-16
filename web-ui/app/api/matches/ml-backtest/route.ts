import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type RawPredictionRow = {
  match_code: string
  market: string
  probabilities: string | Record<string, number>
  predicted_outcome: string | null
  confidence: number | null
  value_bets: string | Array<{ outcome: string; model_prob: number; implied_prob: number; edge: number }> | null
  model_version: string | null
}

type MatchRow = {
  match_code: string
  home_team: string
  away_team: string
  match_date: string
  score_ft: string | null
  score_ht: string | null
}

function safeParse<T>(val: string | T): T {
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return val as unknown as T }
  }
  return val
}

// ---------------------------------------------------------------------------
// Skor Parse & Gerçek Sonuç Hesaplama (features.py:add_labels mantığı)
// ---------------------------------------------------------------------------

function parseScore(score: string | null): [number, number] | null {
  if (!score) return null
  const m = score.match(/(\d+)\s*[-:]\s*(\d+)/)
  if (!m) return null
  return [parseInt(m[1]), parseInt(m[2])]
}

function computeActual(market: string, scoreFt: string | null, scoreHt: string | null): string | null {
  if (market === 'iy') {
    const ht = parseScore(scoreHt)
    if (!ht) return null
    const [home, away] = ht
    if (home > away) return '1'
    if (home === away) return 'X'
    return '2'
  }

  const ft = parseScore(scoreFt)
  if (!ft) return null
  const [home, away] = ft
  const total = home + away

  switch (market) {
    case 'ms':
      if (home > away) return '1'
      if (home === away) return 'X'
      return '2'
    case 'kg':
      return (home > 0 && away > 0) ? 'Var' : 'Yok'
    case 'au25':
      return total > 2.5 ? 'Üst' : 'Alt'
    case 'tg':
      if (total <= 1) return '0-1'
      if (total <= 3) return '2-3'
      return '4+'
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Kalibrasyon Hesaplama
// ---------------------------------------------------------------------------

type CalibrationBracket = {
  bracket: string
  avgPredicted: number
  avgActual: number
  count: number
}

type AnalyzedPick = {
  matchCode: string
  homeTeam: string
  awayTeam: string
  matchDate: string
  market: string
  predicted: string
  actual: string
  isCorrect: boolean
  confidence: number
  scoreFt: string
  hasValueBet: boolean
}

function computeCalibration(picks: AnalyzedPick[], allConfidences: number[], allCorrect: boolean[]): CalibrationBracket[] {
  const brackets = [
    { label: '0-20%', min: 0, max: 0.2 },
    { label: '20-40%', min: 0.2, max: 0.4 },
    { label: '40-60%', min: 0.4, max: 0.6 },
    { label: '60-80%', min: 0.6, max: 0.8 },
    { label: '80-100%', min: 0.8, max: 1.0001 },
  ]

  return brackets.map((b) => {
    let sumPred = 0
    let sumActual = 0
    let count = 0
    for (let i = 0; i < allConfidences.length; i++) {
      if (allConfidences[i] >= b.min && allConfidences[i] < b.max) {
        sumPred += allConfidences[i]
        sumActual += allCorrect[i] ? 1 : 0
        count++
      }
    }
    return {
      bracket: b.label,
      avgPredicted: count > 0 ? sumPred / count : 0,
      avgActual: count > 0 ? sumActual / count : 0,
      count,
    }
  })
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET() {
  // 1. Tüm ml_predictions çek
  let allPreds: RawPredictionRow[] = []
  const batchSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('ml_predictions')
      .select('match_code, market, probabilities, predicted_outcome, confidence, value_bets, model_version')
      .order('model_version', { ascending: false })
      .range(offset, offset + batchSize - 1)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const rows = (data ?? []) as RawPredictionRow[]
    allPreds = allPreds.concat(rows)
    if (rows.length < batchSize) break
    offset += batchSize
  }

  if (allPreds.length === 0) {
    return NextResponse.json({ modelVersion: null, summary: null, markets: [], recentPicks: [] })
  }

  // En son model version
  const latestVersion = allPreds[0].model_version
  const preds = allPreds.filter((p) => p.model_version === latestVersion)

  // 2. Bu maçların bilgilerini çek
  const matchCodes = [...new Set(preds.map((p) => p.match_code))]

  // Supabase IN limiti ~1000, batch'le
  const matchMap = new Map<string, MatchRow>()
  for (let i = 0; i < matchCodes.length; i += 500) {
    const batch = matchCodes.slice(i, i + 500)
    const { data: matchData, error: matchError } = await supabase
      .from('matches')
      .select('match_code, home_team, away_team, match_date, score_ft, score_ht')
      .in('match_code', batch)

    if (matchError) return NextResponse.json({ error: matchError.message }, { status: 500 })
    for (const m of (matchData ?? []) as MatchRow[]) {
      matchMap.set(m.match_code, m)
    }
  }

  // Toplam maç sayıları
  const totalMatchesWithPrediction = matchCodes.length
  const settledMatchCodes = [...matchMap.values()].filter(
    (m) => m.score_ft && m.score_ft.match(/\d+\s*[-:]\s*\d+/)
  ).length

  // 3. Analiz: sadece oynanmış maçlar
  const analyzedPicks: AnalyzedPick[] = []
  const allConfidences: number[] = []
  const allCorrect: boolean[] = []

  // Market bazlı istatistikler
  const marketStats = new Map<string, {
    total: number; correct: number;
    vbTotal: number; vbHits: number; vbProfit: number;
    confidences: number[]; corrects: boolean[]
  }>()

  let totalValueBets = 0
  let totalValueBetHits = 0
  let totalValueBetProfit = 0

  for (const pred of preds) {
    const match = matchMap.get(pred.match_code)
    if (!match || !match.score_ft) continue

    const actual = computeActual(pred.market, match.score_ft, match.score_ht)
    if (!actual) continue

    const predicted = pred.predicted_outcome ?? ''
    const confidence = pred.confidence ?? 0
    const isCorrect = predicted === actual

    // Value bet kontrolü
    const rawVb = safeParse<Array<{ outcome: string; model_prob: number; implied_prob: number; edge: number }> | null>(pred.value_bets ?? 'null')
    const hasValueBet = rawVb !== null && Array.isArray(rawVb) && rawVb.length > 0

    analyzedPicks.push({
      matchCode: pred.match_code,
      homeTeam: match.home_team,
      awayTeam: match.away_team,
      matchDate: match.match_date,
      market: pred.market,
      predicted,
      actual,
      isCorrect,
      confidence,
      scoreFt: match.score_ft,
      hasValueBet,
    })

    allConfidences.push(confidence)
    allCorrect.push(isCorrect)

    // Market istatistikleri
    if (!marketStats.has(pred.market)) {
      marketStats.set(pred.market, { total: 0, correct: 0, vbTotal: 0, vbHits: 0, vbProfit: 0, confidences: [], corrects: [] })
    }
    const ms = marketStats.get(pred.market)!
    ms.total++
    if (isCorrect) ms.correct++
    ms.confidences.push(confidence)
    ms.corrects.push(isCorrect)

    // Value bet ROI: predicted outcome ile bahis yapıldığını varsay
    if (hasValueBet) {
      // En yüksek edge'li value bet
      const bestVb = rawVb!.sort((a, b) => b.edge - a.edge)[0]
      const vbActual = computeActual(pred.market, match.score_ft, match.score_ht)
      const vbHit = bestVb.outcome === vbActual
      // implied_prob'dan oran hesapla: odds = 1 / implied_prob
      const odds = 1 / bestVb.implied_prob
      const profit = vbHit ? (odds - 1) : -1

      ms.vbTotal++
      ms.vbHits += vbHit ? 1 : 0
      ms.vbProfit += profit

      totalValueBets++
      totalValueBetHits += vbHit ? 1 : 0
      totalValueBetProfit += profit
    }
  }

  // 4. Response oluştur
  const totalPredictions = analyzedPicks.length
  const overallCorrect = analyzedPicks.filter((p) => p.isCorrect).length

  const marketOrder = ['ms', 'kg', 'au25', 'tg', 'iy']
  const markets = marketOrder
    .filter((m) => marketStats.has(m))
    .map((market) => {
      const ms = marketStats.get(market)!
      return {
        market,
        total: ms.total,
        accuracy: ms.total > 0 ? ms.correct / ms.total : 0,
        calibration: computeCalibration([], ms.confidences, ms.corrects),
        valueBetCount: ms.vbTotal,
        valueBetHits: ms.vbHits,
        valueBetROI: ms.vbTotal > 0 ? ms.vbProfit / ms.vbTotal : 0,
      }
    })

  // Son 100 tahmin (tarihe göre desc)
  const recentPicks = [...analyzedPicks]
    .sort((a, b) => new Date(b.matchDate).getTime() - new Date(a.matchDate).getTime())
    .slice(0, 100)

  return NextResponse.json({
    modelVersion: latestVersion,
    totalMatchesWithPrediction,
    settledMatches: settledMatchCodes,
    summary: {
      totalPredictions,
      overallAccuracy: totalPredictions > 0 ? overallCorrect / totalPredictions : 0,
      valueBets: {
        total: totalValueBets,
        hits: totalValueBetHits,
        roi: totalValueBets > 0 ? totalValueBetProfit / totalValueBets : 0,
      },
    },
    markets,
    recentPicks,
  })
}
