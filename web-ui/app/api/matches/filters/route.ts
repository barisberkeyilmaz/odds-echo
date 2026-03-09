import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabaseClient'

type LeagueOption = {
  value: string      // raw league name (used for filtering)
  label: string      // display name
  country: string    // country for grouping
}

export async function GET() {
  // Try league_mappings table first (normalized), fallback to raw leagues
  const [mappingsResult, seasonResult] = await Promise.all([
    supabase
      .from('league_mappings')
      .select('raw_name, display_name, country, tier')
      .order('tier', { ascending: true })
      .limit(500),
    supabase.from('matches').select('season').not('season', 'is', null).limit(5000),
  ])

  let leagues: LeagueOption[]

  if (mappingsResult.data && mappingsResult.data.length > 0) {
    // Use normalized mappings
    leagues = mappingsResult.data.map((r) => ({
      value: r.raw_name as string,
      label: r.display_name as string,
      country: (r.country as string) || '',
    }))
  } else {
    // Fallback: raw league names from matches table
    const leagueResult = await supabase
      .from('matches')
      .select('league')
      .not('league', 'is', null)
      .limit(10000)

    const uniqueLeagues = Array.from(
      new Set(
        (leagueResult.data ?? [])
          .map((r) => r.league as string)
          .filter((v) => v?.trim())
      )
    ).sort((a, b) => a.localeCompare(b, 'tr'))

    leagues = uniqueLeagues.map((l) => ({ value: l, label: l, country: '' }))
  }

  const seasons = Array.from(
    new Set(
      (seasonResult.data ?? [])
        .map((r) => r.season as string)
        .filter((v) => v?.trim())
    )
  ).sort((a, b) => b.localeCompare(a))

  return NextResponse.json({ leagues, seasons })
}
