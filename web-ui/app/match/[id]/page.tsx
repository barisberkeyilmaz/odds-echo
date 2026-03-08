import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  buildMatchSelect,
  formatMatchDateTime,
  formatOdd,
  hasCompleteOdds,
  hasValidMatchCore,
  isCategoryMatch,
  type MatchWithScores,
  type OddsKey,
  CATEGORY_LABELS,
  ODDS_CATEGORIES,
  SCORE_FIELDS,
} from '@/lib/match'

export const dynamic = 'force-dynamic'

interface SimilarMatch extends MatchWithScores {
  matchCount: number
  matchedCategoryIds: string[]
}

type OddsGroupItem = {
  label: string
  key: OddsKey
  accent?: string
}

type OddsGroup = {
  title: string
  gridClass: string
  items: OddsGroupItem[]
}

const SIMILARITY_TOLERANCE_ABS = 0.05
const SIMILARITY_TOLERANCE_PCT = 0.04

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

const getBadgeClass = (count: number) => {
  if (count >= 5) return 'bg-emerald-100 text-emerald-700'
  if (count === 4) return 'bg-green-100 text-green-700'
  if (count === 3) return 'bg-yellow-100 text-yellow-700'
  if (count === 2) return 'bg-orange-100 text-orange-700'
  return 'bg-gray-100 text-gray-600'
}

async function getFixture(id: number) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('id', id)
    .single()

  if (error || !data) return null
  return data as unknown as MatchWithScores
}

async function getSimilarMatches(baseMatch: MatchWithScores) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .eq('status', 'MS')
    .not('score_ft', 'is', null)
    .order('match_date', { ascending: false })
    .limit(1500)

  if (error || !data) return []

  const candidates = data as unknown as MatchWithScores[]

  return candidates
    .map((candidate) => {
      const matchedCategoryIds = ODDS_CATEGORIES.filter((category) =>
        isCategoryMatch(
          baseMatch,
          candidate,
          category.fields,
          SIMILARITY_TOLERANCE_ABS,
          SIMILARITY_TOLERANCE_PCT
        )
      ).map((category) => category.id)

      return {
        ...candidate,
        matchedCategoryIds,
        matchCount: matchedCategoryIds.length,
      }
    })
    .filter((match) => match.matchCount > 0)
    .sort((a, b) => {
      if (b.matchCount !== a.matchCount) return b.matchCount - a.matchCount
      return new Date(b.match_date).getTime() - new Date(a.match_date).getTime()
    })
}

const oddsGroups: OddsGroup[] = [
  {
    title: 'MS 1/X/2',
    gridClass: 'grid-cols-3',
    items: [
      { label: 'MS 1', key: 'ms_1', accent: 'text-blue-600' },
      { label: 'MS X', key: 'ms_x', accent: 'text-gray-700' },
      { label: 'MS 2', key: 'ms_2', accent: 'text-red-600' },
    ],
  },
  {
    title: 'İY/MS',
    gridClass: 'grid-cols-3',
    items: [
      { label: '1/1', key: 'iyms_11' },
      { label: '1/X', key: 'iyms_1x' },
      { label: '1/2', key: 'iyms_12' },
      { label: 'X/1', key: 'iyms_x1' },
      { label: 'X/X', key: 'iyms_xx' },
      { label: 'X/2', key: 'iyms_x2' },
      { label: '2/1', key: 'iyms_21' },
      { label: '2/X', key: 'iyms_2x' },
      { label: '2/2', key: 'iyms_22' },
    ],
  },
  {
    title: '1.5 & 2.5 Alt/Üst',
    gridClass: 'grid-cols-2 sm:grid-cols-4',
    items: [
      { label: '1.5 Alt', key: 'au_15_alt' },
      { label: '1.5 Üst', key: 'au_15_ust' },
      { label: '2.5 Alt', key: 'au_25_alt' },
      { label: '2.5 Üst', key: 'au_25_ust' },
    ],
  },
  {
    title: 'Karşılıklı Gol',
    gridClass: 'grid-cols-2',
    items: [
      { label: 'KG Var', key: 'kg_var' },
      { label: 'KG Yok', key: 'kg_yok' },
    ],
  },
  {
    title: 'Toplam Gol',
    gridClass: 'grid-cols-2 sm:grid-cols-4',
    items: [
      { label: '0-1', key: 'tg_0_1' },
      { label: '2-3', key: 'tg_2_3' },
      { label: '4-5', key: 'tg_4_5' },
      { label: '6+', key: 'tg_6_plus' },
    ],
  },
]

