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

export async function GET(request: Request) {
  const url = new URL(request.url)
  const fixtureId = Number(url.searchParams.get('fixtureId') ?? '0')
  const categoryIdsParam = url.searchParams.get('categories') ?? ''
  const league = url.searchParams.get('league')
  const season = url.searchParams.get('season')
  const page = Math.max(1, Number(url.searchParams.get('page') ?? '1'))
  const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '50')))

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

  const selectedCategories = PERFECT_MATCH_CATEGORIES.filter(
    (c) =>
      selectedCategoryIds.includes(c.id) &&
      c.fields.some((field) => isValidOdd(fixture[field]))
  )

  if (selectedCategories.length === 0) {
    return NextResponse.json({ matches: [], total: 0, page, limit, totalPages: 0 })
  }

  // Build exact-match query for all selected categories
  let query = supabase
    .from('matches')
    .select(MATCH_SELECT, { count: 'exact' })
    .not('score_ft', 'is', null)
    .neq('id', fixtureId)

  for (const category of selectedCategories) {
    for (const field of category.fields) {
      const value = fixture[field]
      if (isValidOdd(value)) {
        query = query.eq(field, value)
      }
    }
  }

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
