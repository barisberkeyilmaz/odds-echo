"use client"

import { useMemo, useState } from 'react'
import {
    Bar,
    BarChart,
    CartesianGrid,
    Cell,
    Legend,
    Line,
    LineChart,
    Pie,
    PieChart,
    ResponsiveContainer,
    Tooltip,
    XAxis,
    YAxis,
} from 'recharts'
import SurpriseTable from '@/components/SurpriseTable'

interface Match {
    id: number
    home_team: string
    away_team: string
    match_date: string
    league: string
    season: string
    score_ht: string
    score_ft: string
    surpriseType?: '1/2' | '2/1'
    iyms_12?: number | null
    iyms_21?: number | null
}

interface SurpriseDashboardProps {
    initialMatches: Match[]
}

const SURPRISE_COLORS: Record<'1/2' | '2/1', string> = {
    '1/2': '#7c3aed',
    '2/1': '#f97316',
}

const getSurpriseOdd = (match: Match) => {
    if (match.surpriseType === '1/2') return match.iyms_12 ?? null
    if (match.surpriseType === '2/1') return match.iyms_21 ?? null
    return null
}

const MONTH_LABELS = ['Oca', 'Şub', 'Mar', 'Nis', 'May', 'Haz', 'Tem', 'Ağu', 'Eyl', 'Eki', 'Kas', 'Ara']

