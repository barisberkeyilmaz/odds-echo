"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import {
    ODDS_CATEGORIES,
    getOutcomeKeys,
    isCategoryMatch,
    isValidOdd,
    formatMatchDateTime,
    formatOdd,
    type MatchWithScores,
    type OddsKey,
} from '@/lib/match'

type PerfectMatchDashboardProps = {
    fixtures: MatchWithScores[]
    historicalMatches: MatchWithScores[]
}

const ALL_OPTION = 'Tümü'

// Define the 6 search categories for perfect match
const PERFECT_MATCH_CATEGORIES = [
    {
        id: 'ms',
        label: 'MS 1/X/2',
        fields: ['ms_1', 'ms_x', 'ms_2'] as OddsKey[],
    },
    {
        id: 'iyms',
        label: 'İY/MS',
        fields: [
            'iyms_11', 'iyms_1x', 'iyms_12',
            'iyms_x1', 'iyms_xx', 'iyms_x2',
            'iyms_21', 'iyms_2x', 'iyms_22',
        ] as OddsKey[],
    },
    {
        id: 'au15',
        label: '1.5 Alt/Üst',
        fields: ['au_15_alt', 'au_15_ust'] as OddsKey[],
    },
    {
        id: 'au25',
        label: '2.5 Alt/Üst',
        fields: ['au_25_alt', 'au_25_ust'] as OddsKey[],
    },
    {
        id: 'kg',
        label: 'KG Var/Yok',
        fields: ['kg_var', 'kg_yok'] as OddsKey[],
    },
    {
        id: 'tg',
        label: '0-1 / 2-3 / 4-6 / 6+',
        fields: ['tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus'] as OddsKey[],
    },
]

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

const ODDS_LABELS = RESULT_GROUPS.reduce<Record<OddsKey, string>>((acc, group) => {
    group.items.forEach((item) => {
        acc[item.key] = item.label
    })
    return acc
}, {} as Record<OddsKey, string>)

type FixtureWithMatches = MatchWithScores & {
    perfectMatches: (MatchWithScores & { matchedCategoryIds: string[] })[]
    matchingCategoryCount: number
    matchedCategoryIds: string[]
}