export default async function MatchDetailPage({ params }: { params: { id: string } }) {
  const fixtureId = Number(params.id)
  if (!Number.isFinite(fixtureId)) notFound()

  const fixture = await getFixture(fixtureId)
  if (!fixture || !hasCompleteOdds(fixture) || !hasValidMatchCore(fixture)) notFound()

  const similarMatches = await getSimilarMatches(fixture)
  const totalCategories = ODDS_CATEGORIES.length

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
              {fixture.league}
            </span>
            <span className="text-xs text-gray-500" suppressHydrationWarning>
              {formatMatchDateTime(fixture.match_date, { includeYear: true })}
            </span>
          </div>

          <div className="flex justify-between items-center">
            <div className="text-right flex-1">
              <div className="text-lg font-bold text-gray-800">{fixture.home_team}</div>
            </div>
            <div className="px-4 text-gray-300 font-light">vs</div>
            <div className="text-left flex-1">
              <div className="text-lg font-bold text-gray-800">{fixture.away_team}</div>
            </div>
          </div>

          <div className="mt-4 flex flex-wrap gap-2 text-xs text-gray-500">
            <span className="bg-gray-100 px-2 py-1 rounded">Sezon: {fixture.season}</span>
            <span className="bg-gray-100 px-2 py-1 rounded">
              Benzerlik toleransı: ±{SIMILARITY_TOLERANCE_ABS} veya %{Math.round(SIMILARITY_TOLERANCE_PCT * 100)}
            </span>
          </div>
        </section>

        <section className="mt-6 grid gap-4 lg:grid-cols-2">
          {oddsGroups.map((group) => (
            <div key={group.title} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
              <h3 className="text-sm font-semibold text-gray-700 mb-3">{group.title}</h3>
              <div className={`grid ${group.gridClass} gap-3 text-center`}>
                {group.items.map((item) => (
                  <div key={item.key} className="bg-gray-50 rounded p-2">
                    <div className="text-xs text-gray-500 mb-1">{item.label}</div>
                    <div className={`font-mono font-bold ${item.accent ?? 'text-gray-800'}`}>
                      {formatOdd(fixture[item.key])}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </section>

        <section className="mt-10">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-800">Geçmiş Benzer Maçlar</h2>
            <span className="text-xs text-gray-500">
              {similarMatches.length} eşleşme
            </span>
          </div>

          {similarMatches.length === 0 ? (
            <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-sm text-gray-500">
              Bu oranlara yakın geçmiş maç bulunamadı.
            </div>
          ) : (
            <div className="grid gap-4">
              {similarMatches.map((match) => (
                <div key={match.id} className="bg-white rounded-xl shadow-sm border border-gray-100 p-5">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <div className="text-xs text-gray-500">{match.league}</div>
                      <div className="text-base font-semibold text-gray-800">
                        {match.home_team} vs {match.away_team}
                      </div>
                      <div className="text-xs text-gray-400" suppressHydrationWarning>
                        {formatMatchDateTime(match.match_date, { includeYear: true })}
                      </div>
                    </div>
                    <span className={`text-xs font-semibold px-2 py-1 rounded-full ${getBadgeClass(match.matchCount)}`}>
                      {match.matchCount}/{totalCategories} eşleşme
                    </span>
                  </div>

                  <div className="mt-3 flex flex-wrap gap-2 text-xs">
                    {match.matchedCategoryIds.map((categoryId) => (
                      <span key={categoryId} className="bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                        {CATEGORY_LABELS[categoryId]}
                      </span>
                    ))}
                  </div>

                  <div className="mt-3 text-xs text-gray-500 flex flex-wrap gap-3">
                    <span>Skor: {match.score_ft ?? '-'}</span>
                    {match.score_ht ? <span>İY: {match.score_ht}</span> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
