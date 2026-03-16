'use client'

import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react'
import Link from 'next/link'
import { ODDS_FIELDS, type OddsKey } from '@/lib/match'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type PickData = {
  matchId: number
  matchCode: string
  homeTeam: string
  awayTeam: string
  league: string
  matchDate: string
  outcomeKey: OddsKey
  outcomeLabel: string
  categoryLabel: string
  oddsValue: number
  wilsonLower: number
  hitRate: number
  totalSimilar: number
  hitCount: number
  ev: number
  impliedProb: number
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

const OUTCOME_CATEGORIES = [
  { id: 'MS', label: 'MS 1/X/2', keys: ['ms_1', 'ms_x', 'ms_2'] },
  { id: '2.5 A/Ü', label: '2.5 Alt/Üst', keys: ['au_25_alt', 'au_25_ust'] },
  { id: 'KG', label: 'KG', keys: ['kg_var', 'kg_yok'] },
  { id: 'İY/MS', label: 'İY/MS', keys: ['iyms_11', 'iyms_1x', 'iyms_12', 'iyms_x1', 'iyms_xx', 'iyms_x2', 'iyms_21', 'iyms_2x', 'iyms_22'] },
  { id: 'TG', label: 'Toplam Gol', keys: ['tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus'] },
]

const DEFAULT_CATEGORIES = ['MS', '2.5 A/Ü', 'KG']

function getStoredCategories(): string[] {
  try {
    const stored = localStorage.getItem('dailyPicksCategories')
    if (stored) return JSON.parse(stored)
  } catch { /* ignore */ }
  return DEFAULT_CATEGORIES
}

function formatTime(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

// ---------------------------------------------------------------------------
// Alt Bileşenler
// ---------------------------------------------------------------------------

function OutcomeFilter({ selected, onChange }: { selected: string[]; onChange: (ids: string[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {OUTCOME_CATEGORIES.map((cat) => {
        const isActive = selected.includes(cat.id)
        return (
          <button
            key={cat.id}
            onClick={() => {
              const next = isActive
                ? selected.filter((id) => id !== cat.id)
                : [...selected, cat.id]
              onChange(next)
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors border ${
              isActive
                ? 'border-[var(--accent-blue)] text-[var(--accent-blue)]'
                : 'bg-[var(--bg-secondary)] border-[var(--border-primary)] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
            style={isActive ? { backgroundColor: 'color-mix(in srgb, var(--accent-blue) 10%, transparent)' } : undefined}
          >
            {cat.label}
          </button>
        )
      })}
    </div>
  )
}

function InfoIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block opacity-50 ml-0.5 -mt-px">
      <circle cx="12" cy="12" r="10" />
      <line x1="12" y1="16" x2="12" y2="12" />
      <line x1="12" y1="8" x2="12.01" y2="8" />
    </svg>
  )
}

function HeaderCell({ children, title, align = 'left', className = '' }: { children: ReactNode; title: string; align?: 'left' | 'right'; className?: string }) {
  return (
    <th className={`${align === 'right' ? 'text-right' : 'text-left'} px-3 py-2.5 font-medium ${className}`} title={title}>
      <span className="cursor-help">{children} <InfoIcon /></span>
    </th>
  )
}

function ColumnLegend() {
  return (
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-[10px] text-[var(--text-muted)] px-1">
      <span><strong className="text-[var(--text-tertiary)]">Wilson:</strong> İstatistiksel alt güven sınırı — yüksekse tahmin güvenilir</span>
      <span><strong className="text-[var(--text-tertiary)]">İsabet:</strong> Gerçekleşme oranı / bahisçinin ima ettiği olasılık</span>
      <span><strong className="text-[var(--text-tertiary)]">EV:</strong> Beklenen değer — pozitifse uzun vadede kârlı</span>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ana Dashboard
// ---------------------------------------------------------------------------

export default function DailyPicksDashboard() {
  const [candidates, setCandidates] = useState<PickData[] | null>(null)
  const [loading, setLoading] = useState(true)
  const [selectedCategories, setSelectedCategories] = useState<string[]>(DEFAULT_CATEGORIES)
  const [hydrated, setHydrated] = useState(false)

  // localStorage'dan okuma — sadece client'ta, hydration sonrası
  useEffect(() => {
    setSelectedCategories(getStoredCategories())
    setHydrated(true)
  }, [])

  const dateKey = useMemo(() => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  const outcomeTypes = useMemo(() => {
    const keys: OddsKey[] = []
    for (const cat of OUTCOME_CATEGORIES) {
      if (selectedCategories.includes(cat.id)) {
        keys.push(...(cat.keys as OddsKey[]))
      }
    }
    return keys.length > 0 ? keys : (ODDS_FIELDS as OddsKey[])
  }, [selectedCategories])

  const handleCategoryChange = useCallback((ids: string[]) => {
    setSelectedCategories(ids)
    try { localStorage.setItem('dailyPicksCategories', JSON.stringify(ids)) } catch { /* ignore */ }
  }, [])

  // Fetch — her outcomeTypes değişikliğinde yeniden (hydration sonrası)
  useEffect(() => {
    if (!hydrated) return

    const controller = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      try {
        const params = new URLSearchParams({ date: dateKey })
        if (outcomeTypes.length < ODDS_FIELDS.length) {
          params.set('outcomeTypes', outcomeTypes.join(','))
        }
        const res = await fetch(`/api/matches/daily-picks?${params}`, { signal: controller.signal })
        if (res.ok) {
          const data = await res.json()
          setCandidates(data.candidates)
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
      setLoading(false)
    }

    fetchData()
    return () => controller.abort()
  }, [hydrated, dateKey, outcomeTypes])

  const isEmpty = !loading && (!candidates || candidates.length === 0)

  return (
    <div className="space-y-4">
      {/* Outcome filtresi */}
      <div>
        <h3 className="text-xs font-medium text-[var(--text-muted)] mb-2">Sonuç Tipleri</h3>
        <OutcomeFilter selected={selectedCategories} onChange={handleCategoryChange} />
      </div>

      {/* Sonuç sayısı */}
      {candidates && !loading && (
        <p className="text-xs text-[var(--text-tertiary)]">{candidates.length} öneri</p>
      )}

      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <div className="inline-block w-6 h-6 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--text-muted)]">Öneriler hesaplanıyor...</p>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-tertiary)]">Bugün için yeterli veri bulunamadı.</p>
        </div>
      )}

      {/* Sütun açıklamaları */}
      {!loading && candidates && candidates.length > 0 && (
        <ColumnLegend />
      )}

      {/* Desktop tablo */}
      {!loading && candidates && candidates.length > 0 && (
        <>
          <div className="hidden sm:block overflow-x-auto rounded-lg border border-[var(--border-primary)]">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
                  <th className="text-left px-4 py-2.5 font-medium">Maç</th>
                  <th className="text-left px-3 py-2.5 font-medium">Sonuç</th>
                  <th className="text-right px-3 py-2.5 font-medium">Oran</th>
                  <HeaderCell title="Wilson Score alt güven sınırı — örneklem büyüklüğünü hesaba katan istatistiksel oran. Yüksekse tahmin daha güvenilir.">Wilson</HeaderCell>
                  <HeaderCell title="Gerçekleşme oranı (yeşil/kırmızı) vs bahisçinin orana göre ima ettiği olasılık. Yeşil = bahisçiden yüksek." align="right">İsabet</HeaderCell>
                  <HeaderCell title="Benzer profildeki toplam tarihsel maç sayısı." align="right" className="hidden md:table-cell">Örnek</HeaderCell>
                  <HeaderCell title="Expected Value — beklenen değer. Pozitif (+) ise uzun vadede kârlı bir bahis." align="right" className="hidden md:table-cell">EV</HeaderCell>
                </tr>
              </thead>
              <tbody>
                {candidates.map((pick) => (
                  <tr
                    key={`${pick.matchId}-${pick.outcomeKey}`}
                    className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors"
                  >
                    {/* Maç */}
                    <td className="px-4 py-3">
                      <Link href={`/analysis/${pick.matchId}`} target="_blank" className="group">
                        <div className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors">
                          {pick.homeTeam} - {pick.awayTeam}
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 opacity-0 group-hover:opacity-50 transition-opacity -mt-0.5">
                            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                            <polyline points="15 3 21 3 21 9" />
                            <line x1="10" y1="14" x2="21" y2="3" />
                          </svg>
                        </div>
                        <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                          {pick.league}{pick.matchDate ? ` • ${formatTime(pick.matchDate)}` : ''}
                        </div>
                      </Link>
                    </td>

                    {/* Sonuç */}
                    <td className="px-3 py-3">
                      <span className="inline-block text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                        {pick.outcomeLabel}
                      </span>
                      <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">{pick.categoryLabel}</span>
                    </td>

                    {/* Oran */}
                    <td className="px-3 py-3 text-right font-mono tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                      {pick.oddsValue.toFixed(2)}
                    </td>

                    {/* Wilson */}
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-2 min-w-[120px]">
                        <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                          <div
                            className="h-full rounded-full bg-[var(--accent-win)]"
                            style={{ width: `${Math.min(pick.wilsonLower * 100, 100)}%` }}
                          />
                        </div>
                        <span className="font-mono tabular-nums text-right text-xs text-[var(--text-secondary)] w-12 shrink-0">
                          {(pick.wilsonLower * 100).toFixed(1)}%
                        </span>
                      </div>
                    </td>

                    {/* İsabet */}
                    <td className="px-3 py-3 text-right">
                      <span className={`font-mono tabular-nums text-[11px] ${pick.hitRate >= pick.impliedProb ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}`}>
                        {(pick.hitRate * 100).toFixed(1)}%
                      </span>
                      <span className="text-[10px] text-[var(--text-muted)]"> / </span>
                      <span className="font-mono tabular-nums text-[11px] text-[var(--text-muted)]">
                        {(pick.impliedProb * 100).toFixed(1)}%
                      </span>
                    </td>

                    {/* Örnek */}
                    <td className="px-3 py-3 text-right font-mono text-xs text-[var(--text-muted)] hidden md:table-cell">
                      {pick.totalSimilar}
                    </td>

                    {/* EV */}
                    <td className={`px-4 py-3 text-right font-mono tabular-nums text-xs hidden md:table-cell ${pick.ev >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}`}>
                      {pick.ev >= 0 ? '+' : ''}{pick.ev.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile kartlar */}
          <div className="block sm:hidden divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-primary)] overflow-hidden bg-[var(--bg-secondary)]">
            {candidates.map((pick) => (
              <div key={`${pick.matchId}-${pick.outcomeKey}`} className="px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  {/* Sol: Takım + Lig */}
                  <Link href={`/analysis/${pick.matchId}`} target="_blank" className="min-w-0 flex-1 group">
                    <div className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors truncate">
                      {pick.homeTeam} - {pick.awayTeam}
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1 opacity-30 -mt-0.5">
                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                        <polyline points="15 3 21 3 21 9" />
                        <line x1="10" y1="14" x2="21" y2="3" />
                      </svg>
                    </div>
                    <div className="text-xs text-[var(--text-tertiary)] mt-0.5">
                      {pick.league}{pick.matchDate ? ` • ${formatTime(pick.matchDate)}` : ''}
                    </div>
                  </Link>

                  {/* Sağ: Sonuç + Oran */}
                  <div className="flex items-center gap-2 shrink-0">
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                      {pick.outcomeLabel}
                    </span>
                    <span className="font-mono tabular-nums text-right text-sm font-semibold text-[var(--text-primary)]">
                      {pick.oddsValue.toFixed(2)}
                    </span>
                  </div>
                </div>

                {/* İstatistikler */}
                <div className="flex items-center gap-4 mt-2">
                  {/* Wilson bar */}
                  <div className="flex items-center gap-1.5 flex-1">
                    <span className="text-[10px] text-[var(--text-muted)] w-10 shrink-0">Wilson</span>
                    <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                      <div
                        className="h-full rounded-full bg-[var(--accent-win)]"
                        style={{ width: `${Math.min(pick.wilsonLower * 100, 100)}%` }}
                      />
                    </div>
                    <span className="font-mono tabular-nums text-right text-[10px] text-[var(--text-secondary)] w-10 shrink-0">
                      {(pick.wilsonLower * 100).toFixed(1)}%
                    </span>
                  </div>

                  {/* Hit rate vs implied */}
                  <div className="flex items-center gap-1 shrink-0">
                    <span className={`font-mono tabular-nums text-right text-[10px] ${pick.hitRate >= pick.impliedProb ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}`}>
                      {(pick.hitRate * 100).toFixed(1)}%
                    </span>
                    <span className="text-[10px] text-[var(--text-muted)]">/</span>
                    <span className="font-mono tabular-nums text-right text-[10px] text-[var(--text-muted)]">
                      {(pick.impliedProb * 100).toFixed(1)}%
                    </span>
                  </div>

                  {/* Sample */}
                  <span className="text-[10px] text-[var(--text-muted)] shrink-0">
                    n={pick.totalSimilar}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
