import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'
import {
  buildMatchSelect,
  isValidOdd,
  getOutcomeKeys,
  SCORE_FIELDS,
  ODDS_FIELDS,
  type OddsKey,
} from '@/lib/match'
import { IYMS_KEYS } from '@/lib/surprise'

type SelectionInput = {
  matchId: number
  outcomeKey: OddsKey
  tolerancePct: number
}

const SCORE_RE = /\d+\s*-\s*\d+/

/**
 * MS oranları — maçın profilini belirler (favori kim, ne kadar güçlü).
 * Hibrit yaklaşım: hedef oranın yanında MS oranlarını da eşleştirerek
 * "benzer profildeki maçlarda bu sonuç ne kadar tutmuş?" sorusunu cevaplarız.
 */
const MS_PROFILE_FIELDS: OddsKey[] = ['ms_1', 'ms_x', 'ms_2']

const SELECT_FIELDS = [...SCORE_FIELDS, ...ODDS_FIELDS].join(', ')

/** Bir oran değeri için tolerans aralığı hesapla */
const getToleranceRange = (value: number, tolerance: number) => {
  const toleranceAbs = Math.max(value * tolerance, tolerance)
  return { lower: value - toleranceAbs, upper: value + toleranceAbs }
}

export async function POST(request: Request) {
  let body: { selections: SelectionInput[] }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Geçersiz JSON.' }, { status: 400 })
  }

  const { selections } = body
  if (!Array.isArray(selections) || selections.length === 0) {
    return NextResponse.json({ error: 'Seçim listesi boş.' }, { status: 400 })
  }

  // Deduplicate: same matchId might appear in multiple selections but we only
  // need to fetch the base match once
  const baseMatchCache = new Map<number, Record<string, unknown> | null>()

  const results: Record<string, { totalSimilar: number; hitCount: number; hitRate: number }> = {}

  await Promise.all(
    selections.map(async (sel) => {
      const { matchId, outcomeKey, tolerancePct } = sel
      const compositeKey = `${matchId}_${outcomeKey}`
      const tolerance = Math.max(0, Math.min(25, tolerancePct)) / 100

      // Get or cache the base match
      let base: Record<string, unknown> | null = null
      if (baseMatchCache.has(matchId)) {
        base = baseMatchCache.get(matchId) ?? null
      } else {
        const { data: baseMatch, error: baseError } = await supabase
          .from('matches')
          .select(buildMatchSelect(SCORE_FIELDS))
          .eq('id', matchId)
          .single()

        if (baseError || !baseMatch) {
          baseMatchCache.set(matchId, null)
        } else {
          base = baseMatch as unknown as Record<string, unknown>
          baseMatchCache.set(matchId, base)
        }
      }

      if (!base) {
        results[compositeKey] = { totalSimilar: 0, hitCount: 0, hitRate: 0 }
        return
      }

      const oddValue = base[outcomeKey] as number | null
      if (!isValidOdd(oddValue) || oddValue === null) {
        results[compositeKey] = { totalSimilar: 0, hitCount: 0, hitRate: 0 }
        return
      }

      // İY/MS outcomes need both score_ft and score_ht
      const isIyms = IYMS_KEYS.includes(outcomeKey)

      // Hedef sonucun oran aralığı
      const targetRange = getToleranceRange(oddValue, tolerance)

      let query = supabase
        .from('matches')
        .select(SELECT_FIELDS)
        .not('score_ft', 'is', null)
        .neq('id', matchId)
        .gte(outcomeKey, targetRange.lower)
        .lte(outcomeKey, targetRange.upper)

      // Hibrit: MS profil eşleştirmesi (ms_1, ms_x, ms_2)
      // Maçın genel profilini (favori/underdog/dengeli) belirler
      for (const msField of MS_PROFILE_FIELDS) {
        const msValue = base[msField] as number | null
        if (isValidOdd(msValue) && msValue !== null) {
          const msRange = getToleranceRange(msValue, tolerance)
          query = query.gte(msField, msRange.lower).lte(msField, msRange.upper)
        }
      }

      if (isIyms) {
        query = query.not('score_ht', 'is', null)
      }

      // Limit yok — tüm tarihsel veriye bakıyoruz
      const { data: candidates, error: candError } = await query

      if (candError || !candidates) {
        results[compositeKey] = { totalSimilar: 0, hitCount: 0, hitRate: 0 }
        return
      }

      // Filter candidates with valid score patterns
      const validCandidates = candidates.filter((c) => {
        const cand = c as unknown as Record<string, unknown>
        const ft = cand.score_ft as string | null
        if (!ft || !SCORE_RE.test(ft)) return false
        if (isIyms) {
          const ht = cand.score_ht as string | null
          if (!ht || !SCORE_RE.test(ht)) return false
        }
        return true
      })

      const totalSimilar = validCandidates.length
      let hitCount = 0

      for (const candidate of validCandidates) {
        const cand = candidate as unknown as Record<string, unknown>
        const outcomeSet = getOutcomeKeys({
          score_ft: cand.score_ft as string | null,
          score_ht: cand.score_ht as string | null,
        })
        if (outcomeSet.has(outcomeKey)) {
          hitCount++
        }
      }

      const hitRate = totalSimilar > 0 ? hitCount / totalSimilar : 0
      results[compositeKey] = { totalSimilar, hitCount, hitRate }
    })
  )

  return NextResponse.json({ results })
}
