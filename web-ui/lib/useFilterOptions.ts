import { useEffect, useState } from 'react'

export type LeagueOption = {
  value: string
  label: string
  country: string
}

type FilterOptions = {
  leagues: LeagueOption[]
  seasons: string[]
}

export function useFilterOptions() {
  const [options, setOptions] = useState<FilterOptions>({ leagues: [], seasons: [] })

  useEffect(() => {
    fetch('/api/matches/filters')
      .then((res) => res.json())
      .then((data) => {
        // Handle both new format (LeagueOption[]) and old format (string[])
        const leagues: LeagueOption[] = (data.leagues ?? []).map((l: LeagueOption | string) =>
          typeof l === 'string' ? { value: l, label: l, country: '' } : l
        )
        setOptions({ leagues, seasons: data.seasons ?? [] })
      })
      .catch(() => {})
  }, [])

  return options
}

/**
 * Group leagues by country for <optgroup> rendering.
 */
export function groupLeaguesByCountry(leagues: LeagueOption[]) {
  const groups = new Map<string, LeagueOption[]>()

  for (const league of leagues) {
    const country = league.country || 'Diğer'
    const list = groups.get(country)
    if (list) {
      list.push(league)
    } else {
      groups.set(country, [league])
    }
  }

  return Array.from(groups.entries()).map(([country, items]) => ({
    country,
    items,
  }))
}
