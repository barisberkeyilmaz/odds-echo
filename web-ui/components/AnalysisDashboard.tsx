"use client"

import { useMemo, useState } from 'react'
import { MatchOddsTable, type OddsTableMatch } from '@/components/MatchOddsTable'
import {
  CATEGORY_LABELS,
  ODDS_CATEGORIES,
  getOutcomeKeys,
  isCategoryMatch,
  isValidOdd,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'

type AnalysisDashboardProps = {
  match: MatchWithScores
  candidates: MatchWithScores[]
}

const MIN_TOLERANCE = 0
const MAX_TOLERANCE = 5
const TOLERANCE_STEP = 0.1
const DEFAULT_TOLERANCE = 4
const ALL_OPTION = 'Tümü'

const RESULT_GROUPS: {
  id: string
  label: string
  items: { key: OddsKey; label: string }[]
}[] = [
  {
    id: 'ms',
    label: 'MS 1/X/2',
    items: [
      { key: 'ms_1', label: 'MS 1' },
      { key: 'ms_x', label: 'MS X' },
      { key: 'ms_2', label: 'MS 2' },
    ],
  },
  {
    id: 'iyms',
    label: 'İY/MS',
    items: [
      { key: 'iyms_11', label: '1/1' },
      { key: 'iyms_1x', label: '1/X' },
      { key: 'iyms_12', label: '1/2' },
      { key: 'iyms_x1', label: 'X/1' },
      { key: 'iyms_xx', label: 'X/X' },
      { key: 'iyms_x2', label: 'X/2' },
      { key: 'iyms_21', label: '2/1' },
      { key: 'iyms_2x', label: '2/X' },
      { key: 'iyms_22', label: '2/2' },
    ],
  },
  {
    id: 'kg',
    label: 'KG Var/Yok',
    items: [
      { key: 'kg_var', label: 'KG Var' },
      { key: 'kg_yok', label: 'KG Yok' },
    ],
  },
  {
    id: 'au15',
    label: '1.5 Alt/Üst',
    items: [
      { key: 'au_15_alt', label: '1.5 Alt' },
      { key: 'au_15_ust', label: '1.5 Üst' },
    ],
  },
  {
    id: 'au25',
    label: '2.5 Alt/Üst',
    items: [
      { key: 'au_25_alt', label: '2.5 Alt' },
      { key: 'au_25_ust', label: '2.5 Üst' },
    ],
  },
  {
    id: 'tg',
    label: 'Toplam Gol',
    items: [
      { key: 'tg_0_1', label: '0-1' },
      { key: 'tg_2_3', label: '2-3' },
      { key: 'tg_4_5', label: '4-5' },
      { key: 'tg_6_plus', label: '6+' },
    ],
  },
]

const formatTolerance = (value: number) => value.toFixed(1).replace('.', ',')

export default function AnalysisDashboard({ match, candidates }: AnalysisDashboardProps) {
  const [tolerancePercent, setTolerancePercent] = useState(DEFAULT_TOLERANCE)
  const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>([])
  const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
  const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)

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

  const leagueOptions = useMemo(() => {
    const unique = new Set<string>()
    if (match.league) unique.add(match.league)
    candidates.forEach((candidate) => {
      if (candidate.league) unique.add(candidate.league)
    })
    return [ALL_OPTION, ...Array.from(unique).sort()]
  }, [candidates, match.league])

  const seasonOptions = useMemo(() => {
    const unique = new Set<string>()
    if (match.season) unique.add(match.season)
    candidates.forEach((candidate) => {
      if (candidate.season) unique.add(candidate.season)
    })
    return [ALL_OPTION, ...Array.from(unique).sort().reverse()]
  }, [candidates, match.season])

  const filteredCandidates = useMemo(
    () =>
      candidates.filter((candidate) => {
        const leagueMatch = selectedLeague === ALL_OPTION || candidate.league === selectedLeague
        const seasonMatch = selectedSeason === ALL_OPTION || candidate.season === selectedSeason
        return leagueMatch && seasonMatch
      }),
    [candidates, selectedLeague, selectedSeason]
  )

  const matchesWithSimilarity = useMemo(() => {
    if (availableCategories.length === 0) return []
    const toleranceValue = tolerancePercent / 100
    const toleranceAbs = toleranceValue
    const tolerancePct = toleranceValue

    return filteredCandidates
      .filter((candidate) => candidate.id !== match.id)
      .map((candidate) => {
        const matchedCategoryIds = availableCategories
          .filter((category) =>
            isCategoryMatch(match, candidate, category.fields, toleranceAbs, tolerancePct)
          )
          .map((category) => category.id)

        return {
          ...candidate,
          matchedCategoryIds,
          matchCount: matchedCategoryIds.length,
        }
      })
      .filter((candidate) => candidate.matchCount > 0)
      .sort((a, b) => {
        if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
        return new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
      })
  }, [availableCategories, filteredCandidates, match, tolerancePercent])

  const filteredMatches = useMemo(() => {
    if (selectedCategoryIds.length === 0) return matchesWithSimilarity
    return matchesWithSimilarity.filter((candidate) =>
      selectedCategoryIds.every((categoryId) => candidate.matchedCategoryIds.includes(categoryId))
    )
  }, [matchesWithSimilarity, selectedCategoryIds])

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
      groupCounts.set(
        group.id,
        new Map(group.items.map((item) => [item.key, 0]))
      )
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
      const total = groupTotals.get(group.id) ?? 0
      const counts = groupCounts.get(group.id) ?? new Map()
      return {
        id: group.id,
        label: group.label,
        total,
        items: group.items.map((item) => {
          const count = counts.get(item.key) ?? 0
          const percent = total > 0 ? Math.round((count / total) * 100) : 0
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
    setTolerancePercent(DEFAULT_TOLERANCE)
  }

  return (
    <>
      <section className="mt-6">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">Seçili Maç Oranları</h2>
          <span className="text-xs text-gray-500">
            Tutan oranlar yeşil renkle işaretlidir.
          </span>
        </div>
        <MatchOddsTable matches={[baseRow]} totalCategories={availableCategories.length} />
      </section>

      <section className="mt-6 grid gap-4 lg:grid-cols-[1.3fr_1fr]">
        <div className="rounded-xl border border-gray-100 bg-white p-4">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-gray-700">Filtreler</h3>
            <button
              type="button"
              onClick={resetFilters}
              className="text-[11px] text-blue-600 hover:text-blue-700"
            >
              Filtreleri temizle
            </button>
          </div>

          <div className="space-y-5">
            <div className="grid gap-3 md:grid-cols-2">
              <label className="text-xs text-gray-500">
                Lig
                <select
                  value={selectedLeague}
                  onChange={(event) => setSelectedLeague(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                >
                  {leagueOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-xs text-gray-500">
                Sezon
                <select
                  value={selectedSeason}
                  onChange={(event) => setSelectedSeason(event.target.value)}
                  className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                >
                  {seasonOptions.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <div>
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>Tolerans</span>
                <span>%{formatTolerance(tolerancePercent)}</span>
              </div>
              <input
                type="range"
                min={MIN_TOLERANCE}
                max={MAX_TOLERANCE}
                step={TOLERANCE_STEP}
                value={tolerancePercent}
                onChange={(event) => setTolerancePercent(Number(event.target.value))}
                className="mt-2 w-full accent-emerald-500"
              />
              <div className="mt-1 flex items-center justify-between text-[10px] text-gray-400">
                <span>%0</span>
                <span>%5</span>
              </div>
            </div>

            <div>
              <div className="text-xs text-gray-500 mb-2">Kategori filtresi</div>
              {availableCategories.length === 0 ? (
                <div className="text-xs text-gray-400">
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
                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${
                          isSelected
                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
                        }`}
                      >
                        {CATEGORY_LABELS[category.id] ?? category.label}
                      </button>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Kategori istatistikleri</h3>
              <span className="text-[11px] text-gray-400">
                {`${filteredMatches.length} maç`}
              </span>
            </div>
            {filteredMatches.length === 0 ? (
              <div className="text-xs text-gray-400">Gösterilecek istatistik bulunamadı.</div>
            ) : (
              <div className="space-y-2">
                {categoryStats.map((stat) => (
                  <div key={stat.id} className="flex items-center gap-3">
                    <span className="w-24 text-[11px] text-gray-500">{stat.label}</span>
                    <div className="flex-1 h-2 rounded-full bg-gray-100">
                      <div
                        className="h-2 rounded-full bg-emerald-400"
                        style={{ width: `${stat.barWidth}%` }}
                      />
                    </div>
                    <span className="text-[11px] text-gray-500">{stat.count}</span>
                    <span className="text-[11px] text-gray-400">%{stat.percent}</span>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[10px] text-gray-400">
              Grafik, listelenen benzer maçlara göre hesaplanır.
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Sonuç dağılımı</h3>
              <span className="text-[11px] text-gray-400">
                {`${filteredMatches.length} maç`}
              </span>
            </div>
            {filteredMatches.length === 0 ? (
              <div className="text-xs text-gray-400">Gösterilecek veri bulunamadı.</div>
            ) : (
              <div className="space-y-4">
                {resultStats.map((group) => (
                  <div key={group.id}>
                    <div className="text-[11px] font-semibold text-gray-500 mb-2">{group.label}</div>
                    {group.total === 0 ? (
                      <div className="text-[11px] text-gray-400">
                        Bu kategoride skor bulunamadı.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {group.items.map((item) => (
                          <div key={item.key} className="flex items-center gap-3">
                            <span className="w-16 text-[11px] text-gray-500">{item.label}</span>
                            <div className="flex-1 h-2 rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full bg-blue-400"
                                style={{ width: `${item.percent}%` }}
                              />
                            </div>
                            <span className="text-[11px] text-gray-500">{item.count}</span>
                            <span className="text-[11px] text-gray-400">%{item.percent}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="mt-3 text-[10px] text-gray-400">
              Yüzdeler, kategori bazında hesaplanır.
            </div>
          </div>
        </div>
      </section>

      <section className="mt-8">
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-sm font-semibold text-gray-700">
            Benzer Oranlı Geçmiş Maçlar
          </h2>
          <span className="text-xs text-gray-500">{`${filteredMatches.length} eşleşme`}</span>
        </div>

        {filteredMatches.length === 0 ? (
          <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500">
            Seçili filtrelerde eşleşen geçmiş maç bulunamadı.
          </div>
        ) : (
          <MatchOddsTable matches={filteredMatches} totalCategories={availableCategories.length} />
        )}
      </section>
    </>
  )
}
