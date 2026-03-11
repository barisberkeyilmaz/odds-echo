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
import { useFilterOptions, groupLeaguesByCountry } from '@/lib/useFilterOptions'
import SearchableSelect, { type SelectOption } from '@/components/SearchableSelect'

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

/**
 * Check which selected categories match between a fixture and a historical match.
 * A category matches if ALL its valid odds fields in the fixture have the same value in the result.
 */
function getMatchedCategories(
    fixture: MatchWithScores,
    result: MatchWithScores,
    selectedCategoryIds: string[],
): string[] {
    const matched: string[] = []
    for (const cat of PERFECT_MATCH_CATEGORIES) {
        if (!selectedCategoryIds.includes(cat.id)) continue
        const validFields = cat.fields.filter((f) => isValidOdd(fixture[f]))
        if (validFields.length === 0) continue
        const allMatch = validFields.every((f) => {
            const fv = fixture[f]
            const rv = result[f]
            return isValidOdd(fv) && isValidOdd(rv) && fv === rv
        })
        if (allMatch) matched.push(cat.id)
    }
    return matched
}

type PerfectMatchResult = MatchWithScores & { matchedCategoryIds: string[] }

export default function PerfectMatchDashboard({ fixtures }: PerfectMatchDashboardProps) {
    const { leagues, seasons } = useFilterOptions()
    const [selectedCategoryIds, setSelectedCategoryIds] = useState<string[]>(
        PERFECT_MATCH_CATEGORIES.map((c) => c.id)
    )
    const [selectedLeague, setSelectedLeague] = useState(ALL_OPTION)
    const [selectedSeason, setSelectedSeason] = useState(ALL_OPTION)
    const [expandedFixtureId, setExpandedFixtureId] = useState<number | null>(null)
    const [fixtureResults, setFixtureResults] = useState<Map<number, { matches: PerfectMatchResult[]; total: number; page: number; totalPages: number; isLoading: boolean }>>(new Map())
    const [perfectCounts, setPerfectCounts] = useState<Record<number, { total: number; matchedCategories: string[] }>>({})
    const [countsLoading, setCountsLoading] = useState(false)

    const leagueSelectOptions = useMemo<SelectOption[]>(() => {
        const result: SelectOption[] = []
        for (const group of groupLeaguesByCountry(leagues)) {
            for (const league of group.items) {
                result.push({ value: league.value, label: league.label, group: group.country })
            }
        }
        return result
    }, [leagues])

    const fetchPerfectMatches = useCallback(async (fixtureId: number, pageNum: number = 1) => {
        setFixtureResults((prev) => {
            const next = new Map(prev)
            const existing = next.get(fixtureId)
            next.set(fixtureId, { matches: existing?.matches ?? [], total: existing?.total ?? 0, page: pageNum, totalPages: existing?.totalPages ?? 0, isLoading: true })
            return next
        })

        // Find the fixture to compute matched categories
        const fixture = fixtures.find((f) => f.id === fixtureId)

        try {
            const params = new URLSearchParams()
            params.set('fixtureId', String(fixtureId))
            params.set('categories', selectedCategoryIds.join(','))
            params.set('page', String(pageNum))
            params.set('limit', '100')
            if (selectedLeague !== ALL_OPTION) params.set('league', selectedLeague)
            if (selectedSeason !== ALL_OPTION) params.set('season', selectedSeason)

            const res = await fetch(`/api/matches/perfect?${params.toString()}`)
            const data = await res.json()

            const matches: PerfectMatchResult[] = (data.matches ?? []).map((m: MatchWithScores) => ({
                ...m,
                matchedCategoryIds: fixture ? getMatchedCategories(fixture, m, selectedCategoryIds) : [],
            }))

            // Sort by number of matched categories (most first)
            matches.sort((a, b) => b.matchedCategoryIds.length - a.matchedCategoryIds.length)

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
    }, [fixtures, selectedCategoryIds, selectedLeague, selectedSeason])

    useEffect(() => {
        if (expandedFixtureId !== null) {
            fetchPerfectMatches(expandedFixtureId, 1)
        }
    }, [expandedFixtureId, fetchPerfectMatches])

    // Fetch perfect match counts for all fixtures when categories/filters change
    useEffect(() => {
        const fixtureIds = fixtures
            .filter((f) => selectedCategoryIds.some((catId) => {
                const cat = PERFECT_MATCH_CATEGORIES.find((c) => c.id === catId)
                return cat && cat.fields.some((field) => isValidOdd(f[field]))
            }))
            .map((f) => f.id)

        if (fixtureIds.length === 0) {
            setPerfectCounts({})
            return
        }

        const CHUNK_SIZE = 50
        const chunks: number[][] = []
        for (let i = 0; i < fixtureIds.length; i += CHUNK_SIZE) {
            chunks.push(fixtureIds.slice(i, i + CHUNK_SIZE))
        }

        setCountsLoading(true)
        Promise.all(
            chunks.map((chunk) =>
                fetch('/api/matches/perfect/counts', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        fixtureIds: chunk,
                        categories: selectedCategoryIds,
                        ...(selectedLeague !== ALL_OPTION && { league: selectedLeague }),
                        ...(selectedSeason !== ALL_OPTION && { season: selectedSeason }),
                    }),
                }).then((res) => res.json())
            )
        )
            .then((results) => {
                const merged: Record<number, { total: number; matchedCategories: string[] }> = {}
                for (const data of results) {
                    Object.assign(merged, data.counts ?? {})
                }
                setPerfectCounts(merged)
            })
            .catch(() => setPerfectCounts({}))
            .finally(() => setCountsLoading(false))
    }, [fixtures, selectedCategoryIds, selectedLeague, selectedSeason])

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
        setPerfectCounts({})
    }

    const validFixtures = useMemo(() =>
        fixtures.filter((fixture) => (perfectCounts[fixture.id]?.total ?? 0) > 0),
    [fixtures, perfectCounts])

    const getCategoryLabel = (catId: string) =>
        PERFECT_MATCH_CATEGORIES.find((c) => c.id === catId)?.label ?? catId

    return (
        <>
            <section className="relative z-20 rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4 mb-6 card-glow overflow-visible">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Filtreler</h3>
                    <button type="button" onClick={resetFilters} className="text-[11px] text-[var(--accent-blue)] hover:brightness-110">
                        Filtreleri temizle
                    </button>
                </div>

                <div className="space-y-5">
                    <div className="grid gap-3 md:grid-cols-2">
                        <div className="text-xs text-[var(--text-tertiary)]">
                            <span className="block mb-2">Geçmiş Maç Ligi</span>
                            <SearchableSelect
                                options={leagueSelectOptions}
                                value={selectedLeague}
                                onChange={setSelectedLeague}
                                placeholder="Lig ara..."
                            />
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)]">
                            <span className="block mb-2">Geçmiş Maç Sezonu</span>
                            <SearchableSelect
                                options={seasons.map((s) => ({ value: s, label: s }))}
                                value={selectedSeason}
                                onChange={setSelectedSeason}
                                placeholder="Sezon ara..."
                            />
                        </div>
                    </div>

                    <div>
                        <div className="text-xs text-[var(--text-tertiary)] mb-2">
                            Eşleşme Kategorileri ({selectedCategoryIds.length}/{PERFECT_MATCH_CATEGORIES.length} seçili)
                            <span className="text-[var(--text-muted)] ml-2">— en az biri uyarsa eşleşir</span>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            {PERFECT_MATCH_CATEGORIES.map((category) => {
                                const isSelected = selectedCategoryIds.includes(category.id)
                                return (
                                    <button
                                        key={category.id}
                                        type="button"
                                        onClick={() => toggleCategory(category.id)}
                                        className={`rounded-md border px-3 py-2 text-xs sm:px-3 sm:py-1 sm:text-[11px] font-medium transition-all ${isSelected
                                            ? 'bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] border-[var(--accent-blue)]'
                                            : 'bg-transparent text-[var(--text-tertiary)] border-[var(--border-primary)] hover:border-[var(--text-muted)]'
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
                <h2 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Eşleşmeler</h2>
                <span className="text-xs text-[var(--text-tertiary)] font-mono">
                    {validFixtures.length} / {fixtures.length} maçta eşleşme
                </span>
            </div>

            {countsLoading ? (
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8">
                    <div className="space-y-3">
                        <div className="skeleton h-4 w-3/4 mx-auto" />
                        <div className="skeleton h-4 w-1/2 mx-auto" />
                        <div className="skeleton h-4 w-5/6 mx-auto" />
                    </div>
                </div>
            ) : validFixtures.length === 0 ? (
                <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-8 text-center">
                    <h3 className="text-lg font-medium text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
                        Eşleşme Bulunamadı
                    </h3>
                    <p className="text-sm text-[var(--text-tertiary)]">
                        {selectedCategoryIds.length === 0
                            ? 'En az bir kategori seçin.'
                            : 'Seçili kategorilerde eşleşen geçmiş maç bulunamadı.'}
                    </p>
                </div>
            ) : (
                <div className="space-y-3 stagger">
                    {validFixtures.map((fixture) => {
                        const isExpanded = expandedFixtureId === fixture.id
                        const result = fixtureResults.get(fixture.id)
                        const perfectMatches = result?.matches ?? []
                        const resultStats = isExpanded ? getResultStats(perfectMatches) : []

                        return (
                            <div key={fixture.id} className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] overflow-hidden">
                                <button
                                    type="button"
                                    onClick={() => setExpandedFixtureId(isExpanded ? null : fixture.id)}
                                    className="w-full p-4 text-left hover:bg-[var(--bg-tertiary)] transition-colors"
                                >
                                    <div className="flex items-center justify-between">
                                        <div className="flex-1">
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-xs text-[var(--text-muted)] font-mono">
                                                    {formatMatchDateTime(fixture.match_date)}
                                                </span>
                                                <span className="text-[10px] px-2 py-0.5 rounded bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]">
                                                    {fixture.league_display ?? fixture.league}
                                                </span>
                                            </div>
                                            <div className="font-medium text-[var(--text-primary)]">
                                                {fixture.home_team} vs {fixture.away_team}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <span className="text-xs sm:text-[10px] px-2 py-0.5 rounded-full bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-mono font-medium">
                                                {perfectCounts[fixture.id]?.total ?? 0} eşleşme
                                            </span>
                                            <div className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`}>
                                                <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor">
                                                    <path fillRule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clipRule="evenodd" />
                                                </svg>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex flex-wrap gap-1.5 mt-2">
                                        {(perfectCounts[fixture.id]?.matchedCategories ?? []).map((catId) => (
                                            <span
                                                key={catId}
                                                className="text-[10px] px-2 py-0.5 rounded font-medium bg-[var(--accent-win-bg)] text-[var(--accent-win)]"
                                            >
                                                {getCategoryLabel(catId)}
                                            </span>
                                        ))}
                                    </div>
                                </button>

                                {isExpanded && (
                                    <div className="border-t border-[var(--border-primary)] p-4 bg-[var(--bg-primary)]">
                                        {result?.isLoading ? (
                                            <div className="py-4 space-y-3">
                                                <div className="skeleton h-4 w-3/4" />
                                                <div className="skeleton h-4 w-1/2" />
                                                <div className="skeleton h-4 w-5/6" />
                                            </div>
                                        ) : (
                                            <>
                                                <div className="mb-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <h4 className="text-xs font-semibold text-[var(--text-secondary)]">Maç Oranları</h4>
                                                        <Link href={`/analysis/${fixture.id}`} className="text-[11px] px-2 py-1 rounded-md bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] hover:brightness-110 transition-all">
                                                            Analiz
                                                        </Link>
                                                    </div>
                                                    <div className="grid gap-3 md:grid-cols-2">
                                                        {ODDS_CATEGORIES.map((category) => (
                                                            <div key={category.id} className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-primary)]">
                                                                <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{category.label}</div>
                                                                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 text-center text-[11px]">
                                                                    {category.fields.map((field) => (
                                                                        <div key={field} className="rounded-md bg-[var(--bg-tertiary)] p-2">
                                                                            <div className="text-[10px] text-[var(--text-muted)] mb-1">{ODDS_LABELS[field] ?? field}</div>
                                                                            <div className="font-semibold font-mono tabular-nums text-[var(--text-primary)]">{formatOdd(fixture[field])}</div>
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
                                                            <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                                                Sonuç Dağılımı ({result?.total ?? perfectMatches.length} maç)
                                                            </h4>
                                                            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                                                                {resultStats.map((group) => (
                                                                    <div key={group.id} className="bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-primary)]">
                                                                        <div className="text-[11px] font-medium text-[var(--text-tertiary)] uppercase tracking-wider mb-2">{group.label}</div>
                                                                        {group.total === 0 ? (
                                                                            <div className="text-[10px] text-[var(--text-muted)]">Veri yok</div>
                                                                        ) : (
                                                                            <div className="space-y-1">
                                                                                {group.items.map((item) => (
                                                                                    <div key={item.key} className="flex items-center gap-2">
                                                                                        <span className="w-12 text-[10px] text-[var(--text-tertiary)]">{item.label}</span>
                                                                                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                                                                                            <div className="h-1.5 rounded-full bg-[var(--accent-blue)] transition-all duration-500" style={{ width: `${item.percent}%` }} />
                                                                                        </div>
                                                                                        <span className="text-[10px] font-mono text-[var(--text-tertiary)] w-8 text-right">%{item.percent}</span>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ))}
                                                            </div>
                                                        </div>

                                                        <div>
                                                            <h4 className="text-xs font-semibold text-[var(--text-secondary)] mb-2">
                                                                Eşleşen Geçmiş Maçlar
                                                            </h4>
                                                            <div className="max-h-[60vh] sm:max-h-96 overflow-y-auto space-y-2">
                                                                {perfectMatches.map((pm) => (
                                                                    <Link key={pm.id} href={`/analysis/${pm.id}`} className="block bg-[var(--bg-secondary)] rounded-lg p-3 border border-[var(--border-primary)] hover:border-[var(--border-accent)] hover:shadow-[var(--glow-blue)] transition-all">
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="flex-1 min-w-0">
                                                                                <div className="text-xs text-[var(--text-muted)] font-mono mb-0.5">{formatMatchDateTime(pm.match_date, { includeYear: true })}</div>
                                                                                <div className="text-sm font-medium text-[var(--text-primary)]">{pm.home_team} vs {pm.away_team}</div>
                                                                                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{pm.league} · {pm.season}</div>
                                                                                {/* Matched category badges */}
                                                                                <div className="flex flex-wrap gap-1 mt-1.5">
                                                                                    <span className="text-[11px] px-2 py-1 sm:text-[9px] sm:px-1.5 sm:py-0.5 rounded bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] font-semibold">
                                                                                        {pm.matchedCategoryIds.length}/{selectedCategoryIds.length} kategori
                                                                                    </span>
                                                                                    {pm.matchedCategoryIds.map((catId) => (
                                                                                        <span key={catId} className="text-[11px] px-2 py-1 sm:text-[9px] sm:px-1.5 sm:py-0.5 rounded bg-[var(--accent-win-bg)] text-[var(--accent-win)]">
                                                                                            {getCategoryLabel(catId)}
                                                                                        </span>
                                                                                    ))}
                                                                                </div>
                                                                            </div>
                                                                            <div className="text-right ml-3 shrink-0">
                                                                                {pm.score_ft && <div className="text-lg font-bold font-mono text-[var(--text-primary)]">{pm.score_ft}</div>}
                                                                                {pm.score_ht && <div className="text-[10px] text-[var(--text-muted)] font-mono">İY: {pm.score_ht}</div>}
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
                                                                        className="px-3 py-2.5 sm:py-1 min-h-[44px] sm:min-h-0 text-xs sm:text-[11px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 transition-colors"
                                                                    >
                                                                        Önceki
                                                                    </button>
                                                                    <span className="text-[11px] text-[var(--text-tertiary)] font-mono">
                                                                        {result?.page ?? 1} / {result?.totalPages ?? 1}
                                                                    </span>
                                                                    <button
                                                                        type="button"
                                                                        disabled={(result?.page ?? 1) >= (result?.totalPages ?? 1)}
                                                                        onClick={() => fetchPerfectMatches(fixture.id, (result?.page ?? 1) + 1)}
                                                                        className="px-3 py-2.5 sm:py-1 min-h-[44px] sm:min-h-0 text-xs sm:text-[11px] rounded-md border border-[var(--border-primary)] bg-[var(--bg-secondary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-40 transition-colors"
                                                                    >
                                                                        Sonraki
                                                                    </button>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}

                                                {perfectMatches.length === 0 && !result?.isLoading && (
                                                    <div className="text-center text-sm text-[var(--text-tertiary)] py-4">
                                                        Bu maç için eşleşme bulunamadı.
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
