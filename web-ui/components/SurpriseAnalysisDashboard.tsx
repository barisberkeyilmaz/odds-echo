"use client"

import { useState, useCallback, useEffect, useRef, useMemo } from 'react'
import type { Fixture, OddsKey } from '@/lib/match/types'
import { isValidOdd, formatOdd } from '@/lib/match/utils'
import {
  IYMS_SURPRISE_KEYS,
  ALL_ODDS_KEYS,
  OUTCOME_LABELS,
  OUTCOME_CATEGORY,
  DEFAULT_SURPRISE_THRESHOLD,
  MIN_SURPRISE_THRESHOLD,
  MAX_SURPRISE_THRESHOLD,
  THRESHOLD_STEP,
  DEFAULT_TOLERANCE_PCT,
  MIN_TOLERANCE_PCT,
  MAX_TOLERANCE_PCT,
} from '@/lib/surprise'
import SearchableSelect, { type SelectOption } from '@/components/SearchableSelect'
import { useFavoriteLeagues } from '@/lib/useFavoriteLeagues'

type Props = { fixtures: Fixture[] }

// Country-level priority for sorting groups.
// Lower = higher priority. Unlisted countries default to 90.
const COUNTRY_PRIORITY: Record<string, number> = {
  'Türkiye': 1, 'UEFA': 2, 'İngiltere': 3, 'İspanya': 4, 'İtalya': 5,
  'Almanya': 6, 'Fransa': 7, 'Hollanda': 8, 'Portekiz': 9, 'Belçika': 10,
  'İskoçya': 11, 'Rusya': 12, 'Polonya': 13, 'Yunanistan': 14,
  'Hırvatistan': 15, 'Romanya': 16, 'Sırbistan': 17, 'Danimarka': 18,
  'Norveç': 19, 'İsveç': 20, 'İsviçre': 21, 'Avusturya': 22, 'Ukrayna': 23,
  'ABD': 40, 'CONCACAF': 50, 'Brezilya': 53, 'Arjantin': 54,
  'Suudi Arabistan': 60, 'Uluslararası': 99,
}

const getLeagueLabel = (f: Fixture) => {
  if (f.league_display && f.league_country) {
    return { country: f.league_country, display: f.league_display }
  }
  return { country: '', display: f.league?.trim() || 'Bilinmeyen Lig' }
}

const getGroupKey = (f: Fixture) => {
  const { country, display } = getLeagueLabel(f)
  return country ? `${country} :: ${display}` : display
}

type SurpriseEntry = {
  matchId: number
  outcomeKey: OddsKey
  oddValue: number
  label: string
  categoryLabel: string
  isCoreIyms: boolean
}

type HitRateResult = {
  totalSimilar: number
  hitCount: number
  hitRate: number
}

type SurpriseWithStats = SurpriseEntry & HitRateResult & {
  impliedProb: number
  surpriseScore: number
}

type MatchSurpriseGroup = {
  fixture: Fixture
  entries: SurpriseWithStats[]
  bestScore: number
}

type SortKey = 'surpriseScore' | 'hitRate' | 'odds'

function formatTime(dateStr: string) {
  return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
}

function scoreBadgeClass(score: number) {
  if (score >= 2.0) return 'bg-[var(--accent-win-bg)] text-[var(--accent-win)]'
  if (score >= 1.0) return 'bg-[var(--accent-draw-bg)] text-[var(--accent-draw)]'
  return 'bg-[var(--accent-loss-bg)] text-[var(--accent-loss)]'
}

function hitRateClass(hitRate: number, impliedProb: number) {
  if (hitRate >= impliedProb * 1.5) return 'text-[var(--accent-win)]'
  if (hitRate >= impliedProb) return 'text-[var(--accent-draw)]'
  return 'text-[var(--accent-loss)]'
}

