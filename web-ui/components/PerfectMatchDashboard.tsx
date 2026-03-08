"use client"

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import {
    ODDS_CATEGORIES,
    getOutcomeKeys,
    isValidOdd,
    formatMatchDateTime,
    formatOdd,
    type MatchWithScores,
    type OddsKey,
} from '@/lib/match'

type PerfectMatchDashboardProps = {
    fixtures: MatchWithScores[]
}

const ALL_OPTION = 'Tümü'

const PERFECT_MATCH_CATEGORIES = [
    { id: 'ms', label: 'MS 1/X/2', fields: ['ms_1', 'ms_x', 'ms_2'] as OddsKey[] },
    { id: 'iyms', label: 'İY/MS', fields: ['iyms_11', 'iyms_1x', 'iyms_12', 'iyms_x1', 'iyms_xx', 'iyms_x2', 'iyms_21', 'iyms_2x', 'iyms_22'] as OddsKey[] },
    { id: 'au15', label: '1.5 Alt/Üst', fields: ['au_15_alt', 'au_15_ust'] as OddsKey[] },
    { id: 'au25', label: '2.5 Alt/Üst', fields: ['au_25_alt', 'au_25_ust'] as OddsKey[] },
    { id: 'kg', label: 'KG Var/Yok', fields: ['kg_var', 'kg_yok'] as OddsKey[] },
    { id: 'tg', label: '0-1 / 2-3 / 4-6 / 6+', fields: ['tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus'] as OddsKey[] },
]

const RESULT_GROUPS: { id: string; label: string; items: { key: OddsKey; label: string }[] }[] = [
    { id: 'ms', label: 'MS 1/X/2', items: [{ key: 'ms_1', label: 'MS 1' }, { key: 'ms_x', label: 'MS X' }, { key: 'ms_2', label: 'MS 2' }] },
    { id: 'iyms', label: 'İY/MS', items: [{ key: 'iyms_11', label: '1/1' }, { key: 'iyms_1x', label: '1/X' }, { key: 'iyms_12', label: '1/2' }, { key: 'iyms_x1', label: 'X/1' }, { key: 'iyms_xx', label: 'X/X' }, { key: 'iyms_x2', label: 'X/2' }, { key: 'iyms_21', label: '2/1' }, { key: 'iyms_2x', label: '2/X' }, { key: 'iyms_22', label: '2/2' }] },
    { id: 'kg', label: 'KG Var/Yok', items: [{ key: 'kg_var', label: 'KG Var' }, { key: 'kg_yok', label: 'KG Yok' }] },
    { id: 'au15', label: '1.5 Alt/Üst', items: [{ key: 'au_15_alt', label: '1.5 Alt' }, { key: 'au_15_ust', label: '1.5 Üst' }] },
    { id: 'au25', label: '2.5 Alt/Üst', items: [{ key: 'au_25_alt', label: '2.5 Alt' }, { key: 'au_25_ust', label: '2.5 Üst' }] },
    { id: 'tg', label: 'Toplam Gol', items: [{ key: 'tg_0_1', label: '0-1' }, { key: 'tg_2_3', label: '2-3' }, { key: 'tg_4_5', label: '4-5' }, { key: 'tg_6_plus', label: '6+' }] },
]

const ODDS_LABELS = RESULT_GROUPS.reduce<Record<OddsKey, string>>((acc, group) => {
    group.items.forEach((item) => { acc[item.key] = item.label })
    return acc
}, {} as Record<OddsKey, string>)

type PerfectMatchResult = MatchWithScores & { matchedCategoryIds: string[] }

type FixtureWithMatches = MatchWithScores & {
    perfectMatches: PerfectMatchResult[]
    matchingCategoryCount: number
    matchedCategoryIds: string[]
    total: number
    page: number
    totalPages: number
    isLoading: boolean
}

