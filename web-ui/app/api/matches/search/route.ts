import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { buildMatchSelect, ODDS_FIELDS, SCORE_FIELDS, type MatchWithScores, type OddsKey } from '@/lib/match'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '50')))
  const tolerance = Math.max(0, Math.min(0.1, Number(url.searchParams.get('tolerance') ?? '0.04')))
  const league = url.searchParams.get('league')
  const season = url.searchParams.get('season')

  // Parse odds filters from query params
  const oddsFilters: { field: OddsKey; value: number }[] = []
  for (const field of ODDS_FIELDS) {
    const raw = url.searchParams.get(field)
    if (raw) {
      const value = Number(raw)
      if (Number.isFinite(value) && value > 0) {
        oddsFilters.push({ field, value })
      }
    }
  }

  if (oddsFilters.length === 0) {
    return NextResponse.json({ matches: [], total: 0, page, limit, totalPages: 0 })
  }

  const from = (page - 1) * limit

  // Build query with DB-side range filtering
  let query = supabase
    .from('matches')
    .select(MATCH_SELECT, { count: 'exact' })
    .eq('status', 'MS')
    .not('score_ft', 'is', null)

  // Apply odds range filters
  for (const { field, value } of oddsFilters) {
    const toleranceAbs = value * tolerance
    const low = value - Math.max(toleranceAbs, tolerance)
    const high = value + Math.max(toleranceAbs, tolerance)
    query = query.gte(field, low).lte(field, high)
  }

  if (league) {
    query = query.eq('league', league)
  }
  if (season) {
    query = query.eq('season', season)
  }

  query = query
    .order('match_date', { ascending: false })
    .range(from, from + limit - 1)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const total = count ?? 0
  const totalPages = Math.ceil(total / limit)

  return NextResponse.json({
    matches: (data ?? []) as unknown as MatchWithScores[],
    total,
    page,
    limit,
    totalPages,
  })
}
