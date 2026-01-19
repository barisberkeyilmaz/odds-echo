import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'
import FixtureDatePicker from '@/components/FixtureDatePicker'
import FixtureTable from '@/components/FixtureTable'
import {
  buildMatchSelect,
  groupMatchesByLocalDate,
  isValidOdd,
  isValidFixture,
  SCORE_FIELDS,
  type MatchWithScores,
} from '@/lib/match'

// Sayfanın dinamik olmasını sağla (Cache kullanma)
export const dynamic = 'force-dynamic'

const FIXTURE_SELECT = buildMatchSelect(SCORE_FIELDS)
const isValidDateKey = (value?: string) => {
  if (!value) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

const getDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

const formatDateKeyLabel = (dateKey: string) =>
  new Date(`${dateKey}T00:00:00`).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

const hasAtLeastTwoPrimaryOdds = (record: MatchWithScores) => {
  let count = 0
  if (isValidOdd(record.ms_1)) count += 1
  if (isValidOdd(record.ms_x)) count += 1
  if (isValidOdd(record.ms_2)) count += 1
  return count >= 2
}

type FixtureQueryResult = {
  fixtures: MatchWithScores[]
  errorMessage: string | null
}

async function getFixtures(): Promise<FixtureQueryResult> {
  const PAGE_SIZE = 1000
  let from = 0
  let totalCount: number | null = null
  const allMatches: MatchWithScores[] = []

  while (true) {
    const { data, error, count } = await supabase
      .from('matches')
      .select(FIXTURE_SELECT, { count: from === 0 ? 'exact' : undefined })
      .order('match_date', { ascending: true })
      .range(from, from + PAGE_SIZE - 1)

    if (error) {
      console.error('Veri çekme hatası:', error)
      return { fixtures: [], errorMessage: error.message }
    }

    if (totalCount === null && typeof count === 'number') {
      totalCount = count
    }

    const page = (data ?? []) as MatchWithScores[]
    allMatches.push(...page)

    if (page.length < PAGE_SIZE) {
      break
    }

    from += PAGE_SIZE

    if (totalCount !== null && from >= totalCount) {
      break
    }
  }

  return {
    fixtures: allMatches.filter((record) => isValidFixture(record) && hasAtLeastTwoPrimaryOdds(record)),
    errorMessage: null,
  }
}

type FixtureSearchParams = {
  date?: string | string[]
}

export default async function Home({
  searchParams,
}: {
  searchParams?: FixtureSearchParams | Promise<FixtureSearchParams>
}) {
  const { fixtures, errorMessage } = await getFixtures()
  const groupedMatches = groupMatchesByLocalDate(fixtures)
  const todayKey = getDateKey(new Date())
  const availableDateKeys = groupedMatches.map((group) => group.dateKey)
  const resolvedSearchParams = await searchParams
  const dateParam = Array.isArray(resolvedSearchParams?.date)
    ? resolvedSearchParams?.date[0]
    : resolvedSearchParams?.date
  const selectedDateKey = isValidDateKey(dateParam) ? dateParam : todayKey
  const visibleGroups = groupedMatches.filter((group) => group.dateKey === selectedDateKey)
  const matchesForDate = visibleGroups.flatMap((group) => group.matches)
  const visibleMatchCount = matchesForDate.length

  return (
    <main className="min-h-screen bg-gray-50 p-3 md:p-5">
      <div className="max-w-[1400px] mx-auto">
        <Header totalMatches={visibleMatchCount} />
        <p className="text-xs text-gray-400 mb-6">
          Eksik tarih veya takım bilgisi olan maçlar listede gösterilmez. Eksik oranlar '-' olarak görünür.
        </p>

        <FixtureDatePicker
          availableDateKeys={availableDateKeys}
          selectedDateKey={selectedDateKey}
        />

        {errorMessage ? (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            Supabase hata mesajı: {errorMessage}
          </div>
        ) : null}

        {fixtures.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-lg shadow">
            <h2 className="text-xl text-gray-600">Henüz fikstür verisi yok.</h2>
            <p className="text-gray-400 mt-2">Lütfen terminalden `python3 main.py update-fixtures` komutunu çalıştırın.</p>
          </div>
        ) : (
          <>
            {matchesForDate.length === 0 ? (
              <div className="text-center py-16 bg-white rounded-lg shadow border border-gray-100">
                <h2 className="text-lg text-gray-600">Seçili tarihte maç bulunamadı.</h2>
                <p className="text-gray-400 mt-2">
                  {selectedDateKey === todayKey
                    ? 'Veritabanımızda bugün için maç bulunmamaktadır.'
                    : `Veritabanımızda bu tarih için maç bulunmamaktadır: ${formatDateKeyLabel(selectedDateKey)}`}
                </p>
              </div>
            ) : (
              <FixtureTable matches={matchesForDate} />
            )}
          </>
        )}
      </div>
    </main>
  )
}
