"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  ODDS_CATEGORIES,
  ODDS_FIELDS,
  getOutcomeKeys,
  formatMatchDateTime,
  formatOdd,
  isValidOdd,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'
import { useFilterOptions, groupLeaguesByCountry } from '@/lib/useFilterOptions'
import SearchableSelect, { type SelectOption } from '@/components/SearchableSelect'

const MIN_TOLERANCE = 0
const MAX_TOLERANCE = 5
const TOLERANCE_STEP = 0.1
const DEFAULT_TOLERANCE = 2
const ALL_OPTION = 'Tümü'
const PAGE_SIZE = 50

const ODDS_LABELS: Record<OddsKey, string> = {
  ms_1: 'MS 1',
  ms_x: 'MS X',
  ms_2: 'MS 2',
  iyms_11: '1/1',
  iyms_1x: '1/X',
  iyms_12: '1/2',
  iyms_x1: 'X/1',
  iyms_xx: 'X/X',
  iyms_x2: 'X/2',
  iyms_21: '2/1',
  iyms_2x: '2/X',
  iyms_22: '2/2',
  au_15_alt: '1.5 Alt',
  au_15_ust: '1.5 Üst',
  au_25_alt: '2.5 Alt',
  au_25_ust: '2.5 Üst',
  kg_var: 'KG Var',
  kg_yok: 'KG Yok',
  tg_0_1: '0-1',
  tg_2_3: '2-3',
  tg_4_5: '4-5',
  tg_6_plus: '6+',
}

const MOBILE_TABS = ODDS_CATEGORIES.map((cat) => ({
  id: cat.id,
  label: cat.id === 'ms' ? 'MS 1/X/2' : cat.id === 'iyms' ? 'İY/MS' : cat.id === 'au15' ? '1.5 A/Ü' : cat.id === 'au25' ? '2.5 A/Ü' : cat.id === 'kg' ? 'KG' : 'TG',
  fields: cat.fields,
}))

const formatTolerance = (value: number) => value.toFixed(1).replace('.', ',')

const buildInitialInputs = () =>
  ODDS_FIELDS.reduce<Record<OddsKey, string>>((acc, field) => {
    acc[field] = ''
    return acc
  }, {} as Record<OddsKey, string>)

const parseInputValue = (value: string) => {
  const trimmed = value.trim()
  if (!trimmed) return null
  const normalized = trimmed.replace(',', '.')
  const parsed = Number(normalized)
  if (!Number.isFinite(parsed) || parsed <= 0) return null
  return parsed
}

