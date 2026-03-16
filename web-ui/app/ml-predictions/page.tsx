import Link from 'next/link'
import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'
import FixtureDatePicker from '@/components/FixtureDatePicker'
import MLPredictionsDashboard from '@/components/MLPredictionsDashboard'

export const revalidate = 300

const isValidDateKey = (value?: string) => {
  if (!value) return false
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const date = new Date(`${value}T00:00:00`)
  return !Number.isNaN(date.getTime())
}

const getDateKey = (date: Date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`

/** ml_predictions'daki match_code'lardan tahmin olan günleri bul */
async function getPredictionDateKeys(): Promise<string[]> {
  // 1. ml_predictions'daki unique match_code'ları al
  const { data: predData, error: predError } = await supabase
    .from('ml_predictions')
    .select('match_code')
    .limit(5000)

  if (predError || !predData) return []

  const matchCodes = [...new Set(predData.map((r) => r.match_code as string))]
  if (matchCodes.length === 0) return []

  // 2. Bu match_code'ların tarihlerini al
  const { data: matchData, error: matchError } = await supabase
    .from('matches')
    .select('match_date')
    .in('match_code', matchCodes)

  if (matchError || !matchData) return []

  const dateSet = new Set<string>()
  matchData.forEach((row) => {
    if (row.match_date) {
      const key = (row.match_date as string).split('T')[0]
      if (key) dateSet.add(key)
    }
  })

  return Array.from(dateSet).sort()
}

/** Bugüne en yakın tahminli tarihi bul */
function findClosestDate(dateKeys: string[], todayKey: string): string {
  if (dateKeys.length === 0) return todayKey
  // Bugün veya sonrasında en yakın tarih
  const future = dateKeys.find((d) => d >= todayKey)
  if (future) return future
  // Yoksa en son geçmiş tarih
  return dateKeys[dateKeys.length - 1]
}

type SearchParams = {
  date?: string | string[]
}

export default async function MLPredictionsPage({
  searchParams,
}: {
  searchParams?: SearchParams | Promise<SearchParams>
}) {
  const resolvedSearchParams = await searchParams
  const dateParam = Array.isArray(resolvedSearchParams?.date)
    ? resolvedSearchParams?.date[0]
    : resolvedSearchParams?.date
  const todayKey = getDateKey(new Date())

  const availableDateKeys = await getPredictionDateKeys()

  const selectedDateKey = isValidDateKey(dateParam)
    ? dateParam!
    : findClosestDate(availableDateKeys, todayKey)

  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
            ML Tahminleri
          </h2>
          <p className="text-sm text-[var(--text-tertiary)]">
            LightGBM modeli 5 bahis marketini analiz eder.
            Yeşil satırlarda bahisçinin oranından daha yüksek olasılık tespit edilmiştir.
          </p>
          <Link
            href="/ml-predictions/backtest"
            className="inline-flex items-center gap-1 mt-2 text-xs font-medium text-[var(--accent-blue)] hover:opacity-80 transition-opacity"
          >
            Backtest Sonuçları &rarr;
          </Link>
        </div>

        <FixtureDatePicker
          availableDateKeys={availableDateKeys.length > 0 ? availableDateKeys : [todayKey]}
          selectedDateKey={selectedDateKey}
        />

        <MLPredictionsDashboard dateKey={selectedDateKey} />
      </div>
    </main>
  )
}
