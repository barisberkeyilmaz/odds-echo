"use client"

interface Match {
    id: number
    home_team: string
    away_team: string
    match_date: string
    league: string
    season: string
    score_ht: string
    score_ft: string
    surpriseType?: '1/0' | '2/0'
    iyms_1x?: number | null
    iyms_2x?: number | null
    [key: string]: any
}

interface SurpriseDrawTableProps {
    matches: Match[]
}

export default function SurpriseDrawTable({ matches }: SurpriseDrawTableProps) {
    return (
        <div className="space-y-6">
            {matches.length === 0 ? (
                <div className="text-center py-20 bg-white rounded-lg shadow border border-gray-100">
                    <div className="text-4xl mb-2">🌪️</div>
                    <h2 className="text-xl text-gray-600">Bu kriterlere uygun maç bulunamadı.</h2>
                </div>
            ) : (
                <div className="bg-white rounded-lg shadow overflow-hidden flex flex-col border border-gray-200">
                    <div className="hidden md:grid md:grid-cols-12 bg-gray-50 border-b border-gray-200 text-xs font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                        <div className="col-span-2">Tarih / Sezon</div>
                        <div className="col-span-2">Lig</div>
                        <div className="col-span-4 text-center">Maç (İY / MS)</div>
                        <div className="col-span-2 text-center">Sürpriz</div>
                        <div className="col-span-2 text-center">Oran</div>
                    </div>

                    <div className="divide-y divide-gray-200">
                        {matches.map((match: any) => (
                            <div key={match.id} className="grid grid-cols-1 md:grid-cols-12 hover:bg-gray-50 transition-colors py-4 px-4 items-center gap-4 md:gap-0">
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

                                <div className="col-span-2 text-sm text-gray-600 flex items-center">
                                    <span className="md:hidden font-bold mr-2 text-gray-400 text-xs">Lig:</span>
                                    {match.league}
                                </div>

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

                                <div className="col-span-2 flex justify-between md:justify-center items-center">
                                    <span className="md:hidden text-xs font-bold text-gray-400">Tip:</span>
                                    <span className={`inline-flex items-center px-3 py-1 rounded-full text-xs font-medium ${match.surpriseType === '1/0' ? 'bg-sky-100 text-sky-800' : 'bg-amber-100 text-amber-800'}`}>
                                        {match.surpriseType === '1/0' ? '1 / 0' : '2 / 0'}
                                    </span>
                                </div>

                                <div className="col-span-2 flex justify-between md:justify-center items-center">
                                    <span className="md:hidden text-xs font-bold text-gray-400">Oran:</span>
                                    <div className="text-sm font-mono font-bold text-gray-700">
                                        {match.surpriseType === '1/0'
                                            ? (match.iyms_1x ? match.iyms_1x.toFixed(2) : '-')
                                            : (match.iyms_2x ? match.iyms_2x.toFixed(2) : '-')}
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
