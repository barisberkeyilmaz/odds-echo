import { supabase, fetchAllRows } from '@/lib/supabaseClient'
import Header from '@/components/Header'
import SurpriseAnalysisDashboard from '@/components/SurpriseAnalysisDashboard'
import FixtureDatePicker from '@/components/FixtureDatePicker'
import {
  buildMatchSelect,
  isValidOdd,
  isValidFixture,
  SCORE_FIELDS,
  type MatchWithScores,
  type Fixture,
} from '@/lib/match'

export const revalidate = 300

const MATCH_SELECT = buildMatchSelect(SCORE_FIELDS)

const SCORE_RE = /\d+\s*-\s*\d+/
const isUnplayed = (record: MatchWithScores) =>
  !record.score_ft || !SCORE_RE.test(record.score_ft)

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

const hasAtLeastTwoPrimaryOdds = (record: Fixture) => {
  let count = 0
  if (isValidOdd(record.ms_1)) count += 1
  if (isValidOdd(record.ms_x)) count += 1
  if (isValidOdd(record.ms_2)) count += 1
  return count >= 2
}

async function getFixturesForDate(dateKey: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(MATCH_SELECT)
    .gte('match_date', `${dateKey}T00:00:00`)
    .lte('match_date', `${dateKey}T23:59:59`)
    .order('match_date', { ascending: true })

  if (error) {
    return { fixtures: [] as Fixture[], errorMessage: error.message }
  }

  const fixtures = ((data ?? []) as unknown as MatchWithScores[])
    .filter((record) => isUnplayed(record) && isValidFixture(record) && hasAtLeastTwoPrimaryOdds(record)) as unknown as Fixture[]

  return { fixtures, errorMessage: null }
}

async function getAvailableDates(): Promise<string[]> {
  let rows: { match_date?: string; score_ft?: string | null }[]
  try {
    rows = await fetchAllRows<{ match_date?: string; score_ft?: string | null }>(() =>
      supabase
        .from('matches')
        .select('match_date, score_ft')
        .gte('match_date', new Date().toISOString().split('T')[0])
        .order('match_date', { ascending: true })
    )
  } catch {
    return []
  }

  const dateSet = new Set<string>()
  rows.forEach((row) => {
    if (row.match_date && (!row.score_ft || !SCORE_RE.test(row.score_ft))) {
      const dateKey = row.match_date.split('T')[0]
      dateSet.add(dateKey)
    }
  })

  return Array.from(dateSet).sort()
}

type SearchParams = {
  date?: string | string[]
}

export default async function SurpriseAnalysisPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const dateParam = Array.isArray(resolvedSearchParams?.date)
    ? resolvedSearchParams?.date[0]
    : resolvedSearchParams?.date
  const todayKey = getDateKey(new Date())
  const selectedDateKey = isValidDateKey(dateParam) ? dateParam! : todayKey

  const [{ fixtures, errorMessage }, availableDateKeys] = await Promise.all([
    getFixturesForDate(selectedDateKey),
    getAvailableDates(),
  ])

  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
            Sürpriz Analiz
          </h2>
          <p className="text-sm text-[var(--text-tertiary)]">
            Yüksek oranlı sürpriz fırsatlarını tarihsel verilerle analiz et.
          </p>
        </div>

        <FixtureDatePicker
          availableDateKeys={availableDateKeys.length > 0 ? availableDateKeys : [todayKey]}
          selectedDateKey={selectedDateKey}
        />

        {errorMessage ? (
          <div className="mb-6 rounded-lg border border-[var(--accent-loss)] bg-[var(--accent-loss-bg)] px-4 py-3 text-sm text-[var(--accent-loss)]">
            Supabase hata mesajı: {errorMessage}
          </div>
        ) : null}

        {fixtures.length === 0 ? (
          <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
            <h3 className="text-lg font-medium text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
              {selectedDateKey === todayKey
                ? 'Bugün için maç bulunamadı'
                : `${formatDateKeyLabel(selectedDateKey)} için maç bulunamadı`}
            </h3>
            <p className="text-sm text-[var(--text-tertiary)]">
              Oranı olan oynanmamış maç bulunmamaktadır.
            </p>
          </div>
        ) : (
          <SurpriseAnalysisDashboard fixtures={fixtures} dateKey={selectedDateKey} />
        )}
      </div>
    </main>
  )
}
