import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'

// Sayfanın dinamik olmasını sağla (Cache kullanma)
export const dynamic = 'force-dynamic'

interface Match {
  id: number
  home_team: string
  away_team: string
  match_date: string
  league: string
  season: string
  ms_1: number | null
  ms_x: number | null
  ms_2: number | null
}

async function getFixtures() {
  const { data, error } = await supabase
    .from('weekly_fixtures')
    .select('*')
    .is('score_ft', null) // Skor yoksa fikstürdür
    .order('match_date', { ascending: true })

  if (error) {
    console.error('Veri çekme hatası:', error)
    return []
  }

  return data as Match[]
}

export default async function Home() {
  const matches = await getFixtures()

  return (
    <main className="min-h-screen bg-gray-50 p-8">
      <div className="max-w-6xl mx-auto">
        <Header totalMatches={matches.length} />

        {matches.length === 0 ? (
          <div className="text-center py-20 bg-white rounded-lg shadow">
            <h2 className="text-xl text-gray-600">Henüz fikstür verisi yok.</h2>
            <p className="text-gray-400 mt-2">Lütfen terminalden `python3 main.py update-fixtures` komutunu çalıştırın.</p>
          </div>
        ) : (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {matches.map((match) => (
              <div key={match.id} className="bg-white rounded-xl shadow-sm hover:shadow-md transition-shadow p-5 border border-gray-100">
                <div className="flex justify-between items-start mb-4">
                  <span className="text-xs font-semibold bg-blue-50 text-blue-600 px-2 py-1 rounded">
                    {match.league}
                  </span>
                  <span className="text-xs text-gray-400" suppressHydrationWarning>
                    {new Date(match.match_date).toLocaleDateString('tr-TR', {
                      day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
                    })}
                  </span>
                </div>

                <div className="flex justify-between items-center mb-6">
                  <div className="text-right flex-1">
                    <div className="font-bold text-gray-800 text-lg">{match.home_team}</div>
                  </div>
                  <div className="px-4 text-gray-300 font-light">vs</div>
                  <div className="text-left flex-1">
                    <div className="font-bold text-gray-800 text-lg">{match.away_team}</div>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <div className="grid grid-cols-3 gap-2 text-center">
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">MS 1</div>
                      <div className="font-mono font-bold text-blue-600">{match.ms_1?.toFixed(2) || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">MS X</div>
                      <div className="font-mono font-bold text-gray-700">{match.ms_x?.toFixed(2) || '-'}</div>
                    </div>
                    <div className="bg-gray-50 rounded p-2">
                      <div className="text-xs text-gray-500 mb-1">MS 2</div>
                      <div className="font-mono font-bold text-red-600">{match.ms_2?.toFixed(2) || '-'}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </main>
  )
}
