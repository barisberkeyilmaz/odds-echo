import Link from 'next/link'
import Header from '@/components/Header'
import DailyPicksDashboard from '@/components/DailyPicksDashboard'

export default function DailyPicksPage() {
  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <div className="mb-6">
          <h2 className="text-xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-2">
            Günün Önerileri
          </h2>
          <div className="flex items-center gap-3">
            <p className="text-sm text-[var(--text-tertiary)]">
              Wilson Score algoritmasıyla sıralanan günlük maç önerileri.
            </p>
            <Link href="/daily-picks/backtest" className="text-xs text-[var(--accent-blue)] hover:underline shrink-0">
              Backtest Sonuçları →
            </Link>
          </div>
        </div>

        <DailyPicksDashboard />
      </div>
    </main>
  )
}
