"use client"

import Link from 'next/link'
import { formatOdd, getOutcomeKeys, type MatchWithScores } from '@/lib/match'

type FixtureTableProps = {
  matches: MatchWithScores[]
}

const formatMatchTime = (value: string) =>
  new Date(value).toLocaleTimeString('tr-TR', {
    hour: '2-digit',
    minute: '2-digit',
  })

export default function FixtureTable({ matches }: FixtureTableProps) {
  const sortedMatches = [...matches].sort(
    (a, b) => new Date(a.match_date).getTime() - new Date(b.match_date).getTime()
  )

  return (
    <section className="bg-white rounded-xl shadow-sm border border-gray-100">
      <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 border-b border-gray-100">
        <div>
          <h2 className="text-lg font-semibold text-gray-800">Maçlar</h2>
          <p className="text-xs text-gray-400">{sortedMatches.length} maç</p>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-full text-sm whitespace-nowrap">
          <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
            <tr>
              <th className="px-4 py-3 text-left font-semibold">Saat</th>
              <th className="px-4 py-3 text-left font-semibold">Lig</th>
              <th className="px-4 py-3 text-left font-semibold">Maç</th>
              <th className="px-4 py-3 text-center font-semibold">Skor</th>
              <th className="px-4 py-3 text-center font-semibold">MS 1</th>
              <th className="px-4 py-3 text-center font-semibold">MS X</th>
              <th className="px-4 py-3 text-center font-semibold">MS 2</th>
              <th className="px-4 py-3 text-right font-semibold">Analiz</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {sortedMatches.map((match) => {
              const outcomeKeys = getOutcomeKeys(match)
              const neutralOddsClass = 'text-gray-900'
              const ms1Class = outcomeKeys.has('ms_1') ? 'text-emerald-600' : neutralOddsClass
              const msxClass = outcomeKeys.has('ms_x') ? 'text-emerald-600' : neutralOddsClass
              const ms2Class = outcomeKeys.has('ms_2') ? 'text-emerald-600' : neutralOddsClass
              const leagueLabel = match.league?.trim() || 'Bilinmeyen Lig'
              const scoreLabel = match.score_ht
                ? `${match.score_ft ?? '-'} (İY ${match.score_ht})`
                : match.score_ft ?? '-'

              return (
                <tr key={match.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-gray-600" suppressHydrationWarning>
                    {formatMatchTime(match.match_date)}
                  </td>
                  <td className="px-4 py-3 text-gray-600">{leagueLabel}</td>
                  <td className="px-4 py-3 text-gray-900 font-semibold">
                    {match.home_team} vs {match.away_team}
                  </td>
                  <td className="px-4 py-3 text-center text-xs text-gray-500">
                    {scoreLabel}
                  </td>
                  <td className={`px-4 py-3 text-center font-mono ${ms1Class}`}>{formatOdd(match.ms_1)}</td>
                  <td className={`px-4 py-3 text-center font-mono ${msxClass}`}>{formatOdd(match.ms_x)}</td>
                  <td className={`px-4 py-3 text-center font-mono ${ms2Class}`}>{formatOdd(match.ms_2)}</td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/analysis/${match.id}`}
                      className="inline-flex items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-1.5 text-xs font-semibold text-blue-700 hover:bg-blue-100"
                    >
                      Analiz
                    </Link>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </section>
  )
}
