"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { formatOdd, getOutcomeKeys, type MatchWithScores } from '@/lib/match'
import { useFavoriteLeagues } from '@/lib/useFavoriteLeagues'
import SearchableSelect, { type SelectOption } from '@/components/SearchableSelect'

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

const PLAYED_OPTIONS: { value: 'all' | 'played' | 'unplayed'; label: string }[] = [
  { value: 'all', label: 'Tümü' },
  { value: 'unplayed', label: 'Oynanmamış' },
  { value: 'played', label: 'Oynanmış' },
]

const TIME_SLOTS = [
  { key: '00-12', label: '00-12', from: '00:00', to: '11:59' },
  { key: '12-15', label: '12-15', from: '12:00', to: '14:59' },
  { key: '15-18', label: '15-18', from: '15:00', to: '17:59' },
  { key: '18-21', label: '18-21', from: '18:00', to: '20:59' },
  { key: '21-00', label: '21-00', from: '21:00', to: '23:59' },
] as const

export default function FixtureTable({ matches }: FixtureTableProps) {
  const [searchText, setSearchText] = useState('')
  const [showPlayed, setShowPlayed] = useState<'all' | 'played' | 'unplayed'>('all')
  const [timeSlots, setTimeSlots] = useState<Set<string>>(new Set())
  const { favorites, addLeague, removeLeague, clearAll } = useFavoriteLeagues()

  const toggleTimeSlot = (key: string) => {
    setTimeSlots((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  // Derive all unique league keys from matches
  const allLeagueKeys = useMemo(() => {
    const seen = new Map<string, { country: string; display: string }>()
    for (const match of matches) {
      const key = getGroupKey(match)
      if (!seen.has(key)) {
        seen.set(key, getLeagueLabel(match))
      }
    }
    return Array.from(seen.entries())
      .sort(([, a], [, b]) => (COUNTRY_PRIORITY[a.country] ?? 90) - (COUNTRY_PRIORITY[b.country] ?? 90))
      .map(([key, info]) => ({ key, ...info }))
  }, [matches])

  // SearchableSelect options: leagues not yet in favorites
  const leagueSelectOptions = useMemo(() => {
    const favSet = new Set(favorites)
    return allLeagueKeys
      .filter((l) => !favSet.has(l.key))
      .map<SelectOption>((l) => ({
        value: l.key,
        label: l.display,
        group: l.country || undefined,
      }))
  }, [allLeagueKeys, favorites])

  // Filter matches
  const filteredMatches = useMemo(() => {
    let result = matches

    // Favorite league filter (OR logic)
    if (favorites.length > 0) {
      const favoriteSet = new Set(favorites)
      result = result.filter((m) => favoriteSet.has(getGroupKey(m)))
    }

    // Team search (Turkish locale case-insensitive)
    if (searchText.trim()) {
      const q = searchText.trim().toLocaleLowerCase('tr')
      result = result.filter(
        (m) =>
          m.home_team.toLocaleLowerCase('tr').includes(q) ||
          m.away_team.toLocaleLowerCase('tr').includes(q)
      )
    }

    // Time slot filter (multi-select, OR logic)
    if (timeSlots.size > 0) {
      const activeSlots = TIME_SLOTS.filter((s) => timeSlots.has(s.key))
      result = result.filter((m) => {
        const hhmm = formatMatchTime(m.match_date)
        return activeSlots.some((s) => hhmm >= s.from && hhmm <= s.to)
      })
    }

    // Played/Unplayed — score_ft can be null, undefined, or non-score strings like "v"
    // A match is "played" only if score_ft matches the "X - Y" pattern
    if (showPlayed === 'played') {
      result = result.filter((m) => m.score_ft && /\d+\s*-\s*\d+/.test(m.score_ft))
    } else if (showPlayed === 'unplayed') {
      result = result.filter((m) => !m.score_ft || !/\d+\s*-\s*\d+/.test(m.score_ft))
    }

    return result
  }, [matches, favorites, searchText, showPlayed, timeSlots])

  // Group filtered matches by league
  const leagueGroups = useMemo(() => {
    const groupMap = new Map<string, { country: string; display: string; matches: MatchWithScores[] }>()
    for (const match of filteredMatches) {
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
  }, [filteredMatches])

  const hasActiveFilters = favorites.length > 0 || searchText.trim() !== '' || showPlayed !== 'all' || timeSlots.size > 0

  const handleClearAll = () => {
    setSearchText('')
    setShowPlayed('all')
    setTimeSlots(new Set())
    clearAll()
  }

  const handleLeagueSelect = (value: string) => {
    // Ignore "Tümü" selection from SearchableSelect
    if (value === 'Tümü') return
    addLeague(value)
  }

  return (
    <div className="space-y-4">
      {/* Filter section */}
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-semibold text-[var(--text-tertiary)] uppercase tracking-wider">Filtreler</h3>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={handleClearAll}
              className="text-[11px] text-[var(--text-muted)] hover:text-[var(--accent-blue)] transition-colors"
            >
              Filtreleri temizle
            </button>
          )}
        </div>

        <div className="grid gap-3 md:grid-cols-2">
          {/* Team search */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Takım Ara</label>
            <input
              type="text"
              value={searchText}
              onChange={(e) => setSearchText(e.target.value)}
              placeholder="Takım ara..."
              className="bg-[var(--bg-primary)] border border-[var(--border-primary)] rounded-md px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none w-full transition-colors"
            />
          </div>

          {/* League select */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1 block">Lig Ekle</label>
            <SearchableSelect
              options={leagueSelectOptions}
              value="Tümü"
              onChange={handleLeagueSelect}
              placeholder="Lig ara..."
              allLabel="Lig seçin..."
              allValue="Tümü"
            />
          </div>
        </div>

        {/* Favorite league pills */}
        {favorites.length > 0 && (
          <div className="mt-3">
            <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">Favori Ligler</label>
            <div className="flex flex-wrap gap-1.5">
              {favorites.map((key) => {
                const info = allLeagueKeys.find((l) => l.key === key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => removeLeague(key)}
                    className="rounded-md border px-2 py-1 text-[11px] font-medium bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)] hover:brightness-110 transition-all"
                  >
                    {info?.display ?? key} ×
                  </button>
                )
              })}
            </div>
          </div>
        )}

        {/* Toggles row: Played/Unplayed + Time slots + match count */}
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="flex rounded-md border border-[var(--border-primary)] overflow-hidden">
            {PLAYED_OPTIONS.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => setShowPlayed(opt.value)}
                className={`px-3 py-1.5 text-[11px] font-medium transition-colors ${
                  showPlayed === opt.value
                    ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]'
                    : 'bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="flex rounded-md border border-[var(--border-primary)] overflow-hidden">
            {TIME_SLOTS.map((slot) => (
              <button
                key={slot.key}
                type="button"
                onClick={() => toggleTimeSlot(slot.key)}
                className={`px-2.5 py-1.5 text-[11px] font-medium font-mono tabular-nums transition-colors ${
                  timeSlots.has(slot.key)
                    ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)]'
                    : 'bg-transparent text-[var(--text-tertiary)] hover:text-[var(--text-secondary)]'
                }`}
              >
                {slot.label}
              </button>
            ))}
          </div>

          <span className="ml-auto text-[11px] text-[var(--text-muted)] font-mono tabular-nums">
            {hasActiveFilters
              ? `${filteredMatches.length} / ${matches.length} maç gösteriliyor`
              : `${matches.length} maç`}
          </span>
        </div>
      </div>

      {/* League groups */}
      <div className="space-y-4 stagger">
        {leagueGroups.length === 0 && (
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
            <p className="text-sm text-[var(--text-muted)]">Filtrelere uygun maç bulunamadı.</p>
          </div>
        )}

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
    </div>
  )
}
