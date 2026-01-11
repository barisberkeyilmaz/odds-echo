import { supabase } from '@/lib/supabaseClient'
import Header from '@/components/Header'

// Dinamik olmasını sağla
// Dinamik olmasını sağla
export const dynamic = 'force-dynamic'
// Force refresh: Premium Card Layout


interface Match {
    id: number
    home_team: string
    away_team: string
    match_date: string
    league: string
    season: string
    score_ht: string
    score_ft: string
    ms_1: number | null
    ms_x: number | null
    ms_2: number | null
    iyms_11: number | null
    iyms_1x: number | null
    iyms_12: number | null
    iyms_x1: number | null
    iyms_xx: number | null
    iyms_x2: number | null
    iyms_21: number | null
    iyms_2x: number | null
    iyms_22: number | null
    ms_status: string
}

async function getSurpriseMatches() {
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

    for (const m of matches) {
        if (!m.score_ht || !m.score_ft) continue

        const htParts = m.score_ht.split('-').map(s => parseInt(s.trim()))
        const ftParts = m.score_ft.split('-').map(s => parseInt(s.trim()))

        if (htParts.length !== 2 || ftParts.length !== 2) continue

        const [htH, htA] = htParts
        const [ftH, ftA] = ftParts

        const is1to2 = (htH > htA) && (ftH < ftA)
        const is2to1 = (htH < htA) && (ftH > ftA)

        if (is1to2 || is2to1) {
            (m as any).surpriseType = is1to2 ? '1/2' : '2/1'
            surpriseMatches.push(m)
        }
    }

    return surpriseMatches
}

import SurpriseTable from '@/components/SurpriseTable'

export default async function SurprisePage() {
    const matches = await getSurpriseMatches()

    return (
        <main className="min-h-screen bg-gray-50 p-6 md:p-12 font-sans">
            <div className="max-w-7xl mx-auto">
                <Header totalMatches={matches.length} />

                {/* Info Box */}
                <div className="mb-8 flex items-center p-4 bg-white border border-gray-200 rounded-xl shadow-sm">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600 mr-4">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                    </div>
                    <div>
                        <h3 className="font-bold text-gray-900">Sürpriz Analizi (Tablo)</h3>
                        <p className="text-sm text-gray-500">
                            <strong>İlk Yarı</strong> ve <strong>Maç Sonucu</strong> kazananının değiştiği (1/2 veya 2/1) karşılaşmalar. Tablo üzerinden filtreleme yapabilirsiniz.
                        </p>
                    </div>
                </div>

                <SurpriseTable initialMatches={matches} />
            </div>
        </main>
    )
}