export default function SurpriseAnalysisDashboard({ fixtures }: Props) {
  const [threshold, setThreshold] = useState(DEFAULT_SURPRISE_THRESHOLD)
  const [tolerancePct, setTolerancePct] = useState(DEFAULT_TOLERANCE_PCT)
  const [sortBy, setSortBy] = useState<SortKey>('surpriseScore')
  const [showOnlyIyms, setShowOnlyIyms] = useState(false)
  const [statsMap, setStatsMap] = useState<Record<string, HitRateResult>>({})
  const [isLoading, setIsLoading] = useState(false)
  const [expandedMatchIds, setExpandedMatchIds] = useState<Set<number>>(new Set())
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const { favorites, addLeague, removeLeague, clearAll: clearLeagues } = useFavoriteLeagues()

  // All unique league keys sorted by country priority
  const allLeagueKeys = useMemo(() => {
    const seen = new Map<string, { country: string; display: string }>()
    for (const f of fixtures) {
      const key = getGroupKey(f)
      if (!seen.has(key)) seen.set(key, getLeagueLabel(f))
    }
    return Array.from(seen.entries())
      .sort(([, a], [, b]) => (COUNTRY_PRIORITY[a.country] ?? 90) - (COUNTRY_PRIORITY[b.country] ?? 90))
      .map(([key, info]) => ({ key, ...info }))
  }, [fixtures])

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

  const handleLeagueSelect = useCallback((value: string) => {
    if (value === 'Tümü') return
    addLeague(value)
  }, [addLeague])

  // Filtered fixtures
  const filteredFixtures = useMemo(() => {
    if (favorites.length === 0) return fixtures
    const favSet = new Set(favorites)
    return fixtures.filter((f) => favSet.has(getGroupKey(f)))
  }, [fixtures, favorites])

  // Extract surprise entries from fixtures
  const allEntries = useMemo(() => {
    const entries: SurpriseEntry[] = []

    for (const fixture of filteredFixtures) {
      for (const key of ALL_ODDS_KEYS) {
        const value = fixture[key]
        if (!isValidOdd(value) || value === null) continue

        const isCoreIyms = IYMS_SURPRISE_KEYS.includes(key)

        // Her şey eşik kontrolünden geçmeli
        if (value < threshold) continue
        // If showOnlyIyms, skip non-İY/MS entries
        if (showOnlyIyms && !isCoreIyms) continue

        entries.push({
          matchId: fixture.id,
          outcomeKey: key,
          oddValue: value,
          label: OUTCOME_LABELS[key],
          categoryLabel: OUTCOME_CATEGORY[key],
          isCoreIyms,
        })
      }
    }

    return entries
  }, [filteredFixtures, threshold, showOnlyIyms])

  // Fetch stats when entries or tolerance change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (allEntries.length === 0) {
      setStatsMap({})
      return
    }

    debounceRef.current = setTimeout(async () => {
      setIsLoading(true)
      try {
        const selections = allEntries.map((e) => ({
          matchId: e.matchId,
          outcomeKey: e.outcomeKey,
          tolerancePct,
        }))

        // Batch in chunks of 50
        const CHUNK_SIZE = 50
        const allResults: Record<string, HitRateResult> = {}

        for (let i = 0; i < selections.length; i += CHUNK_SIZE) {
          const chunk = selections.slice(i, i + CHUNK_SIZE)
          const res = await fetch('/api/matches/surprise-stats', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ selections: chunk }),
          })
          if (res.ok) {
            const data = await res.json()
            Object.assign(allResults, data.results ?? {})
          }
        }

        setStatsMap(allResults)
      } catch {
        // silent
      } finally {
        setIsLoading(false)
      }
    }, 500)

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [allEntries, tolerancePct])

  // Build enriched entries with stats
  const enrichedEntries = useMemo((): SurpriseWithStats[] => {
    return allEntries.map((entry) => {
      const key = `${entry.matchId}_${entry.outcomeKey}`
      const stat = statsMap[key] ?? { totalSimilar: 0, hitCount: 0, hitRate: 0 }
      const impliedProb = 1 / entry.oddValue
      const surpriseScore = stat.hitRate > 0 ? stat.hitRate / impliedProb : 0

      return { ...entry, ...stat, impliedProb, surpriseScore }
    })
  }, [allEntries, statsMap])

  // Group by match and sort
  const matchGroups = useMemo((): MatchSurpriseGroup[] => {
    const groupMap = new Map<number, MatchSurpriseGroup>()

    for (const entry of enrichedEntries) {
      const fixture = filteredFixtures.find((f) => f.id === entry.matchId)
      if (!fixture) continue

      let group = groupMap.get(entry.matchId)
      if (!group) {
        group = { fixture, entries: [], bestScore: 0 }
        groupMap.set(entry.matchId, group)
      }
      group.entries.push(entry)
    }

    // Sort entries within each group and compute bestScore
    for (const group of groupMap.values()) {
      group.entries.sort((a, b) => b.surpriseScore - a.surpriseScore)
      group.bestScore = group.entries[0]?.surpriseScore ?? 0
    }

    // Tarihsel veri yüklendikten sonra, hiç profil eşleşmesi olmayan maçları gizle
    const groups = Array.from(groupMap.values()).filter((g) => {
      if (isLoading) return true // yüklenirken hepsini göster
      return g.entries.some((e) => e.totalSimilar > 0)
    })

    // Sort groups
    if (sortBy === 'surpriseScore') {
      groups.sort((a, b) => b.bestScore - a.bestScore)
    } else if (sortBy === 'hitRate') {
      groups.sort((a, b) => {
        const aMax = Math.max(...a.entries.map((e) => e.hitRate))
        const bMax = Math.max(...b.entries.map((e) => e.hitRate))
        return bMax - aMax
      })
    } else {
      groups.sort((a, b) => {
        const aMax = Math.max(...a.entries.map((e) => e.oddValue))
        const bMax = Math.max(...b.entries.map((e) => e.oddValue))
        return bMax - aMax
      })
    }

    return groups
  }, [enrichedEntries, filteredFixtures, sortBy, isLoading])

  // Summary stats
  const summary = useMemo(() => {
    const matchCount = matchGroups.length
    const entryCount = enrichedEntries.length
    const ratesWithData = enrichedEntries.filter((e) => e.totalSimilar > 0)
    const avgHitRate =
      ratesWithData.length > 0
        ? ratesWithData.reduce((sum, e) => sum + e.hitRate, 0) / ratesWithData.length
        : 0
    return { matchCount, entryCount, avgHitRate }
  }, [matchGroups, enrichedEntries])

  const toggleExpanded = useCallback((matchId: number) => {
    setExpandedMatchIds((prev) => {
      const next = new Set(prev)
      if (next.has(matchId)) next.delete(matchId)
      else next.add(matchId)
      return next
    })
  }, [])

  const sortOptions: { value: SortKey; label: string }[] = [
    { value: 'surpriseScore', label: 'Sürpriz Skor' },
    { value: 'hitRate', label: 'Tutma Oranı' },
    { value: 'odds', label: 'Oran Değeri' },
  ]

  return (
    <>
      {/* Controls */}
      <div className="relative z-20 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-4 mb-4 overflow-visible">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {/* Threshold slider */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">
              Min. Oran Eşiği: <span className="font-mono text-[var(--text-primary)]">{threshold.toFixed(1)}</span>
            </label>
            <input
              type="range"
              min={MIN_SURPRISE_THRESHOLD}
              max={MAX_SURPRISE_THRESHOLD}
              step={THRESHOLD_STEP}
              value={threshold}
              onChange={(e) => setThreshold(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
              <span>{MIN_SURPRISE_THRESHOLD}</span>
              <span>{MAX_SURPRISE_THRESHOLD}</span>
            </div>
          </div>

          {/* Tolerance slider */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">
              Tarihsel Tolerans: <span className="font-mono text-[var(--text-primary)]">%{tolerancePct}</span>
            </label>
            <input
              type="range"
              min={MIN_TOLERANCE_PCT}
              max={MAX_TOLERANCE_PCT}
              step={1}
              value={tolerancePct}
              onChange={(e) => setTolerancePct(Number(e.target.value))}
              className="w-full"
            />
            <div className="flex justify-between text-[10px] text-[var(--text-muted)] mt-0.5">
              <span>%{MIN_TOLERANCE_PCT}</span>
              <span>%{MAX_TOLERANCE_PCT}</span>
            </div>
          </div>

          {/* League filter */}
          <div>
            <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">Lig Ekle</label>
            <SearchableSelect
              options={leagueSelectOptions}
              value="Tümü"
              onChange={handleLeagueSelect}
              placeholder="Lig ara..."
              allLabel="Lig seçin..."
              allValue="Tümü"
            />
          </div>

          {/* Sort + İY/MS toggle */}
          <div className="flex flex-col gap-2">
            <div>
              <label className="text-xs text-[var(--text-tertiary)] mb-1.5 block">Sıralama</label>
              <div className="flex gap-1">
                {sortOptions.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setSortBy(opt.value)}
                    className={`flex-1 px-2 py-1.5 rounded-md text-[10px] sm:text-xs font-medium transition-colors ${
                      sortBy === opt.value
                        ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue)]'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--border-accent)]'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowOnlyIyms(!showOnlyIyms)}
              className={`px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                showOnlyIyms
                  ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border border-[var(--accent-blue)]'
                  : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border border-[var(--border-primary)] hover:border-[var(--border-accent)]'
              }`}
            >
              Sadece İY/MS
            </button>
          </div>
        </div>

        {/* Favorite league pills */}
        {favorites.length > 0 && (
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {favorites.map((key) => {
              const info = allLeagueKeys.find((l) => l.key === key)
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => removeLeague(key)}
                  className="rounded-md border px-3 py-1.5 text-xs sm:px-2 sm:py-1 sm:text-[11px] font-medium bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)] hover:brightness-110 transition-all"
                >
                  {info?.display ?? key} ×
                </button>
              )
            })}
            <button
              type="button"
              onClick={clearLeagues}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--accent-loss)] transition-colors ml-1"
            >
              Temizle
            </button>
          </div>
        )}
      </div>

      {/* Summary */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-3 text-center">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Maç</span>
          <span className="text-lg font-bold text-[var(--text-primary)] font-mono">{summary.matchCount}</span>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-3 text-center">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Sürpriz Girdi</span>
          <span className="text-lg font-bold text-[var(--text-primary)] font-mono">{summary.entryCount}</span>
        </div>
        <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-3 text-center">
          <span className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider block">Ort. Tutma</span>
          <span className="text-lg font-bold text-[var(--text-primary)] font-mono">
            {isLoading ? '...' : `%${(summary.avgHitRate * 100).toFixed(1)}`}
          </span>
        </div>
      </div>

      {/* Loading indicator */}
      {isLoading && (
        <div className="mb-4 flex items-center gap-2 text-sm text-[var(--text-tertiary)]">
          <div className="h-3 w-3 rounded-full border-2 border-[var(--accent-blue)] border-t-transparent animate-spin" />
          Tarihsel veriler yükleniyor...
        </div>
      )}

      {/* Match cards */}
      {matchGroups.length === 0 ? (
        <div className="text-center py-12 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-muted)]">
            Seçili eşik değerinde sürpriz bulunamadı. Eşiği düşürmeyi deneyin.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {matchGroups.map((group) => (
            <MatchCard
              key={group.fixture.id}
              group={group}
              isExpanded={expandedMatchIds.has(group.fixture.id)}
              isLoading={isLoading}
              onToggle={toggleExpanded}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ---------- MATCH CARD ----------

type MatchCardProps = {
  group: MatchSurpriseGroup
  isExpanded: boolean
  isLoading: boolean
  onToggle: (matchId: number) => void
}

function MatchCard({ group, isExpanded, isLoading, onToggle }: MatchCardProps) {
  const { fixture, entries } = group
  const league = fixture.league_display || fixture.league
  const time = formatTime(fixture.match_date)

  // Top 3 entries for collapsed view
  const topEntries = entries.slice(0, 3)

  return (
    <div className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] overflow-hidden">
      {/* Clickable header */}
      <button
        type="button"
        onClick={() => onToggle(fixture.id)}
        className="w-full text-left p-4 hover:bg-[var(--bg-tertiary)]/30 transition-colors"
      >
        {/* Match info */}
        <div className="flex items-center justify-between gap-2 mb-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-mono text-[var(--text-muted)] shrink-0">{time}</span>
            <span className="text-xs text-[var(--text-muted)]">·</span>
            <span className="text-xs text-[var(--text-tertiary)] truncate">{league}</span>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-xs font-medium text-[var(--text-tertiary)]">{entries.length} sürpriz</span>
            <svg
              className={`w-3.5 h-3.5 text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </div>

        <p className="text-sm font-medium text-[var(--text-primary)] mb-3">
          {fixture.home_team} <span className="text-[var(--text-muted)]">vs</span> {fixture.away_team}
        </p>

        {/* Top entries pills */}
        <div className="flex flex-wrap gap-1.5">
          {topEntries.map((entry) => (
            <SurprisePill key={entry.outcomeKey} entry={entry} isLoading={isLoading} />
          ))}
          {entries.length > 3 && (
            <span className="px-2 py-1 rounded text-[10px] text-[var(--text-muted)] bg-[var(--bg-tertiary)] border border-[var(--border-primary)]">
              +{entries.length - 3}
            </span>
          )}
        </div>
      </button>

      {/* Expanded detail table */}
      {isExpanded && (
        <div className="border-t border-[var(--border-primary)] p-4">
          <p className="text-[10px] text-[var(--text-muted)] mb-2">
            MS profili (1/X/2) + hedef oran benzerliğine göre eşleştirilmiş tarihsel maçlar
          </p>
          {/* Desktop table */}
          <div className="hidden sm:block overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[10px] text-[var(--text-muted)] uppercase tracking-wider">
                  <th className="text-left py-2 px-2 font-medium">Sonuç</th>
                  <th className="text-right py-2 px-2 font-medium">Oran</th>
                  <th className="text-right py-2 px-2 font-medium">Profil Eşleşme</th>
                  <th className="text-right py-2 px-2 font-medium">Tutan</th>
                  <th className="text-right py-2 px-2 font-medium">Tutma %</th>
                  <th className="text-right py-2 px-2 font-medium">Beklenen %</th>
                  <th className="text-right py-2 px-2 font-medium">Skor</th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => {
                  const implied = entry.impliedProb * 100

                  return (
                    <tr key={entry.outcomeKey} className="border-t border-[var(--border-subtle)]">
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-muted)]">
                            {entry.categoryLabel}
                          </span>
                          <span className="font-medium text-[var(--text-primary)]">{entry.label}</span>
                        </div>
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums text-right text-[var(--text-primary)]">
                        {formatOdd(entry.oddValue)}
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums text-right text-[var(--text-secondary)]">
                        {isLoading ? (
                          <span className="inline-block h-3 w-8 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                        ) : (
                          entry.totalSimilar.toLocaleString('tr-TR')
                        )}
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums text-right text-[var(--text-secondary)]">
                        {isLoading ? (
                          <span className="inline-block h-3 w-6 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                        ) : (
                          entry.hitCount.toLocaleString('tr-TR')
                        )}
                      </td>
                      <td className={`py-2 px-2 font-mono tabular-nums text-right font-bold ${isLoading ? '' : hitRateClass(entry.hitRate, entry.impliedProb)}`}>
                        {isLoading ? (
                          <span className="inline-block h-3 w-10 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                        ) : (
                          `%${(entry.hitRate * 100).toFixed(1)}`
                        )}
                      </td>
                      <td className="py-2 px-2 font-mono tabular-nums text-right text-[var(--text-muted)]">
                        %{implied.toFixed(1)}
                      </td>
                      <td className="py-2 px-2 text-right">
                        {isLoading ? (
                          <span className="inline-block h-5 w-10 rounded bg-[var(--bg-tertiary)] animate-pulse" />
                        ) : entry.surpriseScore > 0 ? (
                          <span className={`inline-block font-mono text-xs font-bold px-1.5 py-0.5 rounded ${scoreBadgeClass(entry.surpriseScore)}`}>
                            {entry.surpriseScore.toFixed(2)}
                          </span>
                        ) : (
                          <span className="text-xs text-[var(--text-muted)]">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile cards */}
          <div className="sm:hidden flex flex-col gap-2">
            {entries.map((entry) => {
              const implied = entry.impliedProb * 100

              return (
                <div key={entry.outcomeKey} className="bg-[var(--bg-tertiary)] rounded-lg p-3 border border-[var(--border-primary)]">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-secondary)] text-[var(--text-muted)]">
                        {entry.categoryLabel}
                      </span>
                      <span className="text-sm font-medium text-[var(--text-primary)]">{entry.label}</span>
                    </div>
                    <span className="font-mono tabular-nums text-sm font-bold text-[var(--text-primary)]">
                      {formatOdd(entry.oddValue)}
                    </span>
                  </div>

                  {isLoading ? (
                    <div className="h-4 w-full rounded bg-[var(--bg-secondary)] animate-pulse" />
                  ) : entry.totalSimilar > 0 ? (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-[var(--text-tertiary)]">
                        {entry.totalSimilar.toLocaleString('tr-TR')} benzer profilde {entry.hitCount} kez tuttu
                      </span>
                      <div className="flex items-center gap-2">
                        <span className={`font-mono font-bold ${hitRateClass(entry.hitRate, entry.impliedProb)}`}>
                          %{(entry.hitRate * 100).toFixed(1)}
                        </span>
                        <span className="text-[var(--text-muted)]">/ %{implied.toFixed(1)}</span>
                        {entry.surpriseScore > 0 && (
                          <span className={`font-mono text-[10px] font-bold px-1.5 py-0.5 rounded ${scoreBadgeClass(entry.surpriseScore)}`}>
                            {entry.surpriseScore.toFixed(2)}
                          </span>
                        )}
                      </div>
                    </div>
                  ) : (
                    <span className="text-xs text-[var(--text-muted)]">Tarihsel veri bulunamadı</span>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

// ---------- SURPRISE PILL ----------

function SurprisePill({ entry, isLoading }: { entry: SurpriseWithStats; isLoading: boolean }) {
  const hasStats = entry.totalSimilar > 0 && !isLoading

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-1 rounded text-[10px] sm:text-xs font-medium border ${
        hasStats && entry.surpriseScore > 0
          ? `${scoreBadgeClass(entry.surpriseScore)} border-transparent`
          : 'bg-[var(--bg-tertiary)] text-[var(--text-secondary)] border-[var(--border-primary)]'
      }`}
    >
      <span className="font-medium">{entry.label}</span>
      <span className="font-mono tabular-nums">@{formatOdd(entry.oddValue)}</span>
      {isLoading ? (
        <span className="inline-block h-2.5 w-6 rounded bg-current/20 animate-pulse" />
      ) : hasStats ? (
        <>
          <span className="font-mono">%{(entry.hitRate * 100).toFixed(0)}</span>
          <span className="font-mono font-bold">{entry.surpriseScore.toFixed(1)}</span>
        </>
      ) : null}
    </span>
  )
}
