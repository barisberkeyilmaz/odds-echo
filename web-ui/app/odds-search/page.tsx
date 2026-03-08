import Header from '@/components/Header'
import OddsSearchDashboard from '@/components/OddsSearchDashboard'

export const revalidate = 3600

export default function OddsSearchPage() {
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
          </div>
        </section>

        <OddsSearchDashboard />
      </div>
    </main>
  )
}
