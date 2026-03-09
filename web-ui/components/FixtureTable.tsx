"use client"

import { useMemo } from 'react'
import Link from 'next/link'
import { formatOdd, getOutcomeKeys, type MatchWithScores } from '@/lib/match'

type FixtureTableProps = {
  matches: MatchWithScores[]
}

const formatMatchTime = (value: string) =>
  new Date(value).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })

// Country-level priority for sorting groups.
// Lower = higher priority. Unlisted countries default to 90.
const COUNTRY_PRIORITY: Record<string, number> = {
  'Türkiye': 1,
  'UEFA': 2,
  'İngiltere': 3,
  'İspanya': 4,
  'İtalya': 5,
  'Almanya': 6,
  'Fransa': 7,
  'Hollanda': 8,
  'Portekiz': 9,
  'Belçika': 10,
  'İskoçya': 11,
  'Rusya': 12,
  'Polonya': 13,
  'Yunanistan': 14,
  'Hırvatistan': 15,
  'Romanya': 16,
  'Sırbistan': 17,
  'Danimarka': 18,
  'Norveç': 19,
  'İsveç': 20,
  'İsviçre': 21,
  'Avusturya': 22,
  'Ukrayna': 23,
  'Slovenya': 24,
  'Bulgaristan': 25,
  'Azerbaycan': 26,
  'Gürcistan': 27,
  'Kuzey İrlanda': 28,
  'Arnavutluk': 29,
  'CONCACAF': 50,
  'Copa Libertadores': 51,
  'AFC': 52,
  'Brezilya': 53,
  'Arjantin': 54,
  'ABD': 40,
  'Meksika': 56,
  'Suudi Arabistan': 60,
  'Mısır': 61,
  'Uluslararası': 99,
}

/**
 * Get display-ready league label.
 * If league_display + league_country are available (post-normalization), use them.
 * Otherwise, fall back to raw league name.
 */
const getLeagueLabel = (match: MatchWithScores) => {
  if (match.league_display && match.league_country) {
    return { country: match.league_country, display: match.league_display }
  }
  // Fallback: raw league is the full label, country unknown
  return { country: '', display: match.league?.trim() || 'Bilinmeyen Lig' }
}

/**
 * Build a group key that combines country + display for unique grouping.
 * E.g. "Türkiye :: Süper Lig"
 */
const getGroupKey = (match: MatchWithScores) => {
  const { country, display } = getLeagueLabel(match)
  return country ? `${country} :: ${display}` : display
}

type LeagueGroup = {
  key: string
  country: string
  display: string
  matches: MatchWithScores[]
}

export default function FixtureTable({ matches }: FixtureTableProps) {
  const leagueGroups = useMemo(() => {
    // Group by league
    const groupMap = new Map<string, { country: string; display: string; matches: MatchWithScores[] }>()
    for (const match of matches) {
      const key = getGroupKey(match)
      const existing = groupMap.get(key)
      if (existing) {
        existing.matches.push(match)
      } else {
        const { country, display } = getLeagueLabel(match)
        groupMap.set(key, { country, display, matches: [match] })
      }
    }

    // Sort matches within each group by time
    for (const group of groupMap.values()) {
      group.matches.sort((a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime())
    }

    // Sort groups by country priority, then alphabetically
    const groups: LeagueGroup[] = Array.from(groupMap.entries()).map(([key, g]) => ({
      key,
      country: g.country,
      display: g.display,
      matches: g.matches,
    }))

    groups.sort((a, b) => {
      const prioA = COUNTRY_PRIORITY[a.country] ?? 90
      const prioB = COUNTRY_PRIORITY[b.country] ?? 90
      if (prioA !== prioB) return prioA - prioB
      return a.key.localeCompare(b.key, 'tr')
    })

    return groups
  }, [matches])

  return (
    <div className="space-y-4 stagger">
      {leagueGroups.map((group) => (
        <section key={group.key} className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] card-glow overflow-hidden">
          {/* League header */}
          <div className="flex items-center justify-between px-4 py-2.5 bg-[var(--bg-tertiary)] border-b border-[var(--border-primary)]">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">
              {group.country ? (
                <>
                  <span className="text-[var(--text-tertiary)]">{group.country}</span>
                  <span className="text-[var(--text-muted)] mx-1.5">·</span>
                  {group.display}
                </>
              ) : (
                group.display
              )}
            </h3>
            <span className="text-[11px] text-[var(--text-muted)] font-mono">{group.matches.length} maç</span>
          </div>

          {/* Matches table */}
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm whitespace-nowrap table-fixed">
              <colgroup>
                <col className="w-[70px]" />
                <col />
                <col className="w-[110px]" />
                <col className="w-[72px]" />
                <col className="w-[72px]" />
                <col className="w-[72px]" />
                <col className="w-[80px]" />
              </colgroup>
              <thead className="text-xs uppercase tracking-wider text-[var(--text-tertiary)] border-b border-[var(--border-subtle)]">
                <tr>
                  <th className="px-3 py-2 text-left font-medium">Saat</th>
                  <th className="px-3 py-2 text-left font-medium">Maç</th>
                  <th className="px-3 py-2 text-center font-medium">Skor</th>
                  <th className="px-3 py-2 text-center font-medium">MS 1</th>
                  <th className="px-3 py-2 text-center font-medium">MS X</th>
                  <th className="px-3 py-2 text-center font-medium">MS 2</th>
                  <th className="px-3 py-2 text-right font-medium">Analiz</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--border-subtle)]">
                {group.matches.map((match) => {
                  const outcomeKeys = getOutcomeKeys(match)
                  const neutralOddsClass = 'text-[var(--text-primary)]'
                  const ms1Class = outcomeKeys.has('ms_1') ? 'text-[var(--accent-win)] bg-[var(--accent-win-bg)]' : neutralOddsClass
                  const msxClass = outcomeKeys.has('ms_x') ? 'text-[var(--accent-win)] bg-[var(--accent-win-bg)]' : neutralOddsClass
                  const ms2Class = outcomeKeys.has('ms_2') ? 'text-[var(--accent-win)] bg-[var(--accent-win-bg)]' : neutralOddsClass
                  const scoreLabel = match.score_ht
                    ? `${match.score_ft ?? '-'} (İY ${match.score_ht})`
                    : match.score_ft ?? '-'

                  return (
                    <tr key={match.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                      <td className="px-3 py-2 text-[var(--text-secondary)] font-mono text-xs" suppressHydrationWarning>
                        {formatMatchTime(match.match_date)}
                      </td>
                      <td className="px-3 py-2 text-[var(--text-primary)] font-semibold truncate" title={`${match.home_team} vs ${match.away_team}`}>
                        {match.home_team} vs {match.away_team}
                      </td>
                      <td className="px-3 py-2 text-center text-xs text-[var(--text-tertiary)] font-mono">
                        {scoreLabel}
                      </td>
                      <td className={`px-3 py-2 text-center font-mono tabular-nums ${ms1Class}`}>{formatOdd(match.ms_1)}</td>
                      <td className={`px-3 py-2 text-center font-mono tabular-nums ${msxClass}`}>{formatOdd(match.ms_x)}</td>
                      <td className={`px-3 py-2 text-center font-mono tabular-nums ${ms2Class}`}>{formatOdd(match.ms_2)}</td>
                      <td className="px-3 py-2 text-right">
                        <Link
                          href={`/analysis/${match.id}`}
                          className="inline-flex items-center gap-2 rounded-md bg-[var(--accent-blue-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--accent-blue)] hover:brightness-110 transition-all"
                        >
                          Analiz
                        </Link>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  )
}
