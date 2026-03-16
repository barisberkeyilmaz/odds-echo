import { NextResponse } from 'next/server'
import { supabase, fetchAllRows } from '@/lib/supabaseClient'
import {
  buildMatchSelect,
  isValidOdd,
  getOutcomeKeys,
  SCORE_FIELDS,
  ODDS_FIELDS,
  type OddsKey,
  type MatchWithScores,
} from '@/lib/match'
import { OUTCOME_LABELS, OUTCOME_CATEGORY, IYMS_KEYS } from '@/lib/surprise'
import { wilsonLower, wilsonEV } from '@/lib/stats'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type PickData = {
  matchId: number
  matchCode: string
  homeTeam: string
  awayTeam: string
  league: string
  matchDate: string
  outcomeKey: OddsKey
  outcomeLabel: string
  categoryLabel: string
  oddsValue: number
  wilsonLower: number
  hitRate: number
  totalSimilar: number
  hitCount: number
  ev: number
  impliedProb: number
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const MS_PROFILE_FIELDS: OddsKey[] = ['ms_1', 'ms_x', 'ms_2']
const SCORE_RE = /\d+\s*-\s*\d+/
const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

const FILTER_CONFIG = { minSamples: 50 }

const TOLERANCE = 0.05 // %5

/** Tolerans aralığı hesapla */
const toleranceRange = (value: number) => {
  const abs = Math.max(value * TOLERANCE, TOLERANCE)
  return { lower: value - abs, upper: value + abs }
}

// ---------------------------------------------------------------------------
// Live hesaplama
// ---------------------------------------------------------------------------

async function computeLive(dateKey: string, outcomeTypes: OddsKey[]): Promise<PickData[]> {
  // 1. Günün fixture'larını çek
  const { data: matchData } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .gte('match_date', `${dateKey}T00:00:00`)
    .lte('match_date', `${dateKey}T23:59:59`)
    .order('match_date', { ascending: true })

  const fixtures = ((matchData ?? []) as unknown as MatchWithScores[]).filter((m) => {
    if (m.score_ft && SCORE_RE.test(m.score_ft)) return false // oynanmış
    return isValidOdd(m.ms_1) && isValidOdd(m.ms_x)
  })

  if (fixtures.length === 0) return []

  // 2. Tüm kandidatları hesapla
  const allCandidates: PickData[] = []

  for (const fixture of fixtures) {
    const msRanges = MS_PROFILE_FIELDS.map((field) => {
      const val = fixture[field]
      if (!isValidOdd(val) || val === null) return null
      return { field, ...toleranceRange(val) }
    }).filter(Boolean) as { field: OddsKey; lower: number; upper: number }[]

    for (const outcomeKey of outcomeTypes) {
      const oddValue = fixture[outcomeKey]
      if (!isValidOdd(oddValue) || oddValue === null) continue

      const isIyms = IYMS_KEYS.includes(outcomeKey)
      const range = toleranceRange(oddValue)

      let historical: Record<string, unknown>[]
      try {
        historical = await fetchAllRows<Record<string, unknown>>(() => {
          let q = supabase
            .from('matches')
            .select(SCORE_FIELDS.join(', '))
            .not('score_ft', 'is', null)
            .neq('id', fixture.id)
            .gte(outcomeKey, range.lower)
            .lte(outcomeKey, range.upper)

          for (const ms of msRanges) {
            q = q.gte(ms.field, ms.lower).lte(ms.field, ms.upper)
          }
          if (isIyms) q = q.not('score_ht', 'is', null)
          return q
        })
      } catch {
        continue
      }

      // Valid score filtrele
      const valid = historical.filter((h) => {
        const ft = h.score_ft as string | null
        if (!ft || !SCORE_RE.test(ft)) return false
        if (isIyms) {
          const ht = h.score_ht as string | null
          if (!ht || !SCORE_RE.test(ht)) return false
        }
        return true
      })

      const totalSimilar = valid.length
      if (totalSimilar < FILTER_CONFIG.minSamples) continue

      const hitCount = valid.filter((v) => {
        const outcomeSet = getOutcomeKeys({
          score_ft: v.score_ft as string | null,
          score_ht: v.score_ht as string | null,
        })
        return outcomeSet.has(outcomeKey)
      }).length

      const wl = wilsonLower(hitCount, totalSimilar)
      const ev = wilsonEV(hitCount, totalSimilar, oddValue)

      allCandidates.push({
        matchId: fixture.id,
        matchCode: (fixture as unknown as Record<string, unknown>).match_code as string ?? '',
        homeTeam: fixture.home_team,
        awayTeam: fixture.away_team,
        league: fixture.league,
        matchDate: fixture.match_date,
        outcomeKey,
        outcomeLabel: OUTCOME_LABELS[outcomeKey] ?? outcomeKey,
        categoryLabel: OUTCOME_CATEGORY[outcomeKey] ?? '',
        oddsValue: oddValue,
        wilsonLower: Math.round(wl * 10000) / 10000,
        hitRate: Math.round((hitCount / totalSimilar) * 10000) / 10000,
        totalSimilar,
        hitCount,
        ev: Math.round(ev * 10000) / 10000,
        impliedProb: Math.round((1 / oddValue) * 10000) / 10000,
      })
    }
  }

  // 3. wilsonLower desc sırala
  allCandidates.sort((a, b) => b.wilsonLower - a.wilsonLower)

  // 4. Aynı maç + aynı kategoriden sadece en iyi Wilson'lı olanı tut
  const seen = new Set<string>()
  const deduplicated = allCandidates.filter((c) => {
    const key = `${c.matchId}::${c.categoryLabel}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  return deduplicated
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)

  const todayKey = new Date().toISOString().split('T')[0]
  const dateKey = url.searchParams.get('date') ?? todayKey

  // outcomeTypes parametresi (virgülle ayrılmış)
  const outcomeTypesParam = url.searchParams.get('outcomeTypes')
  const outcomeTypes: OddsKey[] = outcomeTypesParam
    ? (outcomeTypesParam.split(',') as OddsKey[])
    : (ODDS_FIELDS as OddsKey[])

  const candidates = await computeLive(dateKey, outcomeTypes)
  return NextResponse.json({ date: dateKey, candidates })
}
