import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import { buildMatchSelect, SCORE_FIELDS, type MatchWithScores } from '@/lib/match'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

export async function GET(request: Request) {
  const url = new URL(request.url)
  const date = url.searchParams.get('date')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') ?? '100')))

  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: 'date query param required (YYYY-MM-DD)' }, { status: 400 })
  }

  const from = (page - 1) * limit

  const { data, error, count } = await supabase
    .from('matches')
    .select(MATCH_SELECT, { count: 'exact' })
    .gte('match_date', `${date}T00:00:00`)
    .lte('match_date', `${date}T23:59:59`)
    .order('match_date', { ascending: true })
    .range(from, from + limit - 1)

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
