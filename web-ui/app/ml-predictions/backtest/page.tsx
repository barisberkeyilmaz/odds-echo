import Link from 'next/link'
import Header from '@/components/Header'
import MLBacktestDashboard from '@/components/MLBacktestDashboard'

export const revalidate = 300

export default function MLBacktestPage() {
  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <div className="mb-6">
          <Link
            href="/ml-predictions"
            className="inline-flex items-center gap-1 text-xs text-[var(--accent-blue)] hover:opacity-80 transition-opacity mb-3"
          >
            &larr; ML Tahminleri
          </Link>
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
            ML Backtest Sonuçları
          </h2>
          <p className="text-sm text-[var(--text-tertiary)]">
            ML modelinin geçmiş maçlardaki tahmin isabeti, kalibrasyon kalitesi ve value bet ROI analizi.
          </p>
        </div>

        <MLBacktestDashboard />
      </div>
    </main>
  )
}