export default function PerfectMatchDashboard({
    fixtures,
    historicalMatches,
}: PerfectMatchDashboardProps) {
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
        PERFECT_MATCH_CATEGORIES.map((c) => c.id)
    )
    const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
    const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
    const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null)

    // Get available categories for each fixture
    // A category is available if at least one field has a valid odd
    // (only skips categories where ALL odds are '-')
    const getAvailableCategories = (fixture: MatchWithScores) =>
        PERFECT_MATCH_CATEGORIES.filter((category) =>
            category.fields.some((field) => isValidOdd(fixture[field]))
        )

    // Check if a category should be skipped for matching
    // Skip only if ALL fields are invalid in either fixture or historical
    // (at least one valid field on each side is required)
    const isCategoryValidForBoth = (
        fixture: MatchWithScores,
        historical: MatchWithScores,
        fields: OddsKey[]
    ) => {
        const fixtureHasAnyValid = fields.some((field) => isValidOdd(fixture[field]))
        const historicalHasAnyValid = fields.some((field) => isValidOdd(historical[field]))
        return fixtureHasAnyValid && historicalHasAnyValid
    }

    // Filter options
    const leagueOptions = useMemo(() => {
        const unique = new Set<string>()
        historicalMatches.forEach((m) => {
            if (m.league) unique.add(m.league)
        })
        return [ALL_OPTION, ...Array.from(unique).sort()]
    }, [historicalMatches])

    const seasonOptions = useMemo(() => {
        const unique = new Set<string>()
        historicalMatches.forEach((m) => {
            if (m.season) unique.add(m.season)
        })
        return [ALL_OPTION, ...Array.from(unique).sort().reverse()]
    }, [historicalMatches])

    // Filter historical matches by league/season
    const filteredHistorical = useMemo(
        () =>
            historicalMatches.filter((m) => {
                const leagueMatch = selectedLeague === ALL_OPTION || m.league === selectedLeague
                const seasonMatch = selectedSeason === ALL_OPTION || m.season === selectedSeason
                return leagueMatch && seasonMatch
            }),
        [historicalMatches, selectedLeague, selectedSeason]
    )

    // Calculate perfect matches for each fixture
    const fixturesWithMatches = useMemo<FixtureWithMatches[]>(() => {
        if (selectedCategoryIds.length === 0) {
            return fixtures.map((f) => ({
                ...f,
                perfectMatches: [],
                matchingCategoryCount: 0,
                matchedCategoryIds: [],
            }))
        }

        return fixtures
            .map((fixture) => {
                const availableCategories = getAvailableCategories(fixture)
                const selectedCategories = PERFECT_MATCH_CATEGORIES.filter(
                    (c) => selectedCategoryIds.includes(c.id) && availableCategories.some((ac) => ac.id === c.id)
                )

                if (selectedCategories.length === 0) {
                    return {
                        ...fixture,
                        perfectMatches: [],
                        matchingCategoryCount: 0,
                        matchedCategoryIds: [],
                    }
                }

                const perfectMatches = filteredHistorical
                    .filter((historical) => historical.id !== fixture.id)
                    .map((historical) => {
                        const matchedCategoryIds = selectedCategories
                            .filter((category) =>
                                // Skip if either fixture or historical has all invalid odds for this category
                                isCategoryValidForBoth(fixture, historical, category.fields) &&
                                isCategoryMatch(fixture, historical, category.fields, 0, 0)
                            )
                            .map((c) => c.id)

                        return {
                            ...historical,
                            matchedCategoryIds,
                        }
                    })
                    .filter((m) => m.matchedCategoryIds.length === selectedCategories.length)

                // Also calculate which categories matched for the fixture
                const fixtureMatchedCategoryIds = selectedCategories
                    .filter((category) =>
                        perfectMatches.length > 0 &&
                        perfectMatches.every((pm) => pm.matchedCategoryIds.includes(category.id))
                    )
                    .map((c) => c.id)

                return {
                    ...fixture,
                    perfectMatches,
                    matchingCategoryCount: perfectMatches.length,
                    matchedCategoryIds: fixtureMatchedCategoryIds,
                }
            })
            .filter((f) => f.matchingCategoryCount > 0)
            .sort((a, b) => b.matchingCategoryCount - a.matchingCategoryCount)
    }, [fixtures, filteredHistorical, selectedCategoryIds])

    // Calculate result statistics for expanded fixture
    const getResultStats = (matches: MatchWithScores[]) => {
        const groupTotals = new Map<string, number>()
        const groupCounts = new Map<string, Map<OddsKey, number>>()

        RESULT_GROUPS.forEach((group) => {
            groupTotals.set(group.id, 0)
            groupCounts.set(
                group.id,
                new Map(group.items.map((item) => [item.key, 0]))
            )
        })

        matches.forEach((match) => {
            const outcomeKeys = getOutcomeKeys(match)
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
    }

    return (
        <>
            {/* Filters Section */}
            <section className="rounded-xl border border-gray-100 bg-white p-4 mb-6">
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
                    {/* League and Season Filters */}
                    <div className="grid gap-3 md:grid-cols-2">
                        <label className="text-xs text-gray-500">
                            Geçmiş Maç Ligi
                            <select
                                value={selectedLeague}
                                onChange={(e) => setSelectedLeague(e.target.value)}
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
                            Geçmiş Maç Sezonu
                            <select
                                value={selectedSeason}
                                onChange={(e) => setSelectedSeason(e.target.value)}
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

                    {/* Category Selection */}
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

            {/* Results Summary */}
            <div className="flex items-center justify-between mb-4">
                <h2 className="text-sm font-semibold text-gray-700">
                    Mükemmel Eşleşmeler
                </h2>
                <span className="text-xs text-gray-500">
                    {fixturesWithMatches.length} maç eşleşme buldu
                </span>
            </div>

            {/* Fixtures List */}
            {fixturesWithMatches.length === 0 ? (
                <div className="rounded-xl border border-gray-100 bg-white p-8 text-center">
                    <div className="text-4xl mb-3">🔍</div>
                    <h3 className="text-lg font-medium text-gray-700 mb-2">
                        Mükemmel Eşleşme Bulunamadı
                    </h3>
                    <p className="text-sm text-gray-500">
                        {selectedCategoryIds.length === 0
                            ? 'En az bir kategori seçin.'
                            : 'Seçili kategorilerde tam eşleşme bulunan maç yok.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3">
                    {fixturesWithMatches.map((fixture) => {
                        const isExpanded = expandedFixtureId === fixture.id
                        const resultStats = isExpanded ? getResultStats(fixture.perfectMatches) : []

                        return (
                            <div
                                key={fixture.id}
                                className="rounded-xl border border-gray-100 bg-white overflow-hidden"
                            >
                                {/* Fixture Header */}
                                <button
                                    type="button"
                                    onClick={() =>
                                        setExpandedFixtureId(isExpanded ? null : fixture.id)
                                    }
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

                                        <div className="flex items-center gap-3">
                                            {/* Match Count Badge */}
                                            <div className="text-center">
                                                <div className="text-2xl font-bold text-emerald-600">
                                                    {fixture.matchingCategoryCount}
                                                </div>
                                                <div className="text-[10px] text-gray-400">eşleşme</div>
                                            </div>

                                            {/* Expand Icon */}
                                            <div
                                                className={`text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''
                                                    }`}
                                            >
                                                <svg
                                                    width="20"
                                                    height="20"
                                                    viewBox="0 0 20 20"
                                                    fill="currentColor"
                                                >
                                                    <path
                                                        fillRule="evenodd"
                                                        d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z"
                                                        clipRule="evenodd"
                                                    />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Category Badges - only show categories with valid odds */}
                                    <div className="flex flex-wrap gap-1.5 mt-3">
                                        {PERFECT_MATCH_CATEGORIES.filter((c) =>
                                            selectedCategoryIds.includes(c.id) &&
                                            c.fields.some((field) => isValidOdd(fixture[field]))
                                        ).map((category) => (
                                            <span
                                                key={category.id}
                                                className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-700 font-medium"
                                            >
                                                ✓ {category.label}
                                            </span>
                                        ))}
                                    </div>
                                </button>

                                {/* Expanded Content */}
                                {isExpanded && (
                                    <div className="border-t border-gray-100 p-4 bg-gray-50">
                                        {/* Fixture Odds */}
                                        <div className="mb-4">
                                            <div className="flex items-center justify-between mb-2">
                                                <h4 className="text-xs font-semibold text-gray-600">
                                                    Maç Oranları
                                                </h4>
                                                <Link
                                                    href={`/analysis/${fixture.id}`}
                                                    className="text-[11px] px-2 py-1 rounded-md border border-blue-200 bg-white text-blue-600 hover:border-blue-300 hover:text-blue-700 transition"
                                                >
                                                    Analiz
                                                </Link>
                                            </div>
                                            <div className="grid gap-3 md:grid-cols-2">
                                                {ODDS_CATEGORIES.map((category) => (
                                                    <div
                                                        key={category.id}
                                                        className="bg-white rounded-lg p-3 border border-gray-100"
                                                    >
                                                        <div className="text-[11px] font-semibold text-gray-500 mb-2">
                                                            {category.label}
                                                        </div>
                                                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-center text-[11px]">
                                                            {category.fields.map((field) => (
                                                                <div
                                                                    key={field}
                                                                    className="rounded-md border border-gray-100 bg-gray-50 p-2"
                                                                >
                                                                    <div className="text-[10px] text-gray-400 mb-1">
                                                                        {ODDS_LABELS[field] ?? field}
                                                                    </div>
                                                                    <div className="font-semibold text-gray-700">
                                                                        {formatOdd(fixture[field])}
                                                                    </div>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Result Distribution */}
                                        <div className="mb-4">
                                            <h4 className="text-xs font-semibold text-gray-600 mb-2">
                                                Sonuç Dağılımı ({fixture.perfectMatches.length} maç)
                                            </h4>
                                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                                {resultStats.map((group) => (
                                                    <div
                                                        key={group.id}
                                                        className="bg-white rounded-lg p-3 border border-gray-100"
                                                    >
                                                        <div className="text-[11px] font-semibold text-gray-500 mb-2">
                                                            {group.label}
                                                        </div>
                                                        {group.total === 0 ? (
                                                            <div className="text-[10px] text-gray-400">
                                                                Veri yok
                                                            </div>
                                                        ) : (
                                                            <div className="space-y-1">
                                                                {group.items.map((item) => (
                                                                    <div
                                                                        key={item.key}
                                                                        className="flex items-center gap-2"
                                                                    >
                                                                        <span className="w-12 text-[10px] text-gray-500">
                                                                            {item.label}
                                                                        </span>
                                                                        <div className="flex-1 h-1.5 rounded-full bg-gray-100">
                                                                            <div
                                                                                className="h-1.5 rounded-full bg-blue-400"
                                                                                style={{ width: `${item.percent}%` }}
                                                                            />
                                                                        </div>
                                                                        <span className="text-[10px] text-gray-500 w-8 text-right">
                                                                            %{item.percent}
                                                                        </span>
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* Historical Matches List */}
                                        <div>
                                            <h4 className="text-xs font-semibold text-gray-600 mb-2">
                                                Eşleşen Geçmiş Maçlar
                                            </h4>
                                            <div className="max-h-64 overflow-y-auto space-y-2">
                                                {fixture.perfectMatches.slice(0, 20).map((pm) => (
                                                    <Link
                                                        key={pm.id}
                                                        href={`/analysis/${pm.id}`}
                                                        className="block bg-white rounded-lg p-3 border border-gray-100 hover:border-blue-200 transition"
                                                    >
                                                        <div className="flex items-center justify-between">
                                                            <div>
                                                                <div className="text-xs text-gray-400 mb-0.5">
                                                                    {formatMatchDateTime(pm.match_date, {
                                                                        includeYear: true,
                                                                    })}
                                                                </div>
                                                                <div className="text-sm font-medium text-gray-700">
                                                                    {pm.home_team} vs {pm.away_team}
                                                                </div>
                                                                <div className="text-[10px] text-gray-400 mt-0.5">
                                                                    {pm.league} • {pm.season}
                                                                </div>
                                                            </div>
                                                            <div className="text-right">
                                                                {pm.score_ft && (
                                                                    <div className="text-lg font-bold text-gray-800">
                                                                        {pm.score_ft}
                                                                    </div>
                                                                )}
                                                                {pm.score_ht && (
                                                                    <div className="text-[10px] text-gray-400">
                                                                        İY: {pm.score_ht}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </Link>
                                                ))}
                                                {fixture.perfectMatches.length > 20 && (
                                                    <div className="text-xs text-gray-400 text-center py-2">
                                                        +{fixture.perfectMatches.length - 20} daha fazla maç
                                                    </div>
                                                )}
                                            </div>
                                        </div>
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
