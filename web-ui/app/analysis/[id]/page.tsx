import AnalysisDashboard from '@/components/AnalysisDashboard'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { buildMatchSelect, formatMatchDateTime, SCORE_FIELDS, type MatchWithScores } from '@/lib/match'

export const dynamic = 'force-dynamic'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)
const CANDIDATE_PAGE_SIZE = 1000

async function getMatchById(matchId: number) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .single()

  if (error || !data) return null
  return data as MatchWithScores
}

async function getCandidateMatches(matchId: number) {
  const matches: MatchWithScores[] = []
  const seenIds = new Set<number>()

  for (let offset = 0; ; offset += CANDIDATE_PAGE_SIZE) {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('status', 'MS')
      .not('score_ft', 'is', null)
      .neq('id', matchId)
      .order('match_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + CANDIDATE_PAGE_SIZE - 1)

    if (error || !data) break
    for (const candidate of data as MatchWithScores[]) {
      if (seenIds.has(candidate.id)) continue
      seenIds.add(candidate.id)
      matches.push(candidate)
    }

    if (data.length < CANDIDATE_PAGE_SIZE) break
  }

  return matches
}

type AnalysisParams = {
  id: string
}

export default async function AnalysisPage({
  params,
}: {
  params: AnalysisParams | Promise<AnalysisParams>
}) {
  const resolvedParams = await params
  const matchId = Number(resolvedParams.id)
  if (!Number.isFinite(matchId)) notFound()

  const match = await getMatchById(matchId)
  if (!match) notFound()

  const candidates = await getCandidateMatches(matchId)

  return (
    <main className="min-h-screen bg-gray-50 p-3 md:p-5">
      <div className="max-w-[1400px] mx-auto">
        <Header />

        <div className="mb-6">
          <Link href="/" className="text-sm text-blue-600 hover:text-blue-700">
            ← Fikstüre dön
          </Link>
        </div>

        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-2 py-1 rounded">
              {match.league}
            </span>
            <span className="text-xs text-gray-500" suppressHydrationWarning>
              {formatMatchDateTime(match.match_date, { includeYear: true })}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-bold text-gray-900">
                {match.home_team} vs {match.away_team}
              </div>
              <div className="text-xs text-gray-400 mt-1">Sezon: {match.season}</div>
            </div>
            {match.score_ft ? (
              <div className="rounded-lg border border-emerald-100 bg-emerald-50 px-4 py-2 text-sm text-emerald-700">
                Skor: {match.score_ft} {match.score_ht ? `(İY: ${match.score_ht})` : ''}
              </div>
            ) : null}
          </div>
        </section>

        <AnalysisDashboard match={match} candidates={candidates} />
      </div>
    </main>
  )
}
