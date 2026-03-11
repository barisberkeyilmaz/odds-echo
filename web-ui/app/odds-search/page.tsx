import Header from '@/components/Header'
import OddsSearchDashboard from '@/components/OddsSearchDashboard'

export const revalidate = 3600

export default function OddsSearchPage() {
  return (
    <main className="min-h-screen bg-grid pb-20 md:pb-0">
      <Header />
      <div className="max-w-[1600px] mx-auto px-4 md:px-6 lg:px-8 py-6 stagger">

        <section className="bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)] p-5">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-lg font-bold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)]">Oran Arama</div>
              <div className="text-xs text-[var(--text-tertiary)] mt-1">
                Girilen oranlara göre geçmiş maçları bulun ve sonuçları filtreleyin.
              </div>
            </div>
          </div>
        </section>

        <OddsSearchDashboard />
      </div>
    </main>
  )
}
