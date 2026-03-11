import AnalysisDashboard from '@/components/AnalysisDashboard'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { supabase } from '@/lib/supabaseClient'
import { buildMatchSelect, formatMatchDateTime, SCORE_FIELDS, type MatchWithScores } from '@/lib/match'

export const revalidate = 3600

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

async function getMatchById(matchId: number) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', matchId)
    .single()

  if (error || !data) return null
  return data as unknown as MatchWithScores
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

  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">

        <div className="mb-6">
          <Link href="/" className="text-sm text-[var(--accent-blue)] hover:brightness-110 transition-all">
            ← Fikstüre dön
          </Link>
        </div>

        <section className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-3 mb-4">
            <span className="text-xs font-semibold bg-[var(--accent-blue-bg)] text-[var(--accent-blue)] px-2 py-1 rounded">
              {match.league}
            </span>
            <span className="text-xs text-[var(--text-tertiary)] font-mono" suppressHydrationWarning>
              {formatMatchDateTime(match.match_date, { includeYear: true })}
            </span>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">
                {match.home_team} vs {match.away_team}
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1">Sezon: {match.season}</div>
            </div>
            {match.score_ft ? (
              <div className="rounded-lg border border-[var(--accent-win)] bg-[var(--accent-win-bg)] px-4 py-2 text-sm text-[var(--accent-win)] font-mono">
                Skor: {match.score_ft} {match.score_ht ? `(İY: ${match.score_ht})` : ''}
              </div>
            ) : null}
          </div>
        </section>

        <AnalysisDashboard match={match} />
      </div>
    </main>
  )
}