export default function PerfectMatchDashboard({ fixtures }: PerfectMatchDashboardProps) {
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
        PERFECT_MATCH_CATEGORIES.map((c) => c.id)
    )
    const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
    const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
    const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null)
    const [fixtureResults, setFixtureResults] = useState<Map<number, { matches: PerfectMatchResult[]; total: number; page: number; totalPages: number; isLoading: boolean }>>(new Map())

    const fetchPerfectMatches = useCallback(async (fixtureId: number, pageNum: number = 1) => {
        setFixtureResults((prev) => {
            const next = new Map(prev)
            const existing = next.get(fixtureId)
            next.set(fixtureId, { matches: existing?.matches ?? [], total: existing?.total ?? 0, page: pageNum, totalPages: existing?.totalPages ?? 0, isLoading: true })
            return next
        })

        try {
            const params = new URLSearchParams()
            params.set('fixtureId', String(fixtureId))
            params.set('categories', selectedCategoryIds.join(','))
            params.set('page', String(pageNum))
            params.set('limit', '50')
            if (selectedLeague !== ALL_OPTION) params.set('league', selectedLeague)
            if (selectedSeason !== ALL_OPTION) params.set('season', selectedSeason)

            const res = await fetch(`/api/matches/perfect?${params.toString()}`)
            const data = await res.json()

            const matches = (data.matches ?? []).map((m: MatchWithScores) => ({
                ...m,
                matchedCategoryIds: selectedCategoryIds,
            }))

            setFixtureResults((prev) => {
                const next = new Map(prev)
                next.set(fixtureId, { matches, total: data.total ?? 0, page: pageNum, totalPages: data.totalPages ?? 0, isLoading: false })
                return next
            })
        } catch {
            setFixtureResults((prev) => {
                const next = new Map(prev)
                next.set(fixtureId, { matches: [], total: 0, page: pageNum, totalPages: 0, isLoading: false })
                return next
            })
        }
    }, [selectedCategoryIds, selectedLeague, selectedSeason])

    // Fetch when expanding a fixture
    useEffect(() => {
        if (expandedFixtureId !== null) {
            fetchPerfectMatches(expandedFixtureId, 1)
        }
    }, [expandedFixtureId, fetchPerfectMatches])

    const getResultStats = (matches: MatchWithScores[]) => {
        const groupTotals = new Map<string, number>()
        const groupCounts = new Map<string, Map<OddsKey, number>>()

        RESULT_GROUPS.forEach((group) => {
            groupTotals.set(group.id, 0)
            groupCounts.set(group.id, new Map(group.items.map((item) => [item.key, 0])))
        })

        matches.forEach((match) => {
            const outcomeKeys = getOutcomeKeys(match)
            RESULT_GROUPS.forEach((group) => {
                const hits = group.items.filter((item) => outcomeKeys.has(item.key))
                if (hits.length === 0) return
                groupTotals.set(group.id, (groupTotals.get(group.id) ?? 0) + 1)
                const counts = groupCounts.get(group.id)
                if (!counts) return
                hits.forEach((item) => { counts.set(item.key, (counts.get(item.key) ?? 0) + 1) })
            })
        })

        return RESULT_GROUPS.map((group) => {
            const total = groupTotals.get(group.id) ?? 0
            const counts = groupCounts.get(group.id) ?? new Map()
            return {
                id: group.id, label: group.label, total,
                items: group.items.map((item) => {
                    const count = counts.get(item.key) ?? 0
                    const percent = total > 0 ? Math.round((count / total) * 100) : 0
                    return { ...item, count, percent }
                }),
            }
        })
    }

    const toggleCategory = (categoryId: string) => {
        setSelectedCategoryIds((prev) =>
            prev.includes(categoryId)
                ? prev.filter((id) => id !== categoryId)
                : [...prev, categoryId]
        )
    }

    const resetFilters = () => {
        setSelectedCategoryIds(PERFECT_MATCH_CATEGORIES.map((c) => c.id))
        setSelectedLeague(ALL_OPTION)
        setSelectedSeason(ALL_OPTION)
        setExpandedFixtureId(null)
        setFixtureResults(new Map())
    }

    // Filter fixtures that have valid odds for selected categories
    const validFixtures = useMemo(() =>
        fixtures.filter((fixture) =>
            selectedCategoryIds.some((catId) => {
                const cat = PERFECT_MATCH_CATEGORIES.find((c) => c.id === catId)
                return cat && cat.fields.some((field) => isValidOdd(fixture[field]))
            })
        ),
    [fixtures, selectedCategoryIds])

    return (
        <>
            <section className="rounded-xl border border-gray-100 bg-white p-4 mb-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-700">Filtreler</h3>
                    <button type="button" onClick={resetFilters} className="text-[11px] text-blue-600 hover:text-blue-700">
                        Filtreleri temizle
                    </button>
                </div>

                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-gray-500">
                            Geçmiş Maç Ligi
                            <input
                                type="text"
                                placeholder="Tümü"
                                value={selectedLeague === ALL_OPTION ? '' : selectedLeague}
                                onChange={(e) => setSelectedLeague(e.target.value.trim() || ALL_OPTION)}
                                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                            />
                        </label>
                        <label className="text-xs text-gray-500">
                            Geçmiş Maç Sezonu
                            <input
                                type="text"
                                placeholder="Tümü"
                                value={selectedSeason === ALL_OPTION ? '' : selectedSeason}
                                onChange={(e) => setSelectedSeason(e.target.value.trim() || ALL_OPTION)}
                                className="mt-2 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-xs text-gray-600"
                            />
                        </label>
                    </div>

                    <div>
                        <div className="text-xs text-gray-500 mb-2">
                            Eşleşme Kategorileri ({selectedCategoryIds.length}/{PERFECT_MATCH_CATEGORIES.length} seçili)
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {PERFECT_MATCH_CATEGORIES.map((category) => {
                                const isSelected = selectedCategoryIds.includes(category.id)
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => toggleCategory(category.id)}
                                        className={`rounded-full border px-3 py-1 text-[11px] font-semibold transition ${isSelected
                                            ? 'border-emerald-500 bg-emerald-50 text-emerald-700'
                                            : 'border-gray-200 bg-gray-50 text-gray-500 hover:border-gray-300'
                                            }`}
                                    >
                                        {category.label}
                                    </button>
                                )
                            })}
                        </div>
                    </div>
                </div>
            </section>

            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">Mükemmel Eşleşmeler</h2>
                <span className="text-xs text-gray-500">
                    {validFixtures.length} fikstür maçı
                </span>
            </div>

            {validFixtures.length === 0 ? (
                <div className="rounded-xl border border-gray-100 bg-white p-8 text-center">
                    <div className="text-4xl mb-3">🔍</div>
                    <h3 className="text-lg font-medium text-gray-700 mb-2">
                        Mükemmel Eşleşme Bulunamadı
                    </h3>
                    <p className="text-sm text-gray-500">
                        {selectedCategoryIds.length === 0
                            ? 'En az bir kategori seçin.'
                            : 'Seçili kategorilerde oranı olan maç yok.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {validFixtures.map((fixture) => {
                        const isExpanded = expandedFixtureId === fixture.id
                        const result = fixtureResults.get(fixture.id)
                        const perfectMatches = result?.matches ?? []
                        const resultStats = isExpanded ? getResultStats(perfectMatches) : []

                        return (
                            <div key={fixture.id} className="rounded-xl border border-gray-100 bg-white overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setExpandedFixtureId(isExpanded ? null : fixture.id)}
                                    className="w-full p-4 text-left hover:bg-gray-50 transition"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs text-gray-400">
                                                    {formatMatchDateTime(fixture.match_date)}
                                                </span>
                                                <span className="text-[10px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-500">
                                                    {fixture.league}
                                                </span>
                                            </div>
                                            <div className="font-medium text-gray-800">
                                                {fixture.home_team} vs {fixture.away_team}
                                            </div>
                                        </div>
                                        <div className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                            </svg>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 mt-3">
                                        {PERFECT_MATCH_CATEGORIES.filter((c) =>
                                            selectedCategoryIds.includes(c.id) &&
                                            c.fields.some((field) => isValidOdd(fixture[field]))
                                        ).map((category) => (
                                            <span key={category.id} className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium">
                                                {category.label}
                                            </span>
                                        ))}
                                    </div>
                                </button>

                                {isExpanded && (
                                    <div className="border-t border-gray-100 p-4 bg-gray-50">
                                        {result?.isLoading ? (
                                            <div className="text-center text-sm text-gray-500 py-4">Yükleniyor...</div>
                                        ) : (
                                            <>
                                                <div className="mb-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <h4 className="text-xs font-semibold text-gray-600">Maç Oranları</h4>
                                                        <Link href={`/analysis/${fixture.id}`} className="text-[11px] px-2 py-1 rounded-md border border-blue-200 bg-white text-blue-600 hover:border-blue-300 hover:text-blue-700 transition">
                                                            Analiz
                                                        </Link>
                                                    </div>
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        {ODDS_CATEGORIES.map((category) => (
                                                            <div key={category.id} className="bg-white rounded-lg p-3 border border-gray-100">
                                                                <div className="text-[11px] font-semibold text-gray-500 mb-2">{category.label}</div>
                                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-center text-[11px]">
                                                                    {category.fields.map((field) => (
                                                                        <div key={field} className="rounded-md border border-gray-100 bg-gray-50 p-2">
                                                                            <div className="text-[10px] text-gray-400 mb-1">{ODDS_LABELS[field] ?? field}</div>
                                                                            <div className="font-semibold text-gray-700">{formatOdd(fixture[field])}</div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>

                                                {perfectMatches.length > 0 && (
                                                    <>
                                                        <div className="mb-4">
                                                            <h4 className="text-xs font-semibold text-gray-600 mb-2">
                                                                Sonuç Dağılımı ({result?.total ?? perfectMatches.length} maç)
                                                            </h4>
                                                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                                                {resultStats.map((group) => (
                                                                    <div key={group.id} className="bg-white rounded-lg p-3 border border-gray-100">
                                                                        <div className="text-[11px] font-semibold text-gray-500 mb-2">{group.label}</div>
                                                                        {group.total === 0 ? (
                                                                            <div className="text-[10px] text-gray-400">Veri yok</div>
                                                                        ) : (
                                                                            <div className="space-y-1">
                                                                                {group.items.map((item) => (
                                                                                    <div key={item.key} className="flex items-center gap-2">
                                                                                        <span className="w-12 text-[10px] text-gray-500">{item.label}</span>
                                                                                        <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                                                                                            <div className="h-1.5 rounded-full bg-blue-400" style={{ width: `${item.percent}%` }} />
                                                                                        </div>
                                                                                        <span className="text-[10px] text-gray-500 w-8 text-right">%{item.percent}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <h4 className="text-xs font-semibold text-gray-600 mb-2">
                                                                Eşleşen Geçmiş Maçlar
                                                            </h4>
                                                            <div className="max-h-64 overflow-y-auto space-y-2">
                                                                {perfectMatches.map((pm) => (
                                                                    <Link key={pm.id} href={`/analysis/${pm.id}`} className="block bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-200 transition">
                                                                        <div className="flex items-center justify-between">
                                                                            <div>
                                                                                <div className="text-xs text-gray-400 mb-0.5">{formatMatchDateTime(pm.match_date, { includeYear: true })}</div>
                                                                                <div className="text-sm font-medium text-gray-700">{pm.home_team} vs {pm.away_team}</div>
                                                                                <div className="text-[10px] text-gray-400 mt-0.5">{pm.league} · {pm.season}</div>
                                                                            </div>
                                                                            <div className="text-right">
                                                                                {pm.score_ft && <div className="text-lg font-bold text-gray-800">{pm.score_ft}</div>}
                                                                                {pm.score_ht && <div className="text-[10px] text-gray-400">İY: {pm.score_ht}</div>}
                                                                            </div>
                                                                        </div>
                                                                    </Link>
                                                                ))}
                                                            </div>
                                                            {(result?.totalPages ?? 0) > 1 && (
                                                                <div className="flex items-center justify-center gap-3 mt-3">
                                                                    <button
                                                                        type="button"
                                                                        disabled={(result?.page ?? 1) <= 1}
                                                                        onClick={() => fetchPerfectMatches(fixture.id, (result?.page ?? 1) - 1)}
                                                                        className="px-3 py-1 text-[11px] rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-40"
                                                                    >
                                                                        Önceki
                                                                    </button>
                                                                    <span className="text-[11px] text-gray-500">
                                                                        {result?.page ?? 1} / {result?.totalPages ?? 1}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        disabled={(result?.page ?? 1) >= (result?.totalPages ?? 1)}
                                                                        onClick={() => fetchPerfectMatches(fixture.id, (result?.page ?? 1) + 1)}
                                                                        className="px-3 py-1 text-[11px] rounded border border-gray-200 bg-white text-gray-600 disabled:opacity-40"
                                                                    >
                                                                        Sonraki
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}

                                                {perfectMatches.length === 0 && !result?.isLoading && (
                                                    <div className="text-center text-sm text-gray-500 py-4">
                                                        Bu maç için mükemmel eşleşme bulunamadı.
                                                    </div>
                                                )}
                                            </>
                                        )}
                                    </div>
                                )}
                            </div>
                        )
                    })}
                </div>
            )}
        </>
    )
}
