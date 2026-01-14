import Header from '@/components/Header'
import OddsSearchDashboard from '@/components/OddsSearchDashboard'
import { supabase } from '@/lib/supabaseClient'
import { buildMatchSelect, SCORE_FIELDS, type MatchWithScores } from '@/lib/match'

export const dynamic = 'force-dynamic'

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)
const PAGE_SIZE = 1000

async function getCandidateMatches() {
  const matches: MatchWithScores[] = []
  const seenIds = new Set<number>()

  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await supabase
      .from('matches')
      .select(MATCH_SELECT)
      .eq('status', 'MS')
      .not('score_ft', 'is', null)
      .order('match_date', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + PAGE_SIZE - 1)

    if (error || !data) break

    for (const match of data as MatchWithScores[]) {
      if (seenIds.has(match.id)) continue
      seenIds.add(match.id)
      matches.push(match)
    }

    if (data.length < PAGE_SIZE) break
  }

  return matches
}

export default async function OddsSearchPage() {
  const matches = await getCandidateMatches()

  return (
    <main className="min-h-screen bg-gray-50 p-3 md:p-5">
      <div className="max-w-[1400px] mx-auto">
        <Header />

        <section className="bg-white rounded-xl shadow-sm border border-gray-100 p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-bold text-gray-900">Oran Arama</div>
              <div className="text-xs text-gray-500 mt-1">
                Girilen oranlara göre geçmiş maçları bulun ve sonuçları filtreleyin.
              </div>
            </div>
            <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-2 text-sm text-blue-700">
              Toplam {matches.length} maç taranıyor
            </div>
          </div>
        </section>

        <OddsSearchDashboard candidates={matches} />
      </div>
    </main>
  )
}
