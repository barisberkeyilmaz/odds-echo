import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import {
  buildMatchSelect,
  isValidOdd,
  SCORE_FIELDS,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

const PERFECT_MATCH_CATEGORIES: { id: string; fields: OddsKey[] }[] = [
  { id: 'ms', fields: ['ms_1', 'ms_x', 'ms_2'] },
  { id: 'iyms', fields: ['iyms_11', 'iyms_1x', 'iyms_12', 'iyms_x1', 'iyms_xx', 'iyms_x2', 'iyms_21', 'iyms_2x', 'iyms_22'] },
  { id: 'au15', fields: ['au_15_alt', 'au_15_ust'] },
  { id: 'au25', fields: ['au_25_alt', 'au_25_ust'] },
  { id: 'kg', fields: ['kg_var', 'kg_yok'] },
  { id: 'tg', fields: ['tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus'] },
]

/**
 * Build a PostgREST OR filter string.
 * Each category becomes an AND group; categories are OR'd together.
 * e.g. "and(ms_1.eq.2.50,ms_x.eq.3.20,ms_2.eq.2.80),and(au_25_alt.eq.1.55,au_25_ust.eq.2.40)"
 */
function buildOrFilter(fixture: MatchWithScores, categories: typeof PERFECT_MATCH_CATEGORIES) {
  const parts: string[] = []

  for (const category of categories) {
    const conditions: string[] = []
    for (const field of category.fields) {
      const value = fixture[field]
      if (isValidOdd(value)) {
        conditions.push(`${field}.eq.${value}`)
      }
    }
    if (conditions.length > 0) {
      parts.push(conditions.length === 1 ? conditions[0] : `and(${conditions.join(',')})`)
    }
  }

  return parts
}

export async function GET(request: Request) {
  const url = new URL(request.url)
  const fixtureId = Number(url.searchParams.get('fixtureId') ?? '0')
  const categoryIdsParam = url.searchParams.get('categories') ?? ''
  const league = url.searchParams.get('league')
  const season = url.searchParams.get('season')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') ?? '100')))

  if (!fixtureId) {
    return NextResponse.json({ error: 'fixtureId required' }, { status: 400 })
  }

  // Get the fixture
  const { data: fixtureData, error: fixtureError } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', fixtureId)
    .single()

  if (fixtureError || !fixtureData) {
    return NextResponse.json({ error: 'Fixture not found' }, { status: 404 })
  }

  const fixture = fixtureData as unknown as MatchWithScores

  // Determine which categories to search
  const selectedCategoryIds = categoryIdsParam
    ? categoryIdsParam.split(',').filter(Boolean)
    : PERFECT_MATCH_CATEGORIES.map((c) => c.id)

  const requestedCategories = PERFECT_MATCH_CATEGORIES.filter(
    (c) => selectedCategoryIds.includes(c.id)
  )

  // Build OR filter: match on ANY category (not ALL)
  const orParts = buildOrFilter(fixture, requestedCategories)

  if (orParts.length === 0) {
    return NextResponse.json({ matches: [], total: 0, page, limit, totalPages: 0 })
  }

  // Exclude matches from the same day as the fixture (prevent self-matching)
  const fixtureDate = fixture.match_date?.split('T')[0] ?? ''

  let query = supabase
    .from('matches')
    .select(MATCH_SELECT, { count: 'exact' })
    .not('score_ft', 'is', null)
    .neq('id', fixtureId)
    .lt('match_date', `${fixtureDate}T00:00:00`)
    .or(orParts.join(','))

  if (league) {
    query = query.eq('league', league)
  }
  if (season) {
    query = query.eq('season', season)
  }

  const from = (page - 1) * limit

  query = query
    .order('match_date', { ascending: false })
    .range(from, from + limit - 1)

  const { data, error, count } = await query

  if (error) {
    return NextResponse.json({ error: 'Perfect match sorgusu başarısız' }, { status: 500 })
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
