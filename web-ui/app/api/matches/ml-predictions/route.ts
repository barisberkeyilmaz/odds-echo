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
  id: number
  match_code: string
  home_team: string
  away_team: string
  league: string
  match_date: string
  score_ft: string | null
}

/** JSONB bazen string olarak geliyor — guvenli parse */
function safeParse<T>(val: string | T): T {
  if (typeof val === 'string') {
    try { return JSON.parse(val) as T } catch { return val as unknown as T }
  }
  return val
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const PAGE_SIZE = 1000

/** Paginated fetch — Supabase varsayilan 1000 satir limitini asar */
async function fetchAllRows<T>(
  buildQuery: (offset: number) => { then: (onfulfilled: (value: { data: T[] | null; error: { message: string } | null }) => void) => void },
): Promise<T[]> {
  const rows: T[] = []
  let offset = 0
  while (true) {
    const { data, error } = await (buildQuery(offset) as unknown as Promise<{ data: T[] | null; error: { message: string } | null }>)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) break
    offset += PAGE_SIZE
  }
  return rows
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)
  const todayKey = new Date().toISOString().split('T')[0]
  const dateKey = url.searchParams.get('date') ?? todayKey
  const matchCodeParam = url.searchParams.get('match_code')

  // 1. Maclari cek (paginated)
  let matches: MatchRow[]
  try {
    if (matchCodeParam) {
      const { data, error } = await supabase
        .from('matches')
        .select('id, match_code, home_team, away_team, league, match_date, score_ft')
        .eq('match_code', matchCodeParam)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      matches = (data ?? []) as MatchRow[]
    } else {
      matches = await fetchAllRows<MatchRow>((offset) =>
        supabase
          .from('matches')
          .select('id, match_code, home_team, away_team, league, match_date, score_ft')
          .gte('match_date', `${dateKey}T00:00:00`)
          .lte('match_date', `${dateKey}T23:59:59`)
          .order('match_date', { ascending: true })
          .range(offset, offset + PAGE_SIZE - 1),
      )
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  if (matches.length === 0) {
    return NextResponse.json({ date: dateKey, modelVersion: null, matches: [] })
  }

  const matchCodes = matches.map((m) => m.match_code)

  // 2. Bu maclarin tahminlerini cek (chunk + paginated)
  // .in() cok buyuk array'lerde sorun cikarabilir — 200'lik chunk'lar kullan
  let rawPreds: RawPredictionRow[] = []
  try {
    const CHUNK = 200
    for (let i = 0; i < matchCodes.length; i += CHUNK) {
      const chunk = matchCodes.slice(i, i + CHUNK)
      const chunkRows = await fetchAllRows<RawPredictionRow>((offset) =>
        supabase
          .from('ml_predictions')
          .select('match_code, market, probabilities, predicted_outcome, confidence, confident_picks, model_version')
          .in('match_code', chunk)
          .order('model_version', { ascending: false })
          .range(offset, offset + PAGE_SIZE - 1),
      )
      rawPreds.push(...chunkRows)
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }

  // En son model version
  const latestVersion = rawPreds.length > 0 ? rawPreds[0].model_version : null
  const preds = rawPreds.filter((p) => p.model_version === latestVersion)

  // 3. Predictions'i match_code bazinda grupla
  const predMap = new Map<string, Array<{
    market: string
    probs: Record<string, number>
    predicted: string
    confidence: number
    confidentPicks: Array<{
      outcome: string
      confidence: number
      threshold: number
      confidenceLevel: string
      impliedProb: number | null
    }> | null
  }>>()

  for (const pred of preds) {
    const probs = safeParse<Record<string, number>>(pred.probabilities)
    const rawCp = safeParse<Array<{
      outcome: string; confidence: number; threshold: number
      confidence_level: string; implied_prob: number | null
    }> | null>(pred.confident_picks ?? 'null')

    const confidentPicks = (rawCp && Array.isArray(rawCp) && rawCp.length > 0)
      ? rawCp.map((cp) => ({
          outcome: cp.outcome,
          confidence: cp.confidence,
          threshold: cp.threshold,
          confidenceLevel: cp.confidence_level,
          impliedProb: cp.implied_prob,
        }))
      : null

    const existing = predMap.get(pred.match_code) ?? []
    existing.push({
      market: pred.market,
      probs,
      predicted: pred.predicted_outcome ?? '',
      confidence: pred.confidence ?? 0,
      confidentPicks,
    })
    predMap.set(pred.match_code, existing)
  }

  // 4. Sadece tahmini olan maclari dondur
  const result = matches
    .filter((m) => predMap.has(m.match_code))
    .map((match) => {
      const markets = predMap.get(match.match_code)!
      const allConfidentPicks = markets.flatMap((m) =>
        (m.confidentPicks ?? []).map((cp) => ({ market: m.market, ...cp }))
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
        confidentPicks: allConfidentPicks.sort((a, b) => b.confidence - a.confidence),
      }
    })

  // Emin tahminli maclar once, sonra saate gore
  result.sort((a, b) => {
    const aConf = a.confidentPicks.length > 0 ? a.confidentPicks[0].confidence : 0
    const bConf = b.confidentPicks.length > 0 ? b.confidentPicks[0].confidence : 0
    if (aConf !== bConf) return bConf - aConf
    return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
  })

  return NextResponse.json({ date: dateKey, modelVersion: latestVersion, matches: result })
}
