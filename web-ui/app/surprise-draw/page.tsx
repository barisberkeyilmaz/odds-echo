import Header from '@/components/Header'
import SurpriseDrawDashboard from '@/components/SurpriseDrawDashboard'
import { supabase } from '@/lib/supabaseClient'

export const dynamic = 'force-dynamic'

interface Match {
    id: number
    home_team: string
    away_team: string
    match_date: string
    league: string
    season: string
    score_ht: string
    score_ft: string
    iyms_1x: number | null
    iyms_2x: number | null
    surpriseType?: '1/0' | '2/0'
}

async function getSurpriseDrawMatches() {
    const { data, error } = await supabase
        .from('matches')
        .select('*')
        .eq('status', 'MS')
        .order('match_date', { ascending: false })

    if (error) {
        console.error('Veri çekme hatası:', error)
        return []
    }

    const matches = data as Match[]
    const surpriseMatches: Match[] = []

    for (const match of matches) {
        if (!match.score_ht || !match.score_ft) continue

        const htParts = match.score_ht.split('-').map(s => parseInt(s.trim()))
        const ftParts = match.score_ft.split('-').map(s => parseInt(s.trim()))

        if (htParts.length !== 2 || ftParts.length !== 2) continue

        const [htH, htA] = htParts
        const [ftH, ftA] = ftParts

        if (Number.isNaN(htH) || Number.isNaN(htA) || Number.isNaN(ftH) || Number.isNaN(ftA)) continue

        const is1to0 = htH > htA && ftH === ftA
        const is2to0 = htH < htA && ftH === ftA

        if (is1to0 || is2to0) {
            match.surpriseType = is1to0 ? '1/0' : '2/0'
            surpriseMatches.push(match)
        }
    }

    return surpriseMatches
}

export default async function SurpriseDrawPage() {
    const matches = await getSurpriseDrawMatches()

    return (
        <main className="min-h-screen bg-gray-50 p-3 md:p-5 font-sans">
            <div className="max-w-[1400px] mx-auto">
                <Header totalMatches={matches.length} />

                <div className="mb-8 flex items-center p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div className="p-2 bg-sky-100 rounded-lg text-sky-600 mr-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Sürpriz Analizi (1/0 & 2/0)</h3>
                        <p className="text-sm text-gray-500">
                            <strong>İlk Yarı</strong> lideri olan takımın, maç sonunda <strong>beraberliğe</strong> düşürdüğü (1/0 veya 2/0) karşılaşmalar.
                            Filtrelere göre grafikler ve tablo güncellenir.
                        </p>
                    </div>
                </div>

                <SurpriseDrawDashboard initialMatches={matches} />
            </div>
        </main>
    )
}
