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

const MIN_TOLERANCE = 0
const MAX_TOLERANCE = 5
const TOLERANCE_STEP = 0.1
const DEFAULT_TOLERANCE = 4
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
  const [oddsInputs, setOddsInputs] = useState<Record<OddsKey, string>>(buildInitialInputs)
  const [tolerancePercent, setTolerancePercent] = useState(DEFAULT_TOLERANCE)
  const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
  const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
  const [matches, setMatches] = useState<MatchWithScores[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)

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

  // Debounced search
  useEffect(() => {
    setPage(1)
    const timer = setTimeout(() => {
      fetchMatches(1)
    }, 500)
    return () => clearTimeout(timer)
  }, [fetchMatches])

  // Page change (no debounce)
  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchMatches(newPage)
  }

  const displayGroups = ODDS_CATEGORIES
  const displayFields = ODDS_FIELDS

  // Compute result stats from current page matches
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
      <section className="mt-6 grid gap-6 lg:grid-cols-[320px_1fr]">
        <aside className="space-y-4">
          <div className="rounded-xl border border-gray-100 bg-white p-5">
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-sm font-semibold text-gray-700">Oran Girişi</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Aramak istediğiniz oranları girin, tolerans aralığı ile eşleşen maçları listeleyelim.
                </p>
              </div>
              <button
                type="button"
                onClick={resetInputs}
                className="text-[11px] text-blue-600 hover:text-blue-700"
              >
                Tümünü temizle
              </button>
            </div>

            <div className="space-y-5">
              {ODDS_CATEGORIES.map((category) => (
                <div key={category.id}>
                  <div className="text-xs font-semibold text-gray-500 mb-2">{category.label}</div>
                  <div className="grid grid-cols-2 gap-3">
                    {category.fields.map((field) => (
                      <label key={field} className="text-[11px] text-gray-500">
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
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-700"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Arama Ayarları</h3>
              <span className="text-[11px] text-gray-400">{total} maç</span>
            </div>

            <div className="space-y-5">
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

              <div className="grid gap-3 sm:grid-cols-2">
                <label className="text-xs text-gray-500">
                  Lig
                  <input
                    type="text"
                    placeholder="Lig adı"
                    value={selectedLeague === ALL_OPTION ? '' : selectedLeague}
                    onChange={(event) =>
                      setSelectedLeague(event.target.value.trim() || ALL_OPTION)
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                  />
                </label>
                <label className="text-xs text-gray-500">
                  Sezon
                  <input
                    type="text"
                    placeholder="Örn: 2024/2025"
                    value={selectedSeason === ALL_OPTION ? '' : selectedSeason}
                    onChange={(event) =>
                      setSelectedSeason(event.target.value.trim() || ALL_OPTION)
                    }
                    className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                  />
                </label>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Özet</h3>
              <span className="text-[11px] text-gray-400">{selectedFields.length} oran girildi</span>
            </div>
            <div className="text-xs text-gray-500 space-y-2">
              {selectedFields.length === 0 ? (
                <div>En az bir oran girerek arama yapabilirsiniz.</div>
              ) : (
                <div>
                  {total} maç bulundu (sayfa {page}/{totalPages || 1})
                </div>
              )}
              <div>
                Tolerans: %{formatTolerance(tolerancePercent)} · Lig: {selectedLeague} · Sezon: {selectedSeason}
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-100 bg-white p-4">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700">Sonuç Dağılımları</h3>
              <span className="text-[11px] text-gray-400">{matches.length} maç</span>
            </div>
            {matches.length === 0 ? (
              <div className="text-xs text-gray-400">Gösterilecek veri bulunamadı.</div>
            ) : (
              <div className="space-y-4">
                {resultStats.map((group) => (
                  <div key={group.id}>
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-[11px] font-semibold text-gray-500">{group.label}</span>
                      {group.missing > 0 ? (
                        <span className="text-[10px] text-gray-400">
                          Skoru olmayan: {group.missing}
                        </span>
                      ) : null}
                    </div>
                    {group.total === 0 ? (
                      <div className="text-[11px] text-gray-400">
                        Bu kategoride skor bulunamadı.
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {group.items.map((item) => (
                          <div key={item.key} className="flex items-center gap-3">
                            <span className="w-20 text-[11px] text-gray-500">{item.label}</span>
                            <div className="flex-1 h-2 rounded-full bg-gray-100">
                              <div
                                className="h-2 rounded-full bg-emerald-400"
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
              Yüzdeler, mevcut sayfa bazında hesaplanır.
            </div>
          </div>
        </aside>

        <div className="min-w-0 space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-sm font-semibold text-gray-700">Eşleşen Maçlar</h2>
              <div className="text-[11px] text-gray-400">Tutan oranlar yeşil renkle işaretlidir.</div>
            </div>
            <span className="text-xs text-gray-500">{total} eşleşme</span>
          </div>

          {isLoading ? (
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500 text-center">
              Yükleniyor...
            </div>
          ) : selectedFields.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500">
              Arama yapmak için en az bir oran girmeniz gerekiyor.
            </div>
          ) : matches.length === 0 ? (
            <div className="rounded-xl border border-gray-100 bg-white p-6 text-sm text-gray-500">
              Seçili tolerans ve filtrelerde eşleşen maç bulunamadı.
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
                <table className="min-w-full text-xs">
                  <thead className="bg-gray-50 text-gray-500">
                    <tr>
                      <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Maç</th>
                      <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Tarih</th>
                      <th rowSpan={2} className="px-3 py-3 text-center font-semibold">Skor</th>
                      {displayGroups.map((group) => (
                        <th
                          key={group.id}
                          colSpan={group.fields.length}
                          className="px-3 py-2 text-center font-semibold"
                        >
                          {group.label}
                        </th>
                      ))}
                    </tr>
                    <tr>
                      {displayFields.map((field) => (
                        <th key={field} className="px-3 py-2 text-center font-semibold">
                          {ODDS_LABELS[field]}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 text-gray-700">
                    {matches.map((match) => {
                      const outcomeKeys = getOutcomeKeys(match)
                      return (
                        <tr key={match.id} className="hover:bg-gray-50">
                          <td className="px-3 py-3">
                            <div className="font-semibold text-gray-900">
                              {match.home_team} vs {match.away_team}
                            </div>
                            <div className="text-[10px] text-gray-400">{match.league}</div>
                          </td>
                          <td className="px-3 py-3" suppressHydrationWarning>
                            {formatMatchDateTime(match.match_date, { includeYear: true })}
                          </td>
                          <td className="px-3 py-3 text-center">
                            <div>{match.score_ft ?? '-'}</div>
                            {match.score_ht ? (
                              <div className="text-[10px] text-gray-400">İY: {match.score_ht}</div>
                            ) : null}
                          </td>
                          {displayFields.map((field) => {
                            const outcomeHit = outcomeKeys.has(field)
                            return (
                              <td
                                key={`${match.id}-${field}`}
                                className={`px-3 py-3 text-center font-mono border ${
                                  outcomeHit
                                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                                    : 'border-gray-100'
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

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-3 mt-4">
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => handlePageChange(page - 1)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40"
                  >
                    Önceki
                  </button>
                  <span className="text-xs text-gray-500">
                    {page} / {totalPages}
                  </span>
                  <button
                    type="button"
                    disabled={page >= totalPages}
                    onClick={() => handlePageChange(page + 1)}
                    className="px-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white text-gray-600 disabled:opacity-40"
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