export default function SurpriseDashboard({ initialMatches }: SurpriseDashboardProps) {
    const [selectedSeason, setSelectedSeason] = useState<string>('Tümü')
    const [selectedLeague, setSelectedLeague] = useState<string>('Tümü')

    const seasons = useMemo(() => {
        const unique = new Set(initialMatches.map(m => m.season))
        return ['Tümü', ...Array.from(unique).sort().reverse()]
    }, [initialMatches])

    const leagues = useMemo(() => {
        const unique = new Set(initialMatches.map(m => m.league))
        return ['Tümü', ...Array.from(unique).sort()]
    }, [initialMatches])

    const filteredMatches = useMemo(() => {
        return initialMatches.filter(match => {
            const seasonMatch = selectedSeason === 'Tümü' || match.season === selectedSeason
            const leagueMatch = selectedLeague === 'Tümü' || match.league === selectedLeague
            return seasonMatch && leagueMatch
        })
    }, [initialMatches, selectedSeason, selectedLeague])

    const isLeagueSelected = selectedLeague !== 'Tümü'

    const leagueData = useMemo(() => {
        const map = new Map<string, number>()
        for (const match of filteredMatches) {
            const key = match.league || 'Bilinmiyor'
            map.set(key, (map.get(key) ?? 0) + 1)
        }
        return Array.from(map.entries())
            .map(([league, count]) => ({ league, count }))
            .sort((a, b) => b.count - a.count)
    }, [filteredMatches])

    const teamData = useMemo(() => {
        const map = new Map<string, number>()
        const addTeam = (team?: string | null) => {
            const teamName = (team ?? '').trim() || 'Bilinmiyor'
            map.set(teamName, (map.get(teamName) ?? 0) + 1)
        }
        for (const match of filteredMatches) {
            addTeam(match.home_team)
            addTeam(match.away_team)
        }
        return Array.from(map.entries())
            .map(([team, count]) => ({ team, count }))
            .sort((a, b) => b.count - a.count)
    }, [filteredMatches])

    const typeData = useMemo(() => {
        let count12 = 0
        let count21 = 0
        for (const match of filteredMatches) {
            if (match.surpriseType === '1/2') count12 += 1
            if (match.surpriseType === '2/1') count21 += 1
        }
        return [
            { name: '1/2', value: count12 },
            { name: '2/1', value: count21 },
        ].filter(item => item.value > 0)
    }, [filteredMatches])

    const oddsData = useMemo(() => {
        let missingOdds = 0
        const map = new Map<string, { oddLabel: string, count: number, count12: number, count21: number }>()
        for (const match of filteredMatches) {
            const odd = getSurpriseOdd(match)
            if (odd === null) {
                missingOdds += 1
                continue
            }
            const key = String(odd)
            const entry = map.get(key) ?? { oddLabel: key, count: 0, count12: 0, count21: 0 }
            entry.count += 1
            if (match.surpriseType === '1/2') entry.count12 += 1
            if (match.surpriseType === '2/1') entry.count21 += 1
            map.set(key, entry)
        }
        const toNumber = (value: string) => {
            const parsed = Number.parseFloat(value)
            return Number.isNaN(parsed) ? null : parsed
        }
        const data = Array.from(map.values())
            .filter(item => item.count > 2)
            .sort((a, b) => {
                if (b.count !== a.count) return b.count - a.count
                const aNum = toNumber(a.oddLabel)
                const bNum = toNumber(b.oddLabel)
                if (aNum === null || bNum === null) return b.oddLabel.localeCompare(a.oddLabel)
                return bNum - aNum
            })
        return { data, missingOdds }
    }, [filteredMatches])

    const monthData = useMemo(() => {
        const counts = Array.from({ length: 12 }, () => 0)
        for (const match of filteredMatches) {
            const date = new Date(match.match_date)
            if (Number.isNaN(date.getTime())) continue
            counts[date.getMonth()] += 1
        }
        return counts
            .map((count, index) => ({
                month: MONTH_LABELS[index],
                count,
            }))
            .filter(item => item.count > 0)
    }, [filteredMatches])

    const resetFilters = () => {
        setSelectedSeason('Tümü')
        setSelectedLeague('Tümü')
    }

    const leagueChartHeight = Math.max(240, leagueData.length * 28)
    const teamChartHeight = Math.max(240, teamData.length * 28)
    const oddsChartHeight = Math.max(240, oddsData.data.length * 26)

    return (
        <div className="space-y-6">
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex flex-col md:flex-row gap-4 items-center justify-between">
                <div className="flex flex-col md:flex-row gap-4 w-full md:w-auto">
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

            {filteredMatches.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg shadow border border-gray-100">
                    <div className="text-4xl mb-2">🌪️</div>
                    <h2 className="text-xl text-gray-600">Bu kriterlere uygun maç bulunamadı.</h2>
                </div>
            ) : (
                <>
                    <div className="grid gap-6 lg:grid-cols-3">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:col-span-2">
                            <div className="flex items-baseline justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">
                                    {isLeagueSelected ? 'Takım Bazlı Sürpriz Maçı Sayısı' : 'Lig Bazlı Sürpriz Sayısı'}
                                </h3>
                                <span className="text-xs text-gray-400">
                                    {isLeagueSelected ? `${teamData.length} takım` : `${leagueData.length} lig`}
                                </span>
                            </div>
                            <div style={{ height: isLeagueSelected ? teamChartHeight : leagueChartHeight }}>
                                <ResponsiveContainer width="100%" height="100%">
                                    <BarChart
                                        data={isLeagueSelected ? teamData : leagueData}
                                        layout="vertical"
                                        margin={{ left: 16, right: 24 }}
                                    >
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis type="number" allowDecimals={false} />
                                        <YAxis
                                            type="category"
                                            dataKey={isLeagueSelected ? 'team' : 'league'}
                                            width={isLeagueSelected ? 170 : 140}
                                            interval={0}
                                        />
                                        <Tooltip cursor={{ fill: '#f3f4f6' }} />
                                        <Bar dataKey="count" fill="#2563eb" radius={[6, 6, 6, 6]} />
                                    </BarChart>
                                </ResponsiveContainer>
                            </div>
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                            <div className="flex items-baseline justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">Sürpriz Tipi Dağılımı</h3>
                                <span className="text-xs text-gray-400">1/2 vs 2/1</span>
                            </div>
                            <div className="h-[280px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <PieChart>
                                        <Pie
                                            data={typeData}
                                            dataKey="value"
                                            nameKey="name"
                                            innerRadius={60}
                                            outerRadius={95}
                                            paddingAngle={3}
                                        >
                                            {typeData.map(entry => (
                                                <Cell key={entry.name} fill={SURPRISE_COLORS[entry.name as '1/2' | '2/1']} />
                                            ))}
                                        </Pie>
                                        <Tooltip />
                                        <Legend verticalAlign="bottom" height={24} />
                                    </PieChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    <div className="grid gap-6 lg:grid-cols-3">
                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4 lg:col-span-2">
                            <div className="flex items-baseline justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">Tekrarlayan Sürpriz Oranlar (&gt;= 3 kez)</h3>
                                <span className="text-xs text-gray-400">Oran bulunan maç: {filteredMatches.length - oddsData.missingOdds}</span>
                            </div>
                            {oddsData.data.length === 0 ? (
                                <div className="h-[240px] flex items-center justify-center text-sm text-gray-500">
                                    3 veya daha fazla tekrar eden oran bulunamadı.
                                </div>
                            ) : (
                                <div style={{ height: oddsChartHeight }}>
                                    <ResponsiveContainer width="100%" height="100%">
                                        <BarChart data={oddsData.data} layout="vertical" margin={{ left: 16, right: 24 }}>
                                            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                            <XAxis type="number" allowDecimals={false} />
                                            <YAxis type="category" dataKey="oddLabel" width={70} />
                                            <Tooltip cursor={{ fill: '#f3f4f6' }} />
                                            <Legend verticalAlign="bottom" height={24} />
                                            <Bar dataKey="count12" name="1/2" stackId="a" fill={SURPRISE_COLORS['1/2']} radius={[6, 6, 6, 6]} />
                                            <Bar dataKey="count21" name="2/1" stackId="a" fill={SURPRISE_COLORS['2/1']} radius={[6, 6, 6, 6]} />
                                        </BarChart>
                                    </ResponsiveContainer>
                                </div>
                            )}
                        </div>

                        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-4">
                            <div className="flex items-baseline justify-between mb-4">
                                <h3 className="font-semibold text-gray-800">Aylık Sürpriz Trendi</h3>
                                <span className="text-xs text-gray-400">Yıllar geneli</span>
                            </div>
                            <div className="h-[300px]">
                                <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={monthData} margin={{ left: 8, right: 16 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                                        <XAxis dataKey="month" />
                                        <YAxis allowDecimals={false} />
                                        <Tooltip />
                                        <Line type="monotone" dataKey="count" stroke="#10b981" strokeWidth={2} dot={false} />
                                    </LineChart>
                                </ResponsiveContainer>
                            </div>
                        </div>
                    </div>

                    <SurpriseTable matches={filteredMatches} />
                </>
            )}
        </div>
    )
}
