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

function buildCategoryFilter(fixture: MatchWithScores, category: typeof PERFECT_MATCH_CATEGORIES[number]) {
  const conditions: string[] = []
  for (const field of category.fields) {
    const value = fixture[field]
    if (isValidOdd(value)) {
      conditions.push(`${field}.eq.${value}`)
    }
  }
  return conditions
}

function buildOrFilter(fixture: MatchWithScores, categories: typeof PERFECT_MATCH_CATEGORIES) {
  const parts: string[] = []
  for (const category of categories) {
    const conditions = buildCategoryFilter(fixture, category)
    if (conditions.length > 0) {
      parts.push(conditions.length === 1 ? conditions[0] : `and(${conditions.join(',')})`)
    }
  }
  return parts
}

export async function POST(request: Request) {
  const body = await request.json()
  const fixtureIds: number[] = body.fixtureIds ?? []
  const categoryIdsParam: string[] = body.categories ?? PERFECT_MATCH_CATEGORIES.map((c) => c.id)
  const league: string | undefined = body.league
  const season: string | undefined = body.season

  if (fixtureIds.length === 0) {
    return NextResponse.json({ counts: {} })
  }

  const { data: fixturesData, error: fixturesError } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .in('id', fixtureIds)

  if (fixturesError || !fixturesData) {
    return NextResponse.json({ error: 'Failed to fetch fixtures' }, { status: 500 })
  }

  const fixtures = fixturesData as unknown as MatchWithScores[]
  const counts: Record<number, { total: number; matchedCategories: string[] }> = {}

  const requestedCategories = PERFECT_MATCH_CATEGORIES.filter(
    (c) => categoryIdsParam.includes(c.id)
  )

  const promises = fixtures.map(async (fixture) => {
    const fixtureDate = fixture.match_date?.split('T')[0] ?? ''

    // Run per-category existence checks in parallel
    const categoryChecks = await Promise.all(
      requestedCategories.map(async (category) => {
        const conditions = buildCategoryFilter(fixture, category)
        if (conditions.length === 0) return { id: category.id, hasMatch: false }

        const filter = conditions.length === 1 ? conditions[0] : `and(${conditions.join(',')})`

        let query = supabase
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .not('score_ft', 'is', null)
          .neq('id', fixture.id)
          .lt('match_date', `${fixtureDate}T00:00:00`)
          .or(filter)

        if (league) query = query.eq('league', league)
        if (season) query = query.eq('season', season)

        const { count, error } = await query
        return { id: category.id, hasMatch: !error && (count ?? 0) > 0 }
      })
    )

    const matchedCategories = categoryChecks
      .filter((c) => c.hasMatch)
      .map((c) => c.id)

    // Get total count with OR (all categories combined)
    let total = 0
    if (matchedCategories.length > 0) {
      const orParts = buildOrFilter(fixture, requestedCategories)
      if (orParts.length > 0) {
        let query = supabase
          .from('matches')
          .select('id', { count: 'exact', head: true })
          .not('score_ft', 'is', null)
          .neq('id', fixture.id)
          .lt('match_date', `${fixtureDate}T00:00:00`)
          .or(orParts.join(','))

        if (league) query = query.eq('league', league)
        if (season) query = query.eq('season', season)

        const { count, error } = await query
        total = error ? 0 : (count ?? 0)
      }
    }

    counts[fixture.id] = { total, matchedCategories }
  })

  await Promise.all(promises)

  return NextResponse.json({ counts })
}
