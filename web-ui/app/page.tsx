import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'
import FixtureDatePicker from '@/components/FixtureDatePicker'
import FixtureTable from '@/components/FixtureTable'
import {
  buildMatchSelect,
  isValidOdd,
  isValidFixture,
  SCORE_FIELDS,
  type MatchWithScores,
} from '@/lib/match'

export const revalidate = 300

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

async function getFixturesForDate(dateKey: string) {
  const { data, error } = await supabase
    .from('matches')
    .select(FIXTURE_SELECT)
    .gte('match_date', `${dateKey}T00:00:00`)
    .lte('match_date', `${dateKey}T23:59:59`)
    .order('match_date', { ascending: true })

  if (error) {
    console.error('Veri çekme hatası:', error)
    return { fixtures: [] as MatchWithScores[], errorMessage: error.message }
  }

  const fixtures = ((data ?? []) as unknown as MatchWithScores[]).filter(
    (record) => isValidFixture(record) && hasAtLeastTwoPrimaryOdds(record)
  )

  return { fixtures, errorMessage: null }
}

async function getAvailableDateKeys() {
  const { data, error } = await supabase
    .from('matches')
    .select('match_date')
    .not('match_date', 'is', null)
    .order('match_date', { ascending: true })
    .limit(5000)

  if (error || !data) return []

  const dateSet = new Set<string>()
  data.forEach((row) => {
    if (row.match_date) {
      const key = row.match_date.split('T')[0]
      if (key) dateSet.add(key)
    }
  })

  return Array.from(dateSet).sort()
}

type FixtureSearchParams = {
  date?: string | string[]
}

export default async function Home({
  searchParams,
}: {
  searchParams?: FixtureSearchParams | Promise<FixtureSearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const dateParam = Array.isArray(resolvedSearchParams?.date)
    ? resolvedSearchParams?.date[0]
    : resolvedSearchParams?.date
  const todayKey = getDateKey(new Date())
  const selectedDateKey = isValidDateKey(dateParam) ? dateParam! : todayKey

  const [{ fixtures, errorMessage }, availableDateKeys] = await Promise.all([
    getFixturesForDate(selectedDateKey),
    getAvailableDateKeys(),
  ])

  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header totalMatches={fixtures.length} />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <p className="text-xs text-[var(--text-muted)] mb-6">
          Eksik tarih veya takım bilgisi olan maçlar listede gösterilmez. Eksik oranlar '-' olarak görünür.
        </p>

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
            <h2 className="text-lg text-[var(--text-secondary)]">Seçili tarihte maç bulunamadı.</h2>
            <p className="text-[var(--text-muted)] mt-2">
              {selectedDateKey === todayKey
                ? 'Veritabanımızda bugün için maç bulunmamaktadır.'
                : `Veritabanımızda bu tarih için maç bulunmamaktadır: ${formatDateKeyLabel(selectedDateKey)}`}
            </p>
          </div>
        ) : (
          <FixtureTable matches={fixtures} />
        )}
      </div>
    </main>
  )
}
