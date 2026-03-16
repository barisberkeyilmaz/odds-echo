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
  id: number
  match_code: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  score_ft: string | null
}

/** JSONB bazen string olarak geliyor — güvenli parse */
function safeParse<T>(val: string | T): T {
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return val as unknown as T }
  }
  return val
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)
  const todayKey = new Date().toISOString().split('T')[0]
  const dateKey = url.searchParams.get('date') ?? todayKey
  // Tek maç için match_code parametresi (analiz sayfası için)
  const matchCodeParam = url.searchParams.get('match_code')

  // 1. Maçları çek
  let matchQuery = supabase
    .from('matches')
    .select('id, match_code, home_team, away_team, league, match_date, score_ft')

  if (matchCodeParam) {
    matchQuery = matchQuery.eq('match_code', matchCodeParam)
  } else {
    matchQuery = matchQuery
      .gte('match_date', `${dateKey}T00:00:00`)
      .lte('match_date', `${dateKey}T23:59:59`)
      .order('match_date', { ascending: true })
  }

  const { data: matchData, error: matchError } = await matchQuery

  if (matchError) {
    return NextResponse.json({ error: matchError.message }, { status: 500 })
  }

  const matches = (matchData ?? []) as MatchRow[]
  if (matches.length === 0) {
    return NextResponse.json({ date: dateKey, modelVersion: null, matches: [] })
  }

  const matchCodes = matches.map((m) => m.match_code)

  // 2. Bu maçların tahminlerini çek
  const { data: predData, error: predError } = await supabase
    .from('ml_predictions')
    .select('match_code, market, probabilities, predicted_outcome, confidence, value_bets, model_version')
    .in('match_code', matchCodes)
    .order('model_version', { ascending: false })

  if (predError) {
    return NextResponse.json({ error: predError.message }, { status: 500 })
  }

  const rawPreds = (predData ?? []) as RawPredictionRow[]

  // En son model version
  const latestVersion = rawPreds.length > 0 ? rawPreds[0].model_version : null
  const preds = rawPreds.filter((p) => p.model_version === latestVersion)

  // 3. Predictions'ı match_code bazında grupla
  const predMap = new Map<string, Array<{
    market: string
    probs: Record<string, number>
    predicted: string
    valueBets: Array<{ outcome: string; modelProb: number; impliedProb: number; edge: number }> | null
  }>>()

  for (const pred of preds) {
    const probs = safeParse<Record<string, number>>(pred.probabilities)
    const rawVb = safeParse<Array<{ outcome: string; model_prob: number; implied_prob: number; edge: number }> | null>(pred.value_bets ?? 'null')
    const valueBets = (rawVb && Array.isArray(rawVb) && rawVb.length > 0)
      ? rawVb.map((v) => ({ outcome: v.outcome, modelProb: v.model_prob, impliedProb: v.implied_prob, edge: v.edge }))
      : null

    const existing = predMap.get(pred.match_code) ?? []
    existing.push({ market: pred.market, probs, predicted: pred.predicted_outcome ?? '', valueBets })
    predMap.set(pred.match_code, existing)
  }

  // 4. Sadece tahmini olan maçları döndür
  const result = matches
    .filter((m) => predMap.has(m.match_code))
    .map((match) => {
      const markets = predMap.get(match.match_code)!
      const allValueBets = markets.flatMap((m) =>
        (m.valueBets ?? []).map((vb) => ({ market: m.market, ...vb }))
      )

      return {
        matchId: match.id,
        matchCode: match.match_code,
        homeTeam: match.home_team,
        awayTeam: match.away_team,
        league: match.league,
        matchDate: match.match_date,
        isPlayed: match.score_ft !== null && match.score_ft !== '',
        markets,
        valueBets: allValueBets.sort((a, b) => b.edge - a.edge),
      }
    })

  // Value bet olanlar önce, sonra saate göre
  result.sort((a, b) => {
    const aEdge = a.valueBets.length > 0 ? a.valueBets[0].edge : 0
    const bEdge = b.valueBets.length > 0 ? b.valueBets[0].edge : 0
    if (aEdge !== bEdge) return bEdge - aEdge
    return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
  })

  return NextResponse.json({ date: dateKey, modelVersion: latestVersion, matches: result })
}
