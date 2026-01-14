import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import {
  buildMatchSelect,
  isCategoryMatch,
  isValidOdd,
  ODDS_CATEGORIES,
  ODDS_FIELDS,
  SCORE_FIELDS,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'

const SIMILARITY_TOLERANCE_ABS = 0.05
const SIMILARITY_TOLERANCE_PCT = 0.04
const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)
const PAGE_SIZE = 1000

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const matchIdFromParams = params?.id?.trim()
  const matchIdFromUrl = (() => {
    try {
      const url = new URL(_.url)
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

  const { data: baseMatch, error: baseError } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .single()

  if (baseError || !baseMatch) {
    return NextResponse.json({ error: 'Maç bulunamadı.' }, { status: 404 })
  }

  const availableCategories = ODDS_CATEGORIES.filter((category) =>
    category.fields.every((field) => isValidOdd((baseMatch as MatchWithScores)[field]))
  )

  if (availableCategories.length === 0) {
    return NextResponse.json({ totalCategories: 0, matches: [] })
  }

  const candidates: MatchWithScores[] = []
  const seenIds = new Set<number>()

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('status', 'MS')
      .not('score_ft', 'is', null)
      .neq('id', matchIdNumber)
      .order('match_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error || !data) {
      return NextResponse.json({ error: 'Benzer maçlar alınamadı.' }, { status: 500 })
    }

    for (const candidate of data as MatchWithScores[]) {
      if (seenIds.has(candidate.id)) continue
      seenIds.add(candidate.id)
      candidates.push(candidate)
    }
    if (data.length < PAGE_SIZE) break
  }

  const similarMatches = candidates
    .filter((candidate) => candidate.id !== matchIdNumber)
    .map((candidate) => {
      const matchedCategoryIds = availableCategories
        .filter((category) =>
          isCategoryMatch(
            baseMatch as MatchWithScores,
            candidate,
            category.fields,
            SIMILARITY_TOLERANCE_ABS,
            SIMILARITY_TOLERANCE_PCT
          )
        )
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
  })
}
