"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import { MatchOddsTable, type OddsTableMatch } from '@/components/MatchOddsTable'
import {
  CATEGORY_LABELS,
  ODDS_CATEGORIES,
  getOutcomeKeys,
  isValidOdd,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'
import { useFilterOptions, groupLeaguesByCountry } from '@/lib/useFilterOptions'
import SearchableSelect, { type SelectOption } from '@/components/SearchableSelect'

type AnalysisDashboardProps = {
  match: MatchWithScores
}

const MIN_TOLERANCE = 0
const MAX_TOLERANCE = 5
const TOLERANCE_STEP = 0.1
const DEFAULT_TOLERANCE = 2
const ALL_OPTION = 'Tümü'
const PAGE_SIZE = 50

const RESULT_GROUPS: {
  id: string
  label: string
  items: { key: OddsKey; label: string }[]
}[] = [
  { id: 'ms', label: 'MS 1/X/2', items: [{ key: 'ms_1', label: 'MS 1' }, { key: 'ms_x', label: 'MS X' }, { key: 'ms_2', label: 'MS 2' }] },
  { id: 'iyms', label: 'İY/MS', items: [{ key: 'iyms_11', label: '1/1' }, { key: 'iyms_1x', label: '1/X' }, { key: 'iyms_12', label: '1/2' }, { key: 'iyms_x1', label: 'X/1' }, { key: 'iyms_xx', label: 'X/X' }, { key: 'iyms_x2', label: 'X/2' }, { key: 'iyms_21', label: '2/1' }, { key: 'iyms_2x', label: '2/X' }, { key: 'iyms_22', label: '2/2' }] },
  { id: 'kg', label: 'KG Var/Yok', items: [{ key: 'kg_var', label: 'KG Var' }, { key: 'kg_yok', label: 'KG Yok' }] },
  { id: 'au15', label: '1.5 Alt/Üst', items: [{ key: 'au_15_alt', label: '1.5 Alt' }, { key: 'au_15_ust', label: '1.5 Üst' }] },
  { id: 'au25', label: '2.5 Alt/Üst', items: [{ key: 'au_25_alt', label: '2.5 Alt' }, { key: 'au_25_ust', label: '2.5 Üst' }] },
  { id: 'tg', label: 'Toplam Gol', items: [{ key: 'tg_0_1', label: '0-1' }, { key: 'tg_2_3', label: '2-3' }, { key: 'tg_4_5', label: '4-5' }, { key: 'tg_6_plus', label: '6+' }] },
]

const formatTolerance = (value: number) => value.toFixed(1).replace('.', ',')

type SimilarMatch = OddsTableMatch & MatchWithScores

export default function AnalysisDashboard({ match }: AnalysisDashboardProps) {
  const { leagues, seasons } = useFilterOptions()
  const [tolerancePercent, setTolerancePercent] = useState(DEFAULT_TOLERANCE)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
  const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
  const [selectedMinMatchCount, setSelectedMinMatchCount] = useState<number | null>(null)
  const [similarMatches, setSimilarMatches] = useState<SimilarMatch[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [totalCategories, setTotalCategories] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

  const leagueSelectOptions = useMemo<SelectOption[]>(() => {
    const result: SelectOption[] = []
    for (const group of groupLeaguesByCountry(leagues)) {
      for (const league of group.items) {
        result.push({ value: league.value, label: league.label, group: group.country })
      }
    }
    return result
  }, [leagues])

  const availableCategories = useMemo(
    () =>
      ODDS_CATEGORIES.filter((category) =>
        category.fields.every((field) => isValidOdd(match[field]))
      ),
    [match]
  )

  const baseRow: OddsTableMatch = useMemo(
    () => ({
      ...match,
      matchCount: availableCategories.length,
      matchedCategoryIds: availableCategories.map((category) => category.id),
    }),
    [match, availableCategories]
  )

  const minMatchCountOptions = useMemo(() => {
    const maxCount = availableCategories.length
    if (maxCount === 0) return []
    const options: number[] = []
    for (let count = maxCount; count >= 1; count -= 1) {
      options.push(count)
    }
    return options
  }, [availableCategories.length])

  const fetchSimilarMatches = useCallback(async (currentPage: number) => {
    setIsLoading(true)
    try {
      const params = new URLSearchParams()
      params.set('tolerance', String(tolerancePercent))
      params.set('page', String(currentPage))
      params.set('limit', String(PAGE_SIZE))
      if (selectedLeague !== ALL_OPTION) params.set('league', selectedLeague)
      if (selectedSeason !== ALL_OPTION) params.set('season', selectedSeason)

      const res = await fetch(`/api/match/${match.id}/similar?${params.toString()}`)
      const data = await res.json()

      const matches: SimilarMatch[] = (data.matches ?? []).map((m: SimilarMatch) => ({
        ...m,
        matchCount: m.matchCount ?? 0,
        matchedCategoryIds: m.matchedCategoryIds ?? [],
      }))

      setSimilarMatches(matches)
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 0)
      setTotalCategories(data.totalCategories ?? 0)
    } catch {
      setSimilarMatches([])
      setTotal(0)
      setTotalPages(0)
    } finally {
      setIsLoading(false)
    }
  }, [match.id, tolerancePercent, selectedLeague, selectedSeason])

  useEffect(() => {
    setPage(1)
    const timer = setTimeout(() => {
      fetchSimilarMatches(1)
    }, 300)
    return () => clearTimeout(timer)
  }, [fetchSimilarMatches])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchSimilarMatches(newPage)
  }

  const filteredMatches = useMemo(() => {
    let filtered = similarMatches
    if (selectedMinMatchCount !== null) {
      filtered = filtered.filter((m) => m.matchCount >= selectedMinMatchCount)
    }
    if (selectedCategoryIds.length > 0) {
      filtered = filtered.filter((m) =>
        selectedCategoryIds.every((catId) => m.matchedCategoryIds.includes(catId))
      )
    }
    return filtered
  }, [similarMatches, selectedCategoryIds, selectedMinMatchCount])

  const categoryStats = useMemo(() => {
    const counts = new Map<string, number>()
    availableCategories.forEach((category) => counts.set(category.id, 0))

    filteredMatches.forEach((candidate) => {
      candidate.matchedCategoryIds.forEach((categoryId) => {
        counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1)
      })
    })

    const maxCount = Math.max(1, ...Array.from(counts.values()))

    return availableCategories
      .map((category) => {
        const count = counts.get(category.id) ?? 0
        return {
          id: category.id,
          label: CATEGORY_LABELS[category.id] ?? category.label,
          count,
          percent: filteredMatches.length > 0 ? Math.round((count / filteredMatches.length) * 100) : 0,
          barWidth: maxCount > 0 ? (count / maxCount) * 100 : 0,
        }
      })
      .sort((a, b) => b.count - a.count)
  }, [availableCategories, filteredMatches])

  const resultStats = useMemo(() => {
    const groupTotals = new Map<string, number>()
    const groupCounts = new Map<string, Map<OddsKey, number>>()

    RESULT_GROUPS.forEach((group) => {
      groupTotals.set(group.id, 0)
      groupCounts.set(group.id, new Map(group.items.map((item) => [item.key, 0])))
    })

    filteredMatches.forEach((candidate) => {
      const outcomeKeys = getOutcomeKeys(candidate)
      RESULT_GROUPS.forEach((group) => {
        const hits = group.items.filter((item) => outcomeKeys.has(item.key))
        if (hits.length === 0) return
        groupTotals.set(group.id, (groupTotals.get(group.id) ?? 0) + 1)
        const counts = groupCounts.get(group.id)
        if (!counts) return
        hits.forEach((item) => {
          counts.set(item.key, (counts.get(item.key) ?? 0) + 1)
        })
      })
    })

    return RESULT_GROUPS.map((group) => {
      const groupTotal = groupTotals.get(group.id) ?? 0
      const counts = groupCounts.get(group.id) ?? new Map()
      return {
        id: group.id,
        label: group.label,
        total: groupTotal,
        items: group.items.map((item) => {
          const count = counts.get(item.key) ?? 0
          const percent = groupTotal > 0 ? Math.round((count / groupTotal) * 100) : 0
          return { ...item, count, percent }
        }),
      }
    })
  }, [filteredMatches])

  const toggleCategory = (categoryId: string) => {
    setSelectedCategoryIds((prev) =>
      prev.includes(categoryId) ? prev.filter((id) => id !== categoryId) : [...prev, categoryId]
    )
  }

  const resetFilters = () => {
    setSelectedCategoryIds([])
    setSelectedLeague(ALL_OPTION)
    setSelectedSeason(ALL_OPTION)
    setSelectedMinMatchCount(null)
    setTolerancePercent(DEFAULT_TOLERANCE)
  }

  return (
    <>
      <section className="mt-6 animate-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Seçili Maç Oranları</h2>
          <span className="text-xs text-[var(--text-tertiary)]">
            Tutan oranlar yeşil renkle işaretlidir.
          </span>
        </div>
        <MatchOddsTable matches={[baseRow]} totalCategories={availableCategories.length} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr] animate-in">
        <div className="relative z-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow overflow-visible">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Filtreler</h3>
            <button type="button" onClick={resetFilters} className="text-xs text-[var(--accent-blue)] hover:brightness-110">
              Filtreleri temizle
            </button>
          </div>

          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
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

            <div>
              <div className="text-xs text-[var(--text-tertiary)] mb-2">Kategori filtresi</div>
              {availableCategories.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">
                  Oranlar eksik olduğu için kategori filtresi kapalı.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {availableCategories.map((category) => {
                    const isSelected = selectedCategoryIds.includes(category.id)
                    return (
                      <button
                        key={category.id}
                        type="button"
                        onClick={() => toggleCategory(category.id)}
                        className={`rounded-md border px-3 py-2 text-xs sm:px-3 sm:py-1 sm:text-[11px] font-medium transition-all ${
                          isSelected
                            ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)]'
                            : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:border-[var(--text-muted)]'
                        }`}
                      >
                        {CATEGORY_LABELS[category.id] ?? category.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>

            <div>
              <div className="text-xs text-[var(--text-tertiary)] mb-2">Minimum eşleşme</div>
              {availableCategories.length === 0 ? (
                <div className="text-xs text-[var(--text-muted)]">
                  Oranlar eksik olduğu için eşleşme filtresi kapalı.
                </div>
              ) : (
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedMinMatchCount(null)}
                    className={`rounded-md border px-3 py-2 text-xs sm:px-3 sm:py-1 sm:text-[11px] font-medium transition-all ${
                      selectedMinMatchCount === null
                        ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)]'
                        : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:border-[var(--text-muted)]'
                    }`}
                  >
                    Tümü
                  </button>
                  {minMatchCountOptions.map((count) => {
                    const isSelected = selectedMinMatchCount === count
                    return (
                      <button
                        key={count}
                        type="button"
                        onClick={() => setSelectedMinMatchCount(count)}
                        className={`rounded-md border px-3 py-2 text-xs sm:px-3 sm:py-1 sm:text-[11px] font-medium transition-all ${
                          isSelected
                            ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)]'
                            : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:border-[var(--text-muted)]'
                        }`}
                      >
                        {`${count}/${availableCategories.length}+`}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Kategori istatistikleri</h3>
              <span className="text-[11px] text-[var(--text-muted)] font-mono">{filteredMatches.length} maç</span>
            </div>
            {filteredMatches.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">Gösterilecek istatistik bulunamadı.</div>
            ) : (
              <div className="space-y-2">
                {categoryStats.map((stat) => (
                  <div key={stat.id} className="flex items-center gap-3">
                    <span className="w-20 sm:w-24 text-[11px] text-[var(--text-tertiary)]">{stat.label}</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                      <div className="h-1.5 rounded-full bg-[var(--accent-win)] transition-all duration-500" style={{ width: `${stat.barWidth}%` }} />
                    </div>
                    <span className="text-[11px] font-mono text-[var(--text-secondary)]">{stat.count}</span>
                    <span className="text-[11px] font-mono text-[var(--text-muted)]">%{stat.percent}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[10px] text-[var(--text-muted)]">
              Grafik, listelenen benzer maçlara göre hesaplanır.
            </div>
          </div>

          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 card-glow">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Sonuç dağılımı</h3>
              <span className="text-[11px] text-[var(--text-muted)] font-mono">{filteredMatches.length} maç</span>
            </div>
            {filteredMatches.length === 0 ? (
              <div className="text-xs text-[var(--text-muted)]">Gösterilecek veri bulunamadı.</div>
            ) : (
              <div className="space-y-4">
                {resultStats.map((group) => (
                  <div key={group.id}>
                    <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{group.label}</div>
                    {group.total === 0 ? (
                      <div className="text-[11px] text-[var(--text-muted)]">Bu kategoride skor bulunamadı.</div>
                    ) : (
                      <div className="space-y-2">
                        {group.items.map((item) => (
                          <div key={item.key} className="flex items-center gap-3">
                            <span className="w-14 sm:w-16 text-[11px] text-[var(--text-tertiary)]">{item.label}</span>
                            <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                              <div className="h-1.5 rounded-full bg-[var(--accent-blue)] transition-all duration-500" style={{ width: `${item.percent}%` }} />
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
              Yüzdeler, kategori bazında hesaplanır.
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8 animate-in">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Benzer Oranlı Geçmiş Maçlar</h2>
          <span className="text-xs text-[var(--text-tertiary)] font-mono">{total} eşleşme</span>
        </div>

        {isLoading ? (
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 space-y-3">
            <div className="skeleton h-4 w-3/4" />
            <div className="skeleton h-4 w-1/2" />
            <div className="skeleton h-4 w-5/6" />
            <div className="skeleton h-4 w-2/3" />
          </div>
        ) : filteredMatches.length === 0 ? (
          <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-6 text-sm text-[var(--text-tertiary)]">
            Seçili filtrelerde eşleşen geçmiş maç bulunamadı.
          </div>
        ) : (
          <>
            <MatchOddsTable matches={filteredMatches} totalCategories={totalCategories || availableCategories.length} />

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
                <span className="text-xs text-[var(--text-tertiary)] font-mono">{page} / {totalPages}</span>
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
      </section>
    </>
  )
}
