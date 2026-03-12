import { NextResponse } from 'next/server'
import { supabase, fetchAllRows } from '@/lib/supabaseClient'
import {
  buildMatchSelect,
  isValidOdd,
  ODDS_CATEGORIES,
  ODDS_FIELDS,
  SCORE_FIELDS,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const url = new URL(request.url)
  const resolvedParams = await params
  const matchIdFromParams = resolvedParams?.id?.trim()
  const matchIdFromUrl = (() => {
    try {
      const match = url.pathname.match(/\/api\/match\/(\d+)\/similar/)
      return match ? match[1] : ''
    } catch {
      return ''
    }
  })()
  const matchId = matchIdFromParams || matchIdFromUrl
  if (!matchId || !/^\d+$/.test(matchId)) {
    return NextResponse.json({ error: 'Geçersiz maç ID.' }, { status: 400 })
  }
  const matchIdNumber = Number(matchId)

  const tolerancePercent = Math.max(0, Math.min(10, Number(url.searchParams.get('tolerance') ?? '2')))
  const league = url.searchParams.get('league')
  const season = url.searchParams.get('season')

  const { data: baseMatch, error: baseError } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .single()

  if (baseError || !baseMatch) {
    return NextResponse.json({ error: 'Maç bulunamadı.' }, { status: 404 })
  }

  const base = baseMatch as unknown as MatchWithScores
  const toleranceValue = tolerancePercent / 100

  const availableCategories = ODDS_CATEGORIES.filter((category) =>
    category.fields.every((field) => isValidOdd(base[field]))
  )

  if (availableCategories.length === 0) {
    return NextResponse.json({ totalCategories: 0, matches: [], total: 0 })
  }

  // OR filtre string'ini bir kez hesapla
  const orFilter = (() => {
    const orParts: string[] = []
    for (const category of availableCategories) {
      const conditions: string[] = []
      for (const field of category.fields) {
        const value = base[field]
        if (toleranceValue === 0) {
          if (isValidOdd(value)) conditions.push(`${field}.eq.${value}`)
        } else {
          if (isValidOdd(value) && value !== null) {
            const toleranceAbs = Math.max(value * toleranceValue, toleranceValue)
            conditions.push(`${field}.gte.${value - toleranceAbs}`, `${field}.lte.${value + toleranceAbs}`)
          }
        }
      }
      if (conditions.length > 0) {
        orParts.push(conditions.length === 1 ? conditions[0] : `and(${conditions.join(',')})`)
      }
    }
    return orParts.join(',')
  })()

  let allData: MatchWithScores[]
  try {
    allData = await fetchAllRows<MatchWithScores>(() => {
      let q = supabase
        .from('matches')
        .select(MATCH_SELECT)
        .not('score_ft', 'is', null)
        .neq('id', matchIdNumber)

      if (orFilter) q = q.or(orFilter)
      if (league) q = q.eq('league', league)
      if (season) q = q.eq('season', season)

      return q.order('match_date', { ascending: false })
    })
  } catch {
    return NextResponse.json({ error: 'Benzer maçlar alınamadı.' }, { status: 500 })
  }

  // Deduplicate
  const seen = new Set<number>()
  const candidates = allData.filter((row) => {
    if (seen.has(row.id)) return false
    seen.add(row.id)
    return true
  })

  // Client-side: check all categories and calculate match counts
  const isSimilar = (baseVal: number, candidateVal: number) => {
    if (toleranceValue === 0) return baseVal === candidateVal
    const diff = Math.abs(baseVal - candidateVal)
    return diff <= toleranceValue || diff <= Math.max(baseVal, candidateVal) * toleranceValue
  }

  const isCatMatch = (candidate: MatchWithScores, fields: OddsKey[]) =>
    fields.every((field) => {
      const bv = base[field]
      const cv = candidate[field]
      if (!isValidOdd(bv) || !isValidOdd(cv) || bv === null || cv === null) return false
      return isSimilar(bv, cv)
    })

  const similarMatches = candidates
    .map((candidate) => {
      const matchedCategoryIds = availableCategories
        .filter((category) => isCatMatch(candidate, category.fields))
        .map((category) => category.id)

      const odds = ODDS_FIELDS.reduce<Record<OddsKey, number | null>>((acc, field) => {
        acc[field] = candidate[field]
        return acc
      }, {} as Record<OddsKey, number | null>)

      return {
        ...odds,
        id: candidate.id,
        home_team: candidate.home_team,
        away_team: candidate.away_team,
        match_date: candidate.match_date,
        league: candidate.league,
        season: candidate.season,
        score_ht: candidate.score_ht ?? null,
        score_ft: candidate.score_ft ?? null,
        matchCount: matchedCategoryIds.length,
        matchedCategoryIds,
      }
    })
    .filter((match) => match.matchCount > 0)
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
      return new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
    })

  return NextResponse.json({
    totalCategories: availableCategories.length,
    matches: similarMatches,
    total: similarMatches.length,
  })
}
