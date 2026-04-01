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
  confident_picks: string | Array<{
    outcome: string
    confidence: number
    threshold: number
    confidence_level: string
    implied_prob: number | null
  }> | null
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
// Skor Parse & Gercek Sonuc Hesaplama
// ---------------------------------------------------------------------------

function parseScore(score: string | null): [number, number] | null {
  if (!score) return null
  const m = score.match(/(\d+)\s*[-:]\s*(\d+)/)
  if (!m) return null
  return [parseInt(m[1]), parseInt(m[2])]
}

function computeActual(market: string, scoreFt: string | null, scoreHt: string | null): string | null {
  const ft = parseScore(scoreFt)
  if (!ft) return null
  const [home, away] = ft
  const total = home + away

  if (market === 'iyms') {
    const ht = parseScore(scoreHt)
    if (!ht) return null
    const [htHome, htAway] = ht
    const iyResult = htHome > htAway ? '1' : htHome === htAway ? 'X' : '2'
    const msResult = home > away ? '1' : home === away ? 'X' : '2'
    return `${iyResult}/${msResult}`
  }

  switch (market) {
    case 'ms':
      if (home > away) return '1'
      if (home === away) return 'X'
      return '2'
    case 'kg':
      return (home > 0 && away > 0) ? 'Var' : 'Yok'
    case 'au25':
      return total > 2.5 ? 'Ust' : 'Alt'
    case 'tg':
      if (total <= 1) return '0-1'
      if (total <= 3) return '2-3'
      if (total <= 5) return '4-5'
      return '6+'
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
  hasConfidentPick: boolean
  confidenceLevel: string | null
}

function computeCalibration(confidences: number[], corrects: boolean[]): CalibrationBracket[] {
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
    for (let i = 0; i < confidences.length; i++) {
      if (confidences[i] >= b.min && confidences[i] < b.max) {
        sumPred += confidences[i]
        sumActual += corrects[i] ? 1 : 0
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
  // 1. En son model versiyonunu bul
  const { data: versionData, error: versionError } = await supabase
    .from('ml_predictions')
    .select('model_version')
    .order('model_version', { ascending: false })
    .limit(1)

  if (versionError) return NextResponse.json({ error: versionError.message }, { status: 500 })
  if (!versionData || versionData.length === 0) {
    return NextResponse.json({ modelVersion: null, summary: null, markets: [], recentPicks: [] })
  }

  const latestVersion = versionData[0].model_version

  // 2. Sadece en son versiyonun tahminlerini cek
  let allPreds: RawPredictionRow[] = []
  const batchSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('ml_predictions')
      .select('match_code, market, probabilities, predicted_outcome, confidence, confident_picks, model_version')
      .eq('model_version', latestVersion)
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

  // Deduplicate: ayni match_code + market icin sadece bir tahmin tut
  const predMap = new Map<string, RawPredictionRow>()
  for (const p of allPreds) {
    const key = `${p.match_code}__${p.market}`
    if (!predMap.has(key)) predMap.set(key, p)
  }
  const preds = [...predMap.values()]

  // 2. Bu maclarin bilgilerini cek
  const matchCodes = [...new Set(preds.map((p) => p.match_code))]

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

  // Settled = gercek skor var + mac saati en az 2 saat oncesinde
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const isSettled = (m: MatchRow) => {
    if (!m.score_ft || !m.score_ft.match(/\d+\s*[-:]\s*\d+/)) return false
    if (m.score_ft === 'v') return false
    return m.match_date < twoHoursAgo
  }

  const totalMatchesWithPrediction = matchCodes.length
  const settledMatchCodes = [...matchMap.values()].filter(isSettled).length

  // 3. Analiz: sadece oyanmis maclar
  const analyzedPicks: AnalyzedPick[] = []
  const allConfidences: number[] = []
  const allCorrect: boolean[] = []

  // Market bazli istatistikler
  const marketStats = new Map<string, {
    total: number; correct: number
    cpTotal: number; cpHits: number
    cpByLevel: Record<string, { total: number; hits: number }>
    confidences: number[]; corrects: boolean[]
  }>()

  let totalConfidentPicks = 0
  let totalConfidentHits = 0

  for (const pred of preds) {
    const match = matchMap.get(pred.match_code)
    if (!match || !isSettled(match)) continue

    const actual = computeActual(pred.market, match.score_ft, match.score_ht)
    if (!actual) continue

    const predicted = pred.predicted_outcome ?? ''
    const confidence = pred.confidence ?? 0
    const isCorrect = predicted === actual

    // Confident pick kontrolu
    const rawCp = safeParse<Array<{
      outcome: string; confidence: number; threshold: number
      confidence_level: string; implied_prob: number | null
    }> | null>(pred.confident_picks ?? 'null')
    const hasConfidentPick = rawCp !== null && Array.isArray(rawCp) && rawCp.length > 0
    const confidenceLevel = hasConfidentPick ? rawCp![0].confidence_level : null

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
      scoreFt: match.score_ft!,
      hasConfidentPick,
      confidenceLevel,
    })

    allConfidences.push(confidence)
    allCorrect.push(isCorrect)

    // Market istatistikleri
    if (!marketStats.has(pred.market)) {
      marketStats.set(pred.market, {
        total: 0, correct: 0,
        cpTotal: 0, cpHits: 0,
        cpByLevel: {},
        confidences: [], corrects: [],
      })
    }
    const ms = marketStats.get(pred.market)!
    ms.total++
    if (isCorrect) ms.correct++
    ms.confidences.push(confidence)
    ms.corrects.push(isCorrect)

    // Confident pick istatistikleri
    if (hasConfidentPick) {
      const cpOutcome = rawCp![0].outcome
      const cpHit = cpOutcome === actual

      ms.cpTotal++
      if (cpHit) ms.cpHits++

      totalConfidentPicks++
      if (cpHit) totalConfidentHits++

      // Seviye bazli
      const level = rawCp![0].confidence_level
      if (!ms.cpByLevel[level]) ms.cpByLevel[level] = { total: 0, hits: 0 }
      ms.cpByLevel[level].total++
      if (cpHit) ms.cpByLevel[level].hits++
    }
  }

  // 4. Response olustur
  const totalPredictions = analyzedPicks.length
  const overallCorrect = analyzedPicks.filter((p) => p.isCorrect).length

  const marketOrder = ['ms', 'kg', 'au25', 'tg', 'iyms']
  const markets = marketOrder
    .filter((m) => marketStats.has(m))
    .map((market) => {
      const ms = marketStats.get(market)!
      return {
        market,
        total: ms.total,
        accuracy: ms.total > 0 ? ms.correct / ms.total : 0,
        calibration: computeCalibration(ms.confidences, ms.corrects),
        confidentPickCount: ms.cpTotal,
        confidentPickHits: ms.cpHits,
        confidentPickHitRate: ms.cpTotal > 0 ? ms.cpHits / ms.cpTotal : 0,
        confidentPickByLevel: ms.cpByLevel,
        coverage: ms.total > 0 ? ms.cpTotal / ms.total : 0,
      }
    })

  // Son 500 tahmin (tarihe gore desc) — frontend'de mac bazli gruplaniyor
  const recentPicks = [...analyzedPicks]
    .sort((a, b) => new Date(b.matchDate).getTime() - new Date(a.matchDate).getTime())
    .slice(0, 500)

  return NextResponse.json({
    modelVersion: latestVersion,
    totalMatchesWithPrediction,
    settledMatches: settledMatchCodes,
    summary: {
      totalPredictions,
      overallAccuracy: totalPredictions > 0 ? overallCorrect / totalPredictions : 0,
      confidentPicks: {
        total: totalConfidentPicks,
        hits: totalConfidentHits,
        hitRate: totalConfidentPicks > 0 ? totalConfidentHits / totalConfidentPicks : 0,
      },
    },
    markets,
    recentPicks,
  })
}