export default function OddsSearchDashboard() {
  const { leagues, seasons } = useFilterOptions()
  const [oddsInputs, setOddsInputs] = useState<Record<OddsKey, string>>(buildInitialInputs)
  const [tolerancePercent, setTolerancePercent] = useState(DEFAULT_TOLERANCE)
  const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
  const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
  const [matches, setMatches] = useState<MatchWithScores[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [activeTab, setActiveTab] = useState('ms')

  const leagueSelectOptions = useMemo<SelectOption[]>(() => {
    const result: SelectOption[] = []
    for (const group of groupLeaguesByCountry(leagues)) {
      for (const league of group.items) {
        result.push({ value: league.value, label: league.label, group: group.country })
      }
    }
    return result
  }, [leagues])

  const parsedInputs = useMemo(() => {
    const parsed: Partial<Record<OddsKey, number>> = {}
    ODDS_FIELDS.forEach((field) => {
      const value = parseInputValue(oddsInputs[field])
      if (value !== null) parsed[field] = value
    })
    return parsed
  }, [oddsInputs])

  const selectedFields = useMemo(
    () => ODDS_FIELDS.filter((field) => parsedInputs[field] !== undefined),
    [parsedInputs]
  )

  const fetchMatches = useCallback(async (currentPage: number) => {
    if (selectedFields.length === 0) {
      setMatches([])
      setTotal(0)
      setTotalPages(0)
      return
    }

    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('page', String(currentPage))
      params.set('limit', String(PAGE_SIZE))
      params.set('tolerance', String(tolerancePercent / 100))

      for (const field of selectedFields) {
        const value = parsedInputs[field]
        if (value !== undefined) {
          params.set(field, String(value))
        }
      }

      if (selectedLeague !== ALL_OPTION) params.set('league', selectedLeague)
      if (selectedSeason !== ALL_OPTION) params.set('season', selectedSeason)

      const res = await fetch(`/api/matches/search?${params.toString()}`)
      const data = await res.json()

      setMatches(data.matches ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 0)
    } catch {
      setMatches([])
      setTotal(0)
      setTotalPages(0)
    } finally {
      setIsLoading(false)
    }
  }, [selectedFields, parsedInputs, tolerancePercent, selectedLeague, selectedSeason])

  useEffect(() => {
    setPage(1)
    const timer = setTimeout(() => {
      fetchMatches(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [fetchMatches])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchMatches(newPage)
  }

  const displayGroups = ODDS_CATEGORIES
  const displayFields = ODDS_FIELDS

  const activeTabData = MOBILE_TABS.find((t) => t.id === activeTab) ?? MOBILE_TABS[0]

  const resultStats = useMemo(() => {
    const groupTotals = new Map<string, number>()
    const groupCounts = new Map<string, Map<OddsKey, number>>()

    ODDS_CATEGORIES.forEach((group) => {
      groupTotals.set(group.id, 0)
      groupCounts.set(group.id, new Map(group.fields.map((field) => [field, 0])))
    })

    matches.forEach((match) => {
      const outcomeKeys = getOutcomeKeys(match)
      ODDS_CATEGORIES.forEach((group) => {
        const hits = group.fields.filter((field) => outcomeKeys.has(field))
        if (hits.length === 0) return
        groupTotals.set(group.id, (groupTotals.get(group.id) ?? 0) + 1)
        const counts = groupCounts.get(group.id)
        if (!counts) return
        hits.forEach((field) => {
          counts.set(field, (counts.get(field) ?? 0) + 1)
        })
      })
    })

    return ODDS_CATEGORIES.map((group) => {
      const groupTotal = groupTotals.get(group.id) ?? 0
      const counts = groupCounts.get(group.id) ?? new Map()
      return {
        id: group.id,
        label: group.label,
        total: groupTotal,
        missing: Math.max(matches.length - groupTotal, 0),
        items: group.fields.map((field) => {
          const count = counts.get(field) ?? 0
          const percent = groupTotal > 0 ? Math.round((count / groupTotal) * 100) : 0
          return { key: field, label: ODDS_LABELS[field], count, percent }
        }),
      }
    })
  }, [matches])

  const resetInputs = () => {
    setOddsInputs(buildInitialInputs())
    setTolerancePercent(DEFAULT_TOLERANCE)
    setSelectedLeague(ALL_OPTION)
    setSelectedSeason(ALL_OPTION)
  }

  return (
    <>
      <section className="mt-6 grid gap-6 lg:grid-cols-[280px_1fr] stagger">
        <aside>
          {/* Mobile sidebar toggle */}
          <button
            type="button"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="flex lg:hidden items-center justify-between w-full rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 mb-4"
          >
            <span className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Filtreler</span>
            <svg
              className={`w-5 h-5 text-[var(--text-muted)] transition-transform ${sidebarOpen ? 'rotate-180' : ''}`}
              fill="none" stroke="currentColor" viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>

          {/* Sidebar content — always visible on lg, toggle on mobile */}
          <div className={`space-y-4 ${sidebarOpen ? 'block' : 'hidden'} lg:block`}>
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow">
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Oran Girişi</h2>
                  <p className="text-xs text-[var(--text-tertiary)] mt-1">
                    Aramak istediğiniz oranları girin, tolerans aralığı ile eşleşen maçları listeleyelim.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={resetInputs}
                  className="text-xs text-[var(--accent-blue)] hover:brightness-110"
                >
                  Tümünü temizle
                </button>
              </div>

              <div className="space-y-5">
                {ODDS_CATEGORIES.map((category) => (
                  <div key={category.id}>
                    <div className="text-xs font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{category.label}</div>
                    <div className="grid grid-cols-2 gap-3">
                      {category.fields.map((field) => (
                        <label key={field} className="text-[11px] text-[var(--text-tertiary)]">
                          {ODDS_LABELS[field]}
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            placeholder="Örn: 1.75"
                            value={oddsInputs[field]}
                            onChange={(event) =>
                              setOddsInputs((prev) => ({ ...prev, [field]: event.target.value }))
                            }
                            className="mt-1 w-full rounded-md border border-[var(--border-primary)] bg-[var(--bg-primary)] px-3 py-2 text-xs text-[var(--text-primary)] placeholder:text-[var(--text-muted)] focus:border-[var(--accent-blue)] focus:outline-none transition-colors"
                          />
                        </label>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            <div className="relative z-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow overflow-visible">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Arama Ayarları</h3>
                <span className="text-[11px] text-[var(--text-muted)] font-mono">{total} maç</span>
              </div>

              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between text-xs text-[var(--text-tertiary)]">
                    <span>Tolerans</span>
                    <span className="font-mono">%{formatTolerance(tolerancePercent)}</span>
                  </div>
                  <input
                    type="range"
                    min={MIN_TOLERANCE}
                    max={MAX_TOLERANCE}
                    step={TOLERANCE_STEP}
                    value={tolerancePercent}
                    onChange={(event) => setTolerancePercent(Number(event.target.value))}
                    className="mt-2 w-full"
                  />
                  <div className="mt-1 flex items-center justify-between text-xs sm:text-[10px] text-[var(--text-muted)]">
                    <span>%0</span>
                    <span>%5</span>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="text-xs text-[var(--text-tertiary)]">
                    <span className="block mb-2">Lig</span>
                    <SearchableSelect
                      options={leagueSelectOptions}
                      value={selectedLeague}
                      onChange={setSelectedLeague}
                      placeholder="Lig ara..."
                    />
                  </div>
                  <div className="text-xs text-[var(--text-tertiary)]">
                    <span className="block mb-2">Sezon</span>
                    <SearchableSelect
                      options={seasons.map((s) => ({ value: s, label: s }))}
                      value={selectedSeason}
                      onChange={setSelectedSeason}
                      placeholder="Sezon ara..."
                    />
                  </div>
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Özet</h3>
                <span className="text-[11px] text-[var(--text-muted)] font-mono">{selectedFields.length} oran girildi</span>
              </div>
              <div className="text-xs text-[var(--text-tertiary)] space-y-2">
                {selectedFields.length === 0 ? (
                  <div>En az bir oran girerek arama yapabilirsiniz.</div>
                ) : (
                  <div className="font-mono">
                    {total} maç bulundu (sayfa {page}/{totalPages || 1})
                  </div>
                )}
                <div>
                  Tolerans: %{formatTolerance(tolerancePercent)} · Lig: {selectedLeague} · Sezon: {selectedSeason}
                </div>
              </div>
            </div>

            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Sonuç Dağılımları</h3>
                <span className="text-[11px] text-[var(--text-muted)] font-mono">{matches.length} maç</span>
              </div>
              {matches.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">Gösterilecek veri bulunamadı.</div>
              ) : (
                <div className="space-y-4">
                  {resultStats.map((group) => (
                    <div key={group.id}>
                      <div className="flex items-center justify-between mb-2">
                        <span className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider">{group.label}</span>
                        {group.missing > 0 ? (
                          <span className="text-[10px] text-[var(--text-muted)]">
                            Skoru olmayan: {group.missing}
                          </span>
                        ) : null}
                      </div>
                      {group.total === 0 ? (
                        <div className="text-[11px] text-[var(--text-muted)]">
                          Bu kategoride skor bulunamadı.
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {group.items.map((item) => (
                            <div key={item.key} className="flex items-center gap-3">
                              <span className="w-16 sm:w-20 text-[11px] text-[var(--text-tertiary)]">{item.label}</span>
                              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                                <div
                                  className="h-1.5 rounded-full bg-[var(--accent-win)] transition-all duration-500"
                                  style={{ width: `${item.percent}%` }}
                                />
                              </div>
                              <span className="text-[11px] font-mono text-[var(--text-secondary)]">{item.count}</span>
                              <span className="text-[11px] font-mono text-[var(--text-muted)]">%{item.percent}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div className="mt-3 text-[10px] text-[var(--text-muted)]">
                Yüzdeler, mevcut sayfa bazında hesaplanır.
              </div>
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Eşleşen Maçlar</h2>
              <div className="text-[11px] text-[var(--text-muted)]">Tutan oranlar yeşil renkle işaretlidir.</div>
            </div>
            <span className="text-xs text-[var(--text-tertiary)] font-mono">{total} eşleşme</span>
          </div>

          {isLoading ? (
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 space-y-3">
              <div className="skeleton h-4 w-3/4" />
              <div className="skeleton h-4 w-1/2" />
              <div className="skeleton h-4 w-5/6" />
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-3/4" />
            </div>
          ) : selectedFields.length === 0 ? (
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-tertiary)]">
              Arama yapmak için en az bir oran girmeniz gerekiyor.
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-tertiary)]">
              Seçili tolerans ve filtrelerde eşleşen maç bulunamadı.
            </div>
          ) : (
            <>
              {/* Mobile: Tab-based table */}
              <div className="block sm:hidden rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden">
                <div className="flex overflow-x-auto scrollbar-thin border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
                  {MOBILE_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={`px-3 py-2 min-h-[44px] whitespace-nowrap text-xs font-medium transition-colors ${
                        activeTab === tab.id
                          ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)]'
                          : 'text-[var(--text-tertiary)]'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
                  <table className="min-w-full text-xs">
                    <thead className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider sticky top-0 z-10">
                      <tr>
                        <th className="px-3 py-2 text-left font-medium sticky left-0 top-0 z-20 bg-[var(--bg-tertiary)]">Maç</th>
                        <th className="px-2 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">Skor</th>
                        {activeTabData.fields.map((field) => (
                          <th key={field} className="px-2 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">
                            {ODDS_LABELS[field]}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--border-subtle)]">
                      {matches.map((match) => {
                        const outcomeKeys = getOutcomeKeys(match)
                        return (
                          <tr key={match.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                            <td className="px-3 py-2 sticky left-0 z-[5] bg-[var(--bg-secondary)]">
                              <div className="font-semibold text-[var(--text-primary)] text-xs">
                                {match.home_team} vs {match.away_team}
                              </div>
                              <div className="text-[10px] text-[var(--text-muted)]">{match.league}</div>
                            </td>
                            <td className="px-2 py-2 text-center font-mono text-[11px]">
                              <div className="text-[var(--text-primary)]">{match.score_ft ?? '-'}</div>
                              {match.score_ht ? (
                                <div className="text-[9px] text-[var(--text-muted)]">İY: {match.score_ht}</div>
                              ) : null}
                            </td>
                            {activeTabData.fields.map((field) => {
                              const outcomeHit = outcomeKeys.has(field)
                              return (
                                <td
                                  key={`${match.id}-${field}`}
                                  className={`px-2 py-2 text-center font-mono tabular-nums border ${
                                    outcomeHit
                                      ? 'border-[var(--border-subtle)] bg-[var(--accent-win-bg)] text-[var(--accent-win)] font-semibold'
                                      : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                                  }`}
                                >
                                  {formatOdd(match[field])}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Desktop: Full table */}
              <div className="hidden sm:block overflow-x-auto rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)]">
                <table className="min-w-full text-xs">
                  <thead className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
                    <tr>
                      <th rowSpan={2} className="px-3 py-2 text-left font-medium">Maç</th>
                      <th rowSpan={2} className="px-3 py-2 text-left font-medium">Tarih</th>
                      <th rowSpan={2} className="px-3 py-2 text-center font-medium">Skor</th>
                      {displayGroups.map((group) => (
                        <th
                          key={group.id}
                          colSpan={group.fields.length}
                          className="px-3 py-2 text-center font-medium"
                        >
                          {group.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {displayFields.map((field) => (
                        <th key={field} className="px-3 py-2 text-center font-medium">
                          {ODDS_LABELS[field]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--border-subtle)]">
                    {matches.map((match) => {
                      const outcomeKeys = getOutcomeKeys(match)
                      return (
                        <tr key={match.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                          <td className="px-3 py-2">
                            <div className="font-semibold text-[var(--text-primary)]">
                              {match.home_team} vs {match.away_team}
                            </div>
                            <div className="text-[10px] text-[var(--text-muted)]">{match.league}</div>
                          </td>
                          <td className="px-3 py-2 text-[var(--text-secondary)]" suppressHydrationWarning>
                            {formatMatchDateTime(match.match_date, { includeYear: true })}
                          </td>
                          <td className="px-3 py-2 text-center font-mono text-[11px]">
                            <div className="text-[var(--text-primary)]">{match.score_ft ?? '-'}</div>
                            {match.score_ht ? (
                              <div className="text-[9px] text-[var(--text-muted)]">İY: {match.score_ht}</div>
                            ) : null}
                          </td>
                          {displayFields.map((field) => {
                            const outcomeHit = outcomeKeys.has(field)
                            return (
                              <td
                                key={`${match.id}-${field}`}
                                className={`px-3 py-2 text-center font-mono tabular-nums border ${
                                  outcomeHit
                                    ? 'border-[var(--border-subtle)] bg-[var(--accent-win-bg)] text-[var(--accent-win)] font-semibold'
                                    : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'
                                }`}
                              >
                                {formatOdd(match[field])}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                    className="px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-xs rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 transition-colors"
                  >
                    Önceki
                  </button>
                  <span className="text-xs text-[var(--text-tertiary)] font-mono">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                    className="px-3 py-2.5 sm:py-1.5 min-h-[44px] sm:min-h-0 text-xs rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 transition-colors"
                  >
                    Sonraki
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </section>
    </>
  )
}
