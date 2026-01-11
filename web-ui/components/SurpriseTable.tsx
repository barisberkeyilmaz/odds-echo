"use client"

import { useState, useMemo } from 'react'

interface Match {
    id: number
    home_team: string
    away_team: string
    match_date: string
    league: string
    season: string
    score_ht: string
    score_ft: string
    surpriseType?: string
    iyms_12?: number | null
    iyms_21?: number | null
    [key: string]: any
}

interface SurpriseTableProps {
    initialMatches: Match[]
}

export default function SurpriseTable({ initialMatches }: SurpriseTableProps) {
    const [selectedSeason, setSelectedSeason] = useState<string>('Tümü')
    const [selectedLeague, setSelectedLeague] = useState<string>('Tümü')

    // Extract unique values for filters
    const seasons = useMemo(() => {
        const unique = new Set(initialMatches.map(m => m.season))
        return ['Tümü', ...Array.from(unique).sort().reverse()]
    }, [initialMatches])

    const leagues = useMemo(() => {
        const unique = new Set(initialMatches.map(m => m.league))
        return ['Tümü', ...Array.from(unique).sort()]
    }, [initialMatches])

    // Filter logic
    const filteredMatches = useMemo(() => {
        return initialMatches.filter(match => {
            const seasonMatch = selectedSeason === 'Tümü' || match.season === selectedSeason
            const leagueMatch = selectedLeague === 'Tümü' || match.league === selectedLeague
            return seasonMatch && leagueMatch
        })
    }, [initialMatches, selectedSeason, selectedLeague])

    const resetFilters = () => {
        setSelectedSeason('Tümü')
        setSelectedLeague('Tümü')
    }

    return (
        <div className="space-y-6">
            {/* Filter Bar */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
                    {/* Season Filter */}
                    <div className="flex flex-col">
                        <label className="text-xs font-semibold text-gray-500 mb-1 ml-1">Sezon</label>
                        <select
                            value={selectedSeason}
                            onChange={(e) => setSelectedSeason(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 min-w-[140px]"
                        >
                            {seasons.map(season => (
                                <option key={season} value={season}>{season}</option>
                            ))}
                        </select>
                    </div>

                    {/* League Filter */}
                    <div className="flex flex-col">
                        <label className="text-xs font-semibold text-gray-500 mb-1 ml-1">Lig</label>
                        <select
                            value={selectedLeague}
                            onChange={(e) => setSelectedLeague(e.target.value)}
                            className="bg-gray-50 border border-gray-200 text-gray-900 text-sm rounded-lg focus:ring-blue-500 focus:border-blue-500 block w-full p-2.5 min-w-[200px]"
                        >
                            {leagues.map(league => (
                                <option key={league} value={league}>{league}</option>
                            ))}
                        </select>
                    </div>
                </div>

                {/* Counter & Reset */}
                <div className="flex items-center gap-4 w-full md:w-auto justify-between md:justify-end">
                    <span className="text-sm font-medium text-gray-500">
                        Gösterilen: <strong className="text-gray-900">{filteredMatches.length}</strong>
                    </span>
                    {(selectedSeason !== 'Tümü' || selectedLeague !== 'Tümü') && (
                        <button
                            onClick={resetFilters}
                            className="text-sm text-red-600 hover:text-red-800 font-medium hover:underline"
                        >
                            Filtreleri Temizle
                        </button>
                    )}
                </div>
            </div>

            {/* Empty State */}
            {filteredMatches.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg shadow border border-gray-100">
                    <div className="text-4xl mb-2">🌪️</div>
                    <h2 className="text-xl text-gray-600">Bu kriterlere uygun maç bulunamadı.</h2>
                </div>
            ) : (
                /* CSS Grid Table */
                <div className="bg-white rounded-lg shadow overflow-hidden flex flex-col border border-gray-200">

                    {/* HEADER ROW */}
                    <div className="hidden md:grid md:grid-cols-12 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        <div className="col-span-2">Tarih / Sezon</div>
                        <div className="col-span-2">Lig</div>
                        <div className="col-span-4 text-center">Maç (İY / MS)</div>
                        <div className="col-span-2 text-center">Sürpriz</div>
                        <div className="col-span-2 text-center">Oran</div>
                    </div>

                    {/* DATA ROWS */}
                    <div className="divide-y divide-gray-200">
                        {filteredMatches.map((match: any) => (
                            <div key={match.id} className="grid grid-cols-1 md:grid-cols-12 hover:bg-gray-50 transition-colors py-4 px-4 items-center gap-4 md:gap-0">

                                {/* Tarih */}
                                <div className="col-span-2 flex flex-row md:flex-col justify-between md:justify-start" suppressHydrationWarning>
                                    <span className="text-sm font-medium text-gray-900">
                                        {new Date(match.match_date).toLocaleDateString('tr-TR', {
                                            day: 'numeric', month: 'short', year: 'numeric'
                                        })}
                                    </span>
                                    <span className="text-xs text-gray-400 md:mt-1">
                                        {match.season}
                                    </span>
                                </div>

                                {/* Lig */}
                                <div className="col-span-2 text-sm text-gray-600 flex items-center">
                                    <span className="md:hidden font-bold mr-2 text-gray-400 text-xs">Lig:</span>
                                    {match.league}
                                </div>

                                {/* Maç */}
                                <div className="col-span-4 flex flex-col md:flex-row items-center justify-center bg-gray-50 md:bg-transparent p-3 md:p-0 rounded-lg">
                                    <div className="flex-1 text-sm font-bold text-gray-800 text-center md:text-right w-full md:w-auto">
                                        {match.home_team}
                                    </div>

                                    <div className="flex flex-col items-center mx-3 my-2 md:my-0 min-w-[50px]">
                                        <span className="px-2 py-0.5 bg-white md:bg-gray-100 border border-gray-200 md:border-transparent rounded text-sm font-black text-gray-900 shadow-sm md:shadow-none">
                                            {match.score_ft}
                                        </span>
                                        <span className="text-[10px] text-gray-500 mt-1 font-mono">
                                            ({match.score_ht})
                                        </span>
                                    </div>

                                    <div className="flex-1 text-sm font-bold text-gray-800 text-center md:text-left w-full md:w-auto">
                                        {match.away_team}
                                    </div>
                                </div>

                                {/* Sürpriz Tipi */}
                                <div className="col-span-2 flex justify-between md:justify-center items-center">
                                    <span className="md:hidden text-xs font-bold text-gray-400">Tip:</span>
                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${match.surpriseType === '1/2' ? 'bg-purple-100 text-purple-800' : 'bg-orange-100 text-orange-800'}`}>
                                        {match.surpriseType === '1/2' ? '1 / 2' : '2 / 1'}
                                    </span>
                                </div>

                                {/* Oran */}
                                <div className="col-span-2 flex justify-between md:justify-center items-center">
                                    <span className="md:hidden text-xs font-bold text-gray-400">Oran:</span>
                                    <div className="text-sm font-mono font-bold text-gray-700">
                                        {match.surpriseType === '1/2'
                                            ? (match.iyms_12 ? match.iyms_12.toFixed(2) : '-')
                                            : (match.iyms_21 ? match.iyms_21.toFixed(2) : '-')}
                                    </div>
                                </div>

                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    )
}
