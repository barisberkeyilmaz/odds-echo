import Link from 'next/link'
import Header from '@/components/Header'
import BacktestDashboard from '@/components/BacktestDashboard'

export default function BacktestPage() {
  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">
        <div className="mb-6 flex items-center gap-3">
          <Link
            href="/daily-picks"
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Öneriler
          </Link>
          <div>
            <h2 className="text-xl font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-0.5">
              Backtest Sonuçları
            </h2>
            <p className="text-sm text-[var(--text-tertiary)]">
              Günün Önerileri algoritmasının geçmiş performans analizi.
            </p>
          </div>
        </div>
        <BacktestDashboard />
      </div>
    </main>
  )
}
