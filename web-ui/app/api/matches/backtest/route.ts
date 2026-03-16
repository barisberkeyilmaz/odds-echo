import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type BacktestPick = {
  id: number
  run_id: string
  pick_date: string
  match_id: number
  match_code: string | null
  home_team: string
  away_team: string
  league: string | null
  match_date: string
  outcome_key: string
  outcome_label: string
  category_label: string
  odds_value: number
  wilson_lower: number
  hit_rate: number
  total_similar: number
  hit_count: number
  ev: number
  implied_prob: number
  score_ft: string | null
  score_ht: string | null
  is_hit: boolean | null
  is_settled: boolean
}

type CalibrationBracket = {
  bracket: string
  totalPicks: number
  hitCount: number
  actualHitRate: number
}

type CategoryStat = {
  label: string
  totalPicks: number
  hitCount: number
  hitRate: number
  avgEV: number
  roi: number
}

type Summary = {
  totalPicks: number
  hitCount: number
  hitRate: number
  avgEV: number
  avgOdds: number
  roi: number
  totalDays: number
  calibration: CalibrationBracket[]
  categories: CategoryStat[]
}

// ---------------------------------------------------------------------------
// Aggregation Helpers
// ---------------------------------------------------------------------------

function computeCalibration(picks: BacktestPick[]): CalibrationBracket[] {
  const brackets: { label: string; min: number; max: number }[] = [
    { label: '>60%', min: 0.60, max: 1.0 },
    { label: '50-60%', min: 0.50, max: 0.60 },
    { label: '40-50%', min: 0.40, max: 0.50 },
    { label: '30-40%', min: 0.30, max: 0.40 },
    { label: '<30%', min: 0.0, max: 0.30 },
  ]

  return brackets.map((b) => {
    const inBracket = picks.filter(
      (p) => p.wilson_lower >= b.min && p.wilson_lower < b.max
    )
    const settled = inBracket.filter((p) => p.is_settled && p.is_hit !== null)
    const hitCount = settled.filter((p) => p.is_hit).length
    return {
      bracket: b.label,
      totalPicks: settled.length,
      hitCount,
      actualHitRate: settled.length > 0 ? hitCount / settled.length : 0,
    }
  })
}

function computeCategories(picks: BacktestPick[]): CategoryStat[] {
  const categoryMap = new Map<string, BacktestPick[]>()

  for (const p of picks) {
    if (!p.is_settled || p.is_hit === null) continue
    const existing = categoryMap.get(p.category_label) ?? []
    existing.push(p)
    categoryMap.set(p.category_label, existing)
  }

  const categoryOrder = ['MS', '2.5 A/Ü', 'KG', 'İY/MS', '1.5 A/Ü', 'TG']

  return categoryOrder
    .filter((label) => categoryMap.has(label))
    .map((label) => {
      const items = categoryMap.get(label)!
      const hitCount = items.filter((p) => p.is_hit).length
      const totalPicks = items.length
      const avgEV = items.reduce((sum, p) => sum + p.ev, 0) / totalPicks
      const roi =
        items.reduce((sum, p) => sum + (p.is_hit ? p.odds_value - 1 : -1), 0) /
        totalPicks
      return {
        label,
        totalPicks,
        hitCount,
        hitRate: hitCount / totalPicks,
        avgEV: Math.round(avgEV * 10000) / 10000,
        roi: Math.round(roi * 10000) / 10000,
      }
    })
}

// ---------------------------------------------------------------------------
// Route Handler
// ---------------------------------------------------------------------------

export async function GET(request: Request) {
  const url = new URL(request.url)

  const today = new Date().toISOString().split('T')[0]
  const fromDate = url.searchParams.get('from') ?? (() => {
    const d = new Date()
    d.setDate(d.getDate() - 30)
    return d.toISOString().split('T')[0]
  })()
  const toDate = url.searchParams.get('to') ?? today

  // Tüm pick'leri çek (bounded: ~30 gün × ~50 pick/gün = ~1500 max)
  let allPicks: BacktestPick[] = []
  const batchSize = 1000
  let offset = 0

  while (true) {
    const { data, error } = await supabase
      .from('backtest_picks')
      .select('*')
      .gte('pick_date', fromDate)
      .lte('pick_date', toDate)
      .order('pick_date', { ascending: false })
      .order('wilson_lower', { ascending: false })
      .range(offset, offset + batchSize - 1)

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    const rows = (data ?? []) as BacktestPick[]
    allPicks = allPicks.concat(rows)

    if (rows.length < batchSize) break
    offset += batchSize
  }

  // Settled pick'ler
  const settled = allPicks.filter((p) => p.is_settled && p.is_hit !== null)
  const hitCount = settled.filter((p) => p.is_hit).length
  const totalPicks = settled.length

  const avgEV =
    totalPicks > 0
      ? settled.reduce((sum, p) => sum + p.ev, 0) / totalPicks
      : 0

  const avgOdds =
    totalPicks > 0
      ? settled.reduce((sum, p) => sum + p.odds_value, 0) / totalPicks
      : 0

  const roi =
    totalPicks > 0
      ? settled.reduce(
          (sum, p) => sum + (p.is_hit ? p.odds_value - 1 : -1),
          0
        ) / totalPicks
      : 0

  const uniqueDays = new Set(allPicks.map((p) => p.pick_date))

  const summary: Summary = {
    totalPicks,
    hitCount,
    hitRate: totalPicks > 0 ? hitCount / totalPicks : 0,
    avgEV: Math.round(avgEV * 10000) / 10000,
    avgOdds: Math.round(avgOdds * 100) / 100,
    roi: Math.round(roi * 10000) / 10000,
    totalDays: uniqueDays.size,
    calibration: computeCalibration(allPicks),
    categories: computeCategories(allPicks),
  }

  return NextResponse.json({
    from: fromDate,
    to: toDate,
    summary,
    picks: allPicks,
  })
}
