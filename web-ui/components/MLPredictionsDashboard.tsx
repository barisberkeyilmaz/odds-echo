'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type ConfidentPick = {
  market: string
  outcome: string
  confidence: number
  threshold: number
  confidenceLevel: string
  impliedProb: number | null
}

type MarketPrediction = {
  market: string
  probs: Record<string, number>
  predicted: string
  confidence: number
  confidentPicks: Array<{
    outcome: string
    confidence: number
    threshold: number
    confidenceLevel: string
    impliedProb: number | null
  }> | null
}

type MatchData = {
  matchId: number
  matchCode: string
  homeTeam: string
  awayTeam: string
  league: string
  matchDate: string
  isPlayed: boolean
  markets: MarketPrediction[]
  confidentPicks: ConfidentPick[]
}

type ApiResponse = {
  date: string
  modelVersion: string | null
  matches: MatchData[]
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const MARKET_LABELS: Record<string, string> = {
  ms: 'MS',
  kg: 'KG',
  au25: 'AU 2.5',
  tg: 'TG',
  iyms: 'IY/MS',
}

const MS_LABELS: Record<string, string> = {
  '1': 'Ev Sahibi',
  'X': 'Beraberlik',
  '2': 'Deplasman',
}

const SECONDARY_LABELS: Record<string, Record<string, string>> = {
  kg: { Yok: 'Yok', Var: 'Var' },
  au25: { Alt: 'Alt', Ust: 'Ust' },
  tg: { '0-1': '0-1', '2-3': '2-3', '4-5': '4-5', '6+': '6+' },
  iyms: { '1/1': '1/1', '1/X': '1/X', '1/2': '1/2', 'X/1': 'X/1', 'X/X': 'X/X', 'X/2': 'X/2', '2/1': '2/1', '2/X': '2/X', '2/2': '2/2' },
}

const CONFIDENCE_LEVEL_LABELS: Record<string, { text: string; color: string; bgColor: string }> = {
  cok_emin: { text: 'COK EMIN', color: 'var(--accent-win)', bgColor: 'var(--accent-win-bg)' },
  emin: { text: 'EMIN', color: 'var(--accent-blue)', bgColor: 'color-mix(in srgb, var(--accent-blue) 15%, transparent)' },
  olasi: { text: 'OLASI', color: 'var(--accent-draw)', bgColor: 'color-mix(in srgb, var(--accent-draw) 15%, transparent)' },
}

function getOutcomeLabel(market: string, outcome: string): string {
  if (market === 'ms') return MS_LABELS[outcome] ?? outcome
  return SECONDARY_LABELS[market]?.[outcome] ?? outcome
}

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

type SortKey = 'confidence' | 'edge' | 'time'

function formatTime(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })
  } catch {
    return ''
  }
}

/** Bir confident pick'in edge'ini hesapla (ML olasılık - oran ima olasılığı) */
function getEdge(cp: ConfidentPick): number {
  if (cp.impliedProb == null || cp.impliedProb <= 0) return 0
  return cp.confidence - cp.impliedProb
}

/** Maçın en yüksek edge'ini bul */
function getBestEdge(match: MatchData): number {
  if (match.confidentPicks.length === 0) return 0
  return Math.max(...match.confidentPicks.map(getEdge))
}

// ---------------------------------------------------------------------------
// Alt Bilesenler
// ---------------------------------------------------------------------------

/** MS olasilik barlari */
function MSBars({ probs, confidentPicks }: { probs: Record<string, number>; confidentPicks: Array<{ outcome: string }> | null }) {
  const order = ['1', 'X', '2']
  const confidentOutcomes = new Set((confidentPicks ?? []).map((cp) => cp.outcome))
  const maxProb = Math.max(...Object.values(probs))

  return (
    <div className="space-y-1.5">
      {order.map((key) => {
        const prob = probs[key] ?? 0
        const pct = Math.round(prob * 100)
        const isMax = prob === maxProb
        const isConfident = confidentOutcomes.has(key)
        const barColor = isConfident
          ? 'var(--accent-win)'
          : isMax
            ? 'var(--accent-blue)'
            : 'var(--text-muted)'

        return (
          <div key={key} className="flex items-center gap-2">
            <span className="text-xs text-[var(--text-tertiary)] w-16 shrink-0">{MS_LABELS[key] ?? key}</span>
            <div className="flex-1 h-2 rounded-full bg-[var(--bg-primary)] overflow-hidden">
              <div
                className="h-full rounded-full transition-all"
                style={{ width: `${pct}%`, backgroundColor: barColor, opacity: isMax || isConfident ? 1 : 0.25 }}
              />
            </div>
            <span className={`font-mono tabular-nums text-xs w-10 text-right shrink-0 ${
              isConfident ? 'text-[var(--accent-win)] font-bold' : isMax ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'
            }`}>
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Diger marketler — tek satirda en olasi sonuc */
function SecondaryMarketsSummary({ markets, confidentPicks }: { markets: MarketPrediction[]; confidentPicks: ConfidentPick[] }) {
  const secondary = markets.filter((m) => m.market !== 'ms')
  if (secondary.length === 0) return null

  const confidentMap = new Set(confidentPicks.map((cp) => `${cp.market}:${cp.outcome}`))

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {secondary.map((m) => {
        const entries = Object.entries(m.probs).sort((a, b) => b[1] - a[1])
        if (entries.length === 0) return null
        const [bestOutcome, bestProb] = entries[0]
        const pct = Math.round(bestProb * 100)
        const isConfident = confidentMap.has(`${m.market}:${bestOutcome}`)

        return (
          <span key={m.market} className="flex items-center gap-1 text-xs">
            <span className="text-[var(--text-muted)]">{MARKET_LABELS[m.market] ?? m.market}</span>
            <span className={`font-medium ${isConfident ? 'text-[var(--accent-win)]' : 'text-[var(--text-secondary)]'}`}>
              {getOutcomeLabel(m.market, bestOutcome)}
            </span>
            <span className={`font-mono tabular-nums ${isConfident ? 'text-[var(--accent-win)]' : 'text-[var(--text-muted)]'}`}>
              %{pct}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** Mac karti */
function MatchCard({ match }: { match: MatchData }) {
  const hasConfident = match.confidentPicks.length > 0
  const msMarket = match.markets.find((m) => m.market === 'ms')
  const msConfidentPicks = msMarket?.confidentPicks ?? null

  // En yuksek seviye badge
  const bestLevel = hasConfident
    ? (match.confidentPicks.find((cp) => cp.confidenceLevel === 'cok_emin')?.confidenceLevel
      ?? match.confidentPicks.find((cp) => cp.confidenceLevel === 'emin')?.confidenceLevel
      ?? 'olasi')
    : null

  const badgeStyle = bestLevel ? CONFIDENCE_LEVEL_LABELS[bestLevel] : null

  return (
    <Link
      href={`/analysis/${match.matchId}`}
      target="_blank"
      className="block group"
    >
      <div className={`bg-[var(--bg-secondary)] border rounded-lg p-4 transition-all group-hover:border-[var(--accent-blue)] group-hover:shadow-[var(--glow-blue)] ${
        hasConfident
          ? 'border-[color-mix(in_srgb,var(--accent-win)_30%,var(--border-primary))]'
          : 'border-[var(--border-primary)]'
      }`}>
        {/* Baslik */}
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors">
              {match.homeTeam} - {match.awayTeam}
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="inline-block ml-1.5 opacity-0 group-hover:opacity-50 transition-opacity -mt-0.5">
                <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                <polyline points="15 3 21 3 21 9" />
                <line x1="10" y1="14" x2="21" y2="3" />
              </svg>
            </p>
            <p className="text-xs text-[var(--text-tertiary)] mt-0.5">{match.league}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {badgeStyle && (
              <span
                className="text-[10px] px-2 py-0.5 rounded-full font-semibold border"
                style={{
                  color: badgeStyle.color,
                  backgroundColor: badgeStyle.bgColor,
                  borderColor: `color-mix(in srgb, ${badgeStyle.color} 20%, transparent)`,
                }}
              >
                {badgeStyle.text}
              </span>
            )}
            <span className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
              {formatTime(match.matchDate)}
            </span>
          </div>
        </div>

        {/* MS olasilik barlari */}
        {msMarket && (
          <MSBars probs={msMarket.probs} confidentPicks={msConfidentPicks} />
        )}

        {/* Diger marketler ozet */}
        <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
          <SecondaryMarketsSummary markets={match.markets} confidentPicks={match.confidentPicks} />
        </div>

        {/* Emin tahmin satirlari */}
        {hasConfident && (
          <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1">
            {match.confidentPicks.map((cp, i) => {
              const levelInfo = CONFIDENCE_LEVEL_LABELS[cp.confidenceLevel] ?? CONFIDENCE_LEVEL_LABELS.olasi
              const edge = getEdge(cp)
              const edgePct = Math.round(edge * 100)
              return (
                <div key={`${cp.market}-${cp.outcome}-${i}`} className="flex items-center gap-2 text-[11px]">
                  <span className="font-semibold" style={{ color: levelInfo.color }}>
                    {levelInfo.text}
                  </span>
                  <span className="text-[var(--text-secondary)]">
                    {MARKET_LABELS[cp.market]} {getOutcomeLabel(cp.market, cp.outcome)}
                  </span>
                  <span className="font-mono tabular-nums font-semibold" style={{ color: levelInfo.color }}>
                    %{Math.round(cp.confidence * 100)}
                  </span>
                  {edge > 0 && (
                    <span className={`font-mono tabular-nums text-[10px] px-1.5 py-0.5 rounded font-bold ${
                      edgePct >= 15 ? 'bg-[var(--accent-win-bg)] text-[var(--accent-win)]'
                        : edgePct >= 5 ? 'bg-[var(--accent-draw-bg)] text-[var(--accent-draw)]'
                        : 'text-[var(--text-muted)]'
                    }`}>
                      +{edgePct}% edge
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Ana Dashboard
// ---------------------------------------------------------------------------

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'confidence', label: 'Guven' },
  { value: 'edge', label: 'Edge' },
  { value: 'time', label: 'Saat' },
]

export default function MLPredictionsDashboard({ dateKey }: { dateKey: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [sortBy, setSortBy] = useState<SortKey>('edge')

  useEffect(() => {
    const controller = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      try {
        const res = await fetch(`/api/matches/ml-predictions?date=${dateKey}`, { signal: controller.signal })
        if (res.ok) {
          setData(await res.json())
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
      setLoading(false)
    }

    fetchData()
    return () => controller.abort()
  }, [dateKey])

  const stats = useMemo(() => {
    if (!data || data.matches.length === 0) return null
    const confidentCount = data.matches.reduce((sum, m) => sum + m.confidentPicks.length, 0)
    const allConfs = data.matches.flatMap((m) => m.confidentPicks.map((cp) => cp.confidence))
    const maxConf = allConfs.length > 0 ? Math.max(...allConfs) : 0
    const allEdges = data.matches.map(getBestEdge)
    const maxEdge = allEdges.length > 0 ? Math.max(...allEdges) : 0
    return { totalMatches: data.matches.length, confidentCount, maxConf, maxEdge }
  }, [data])

  const sortedMatches = useMemo(() => {
    if (!data) return []
    const matches = [...data.matches]
    if (sortBy === 'edge') {
      matches.sort((a, b) => {
        const edgeDiff = getBestEdge(b) - getBestEdge(a)
        if (edgeDiff !== 0) return edgeDiff
        return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
      })
    } else if (sortBy === 'confidence') {
      matches.sort((a, b) => {
        const aConf = a.confidentPicks.length > 0 ? a.confidentPicks[0].confidence : 0
        const bConf = b.confidentPicks.length > 0 ? b.confidentPicks[0].confidence : 0
        if (aConf !== bConf) return bConf - aConf
        return new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime()
      })
    } else {
      matches.sort((a, b) => new Date(a.matchDate).getTime() - new Date(b.matchDate).getTime())
    }
    return matches
  }, [data, sortBy])

  const isEmpty = !loading && (!data || data.matches.length === 0)

  return (
    <div className="space-y-4 mt-4">
      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <div className="inline-block w-6 h-6 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--text-muted)]">ML tahminleri yukleniyor...</p>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-tertiary)]">Bu tarih icin ML tahmini bulunamadi.</p>
        </div>
      )}

      {/* Data */}
      {!loading && data && stats && (
        <>
          {/* Ozet kartlar */}
          <div className="grid grid-cols-4 gap-3">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Mac</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[var(--text-primary)]">{stats.totalMatches}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Emin Tahmin</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${stats.confidentCount > 0 ? 'text-[var(--accent-win)]' : 'text-[var(--text-primary)]'}`}>{stats.confidentCount}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">En Yuksek Guven</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${stats.maxConf > 0 ? 'text-[var(--accent-win)]' : 'text-[var(--text-primary)]'}`}>
                {stats.maxConf > 0 ? `%${Math.round(stats.maxConf * 100)}` : '\u2014'}
              </p>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">En Yuksek Edge</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${stats.maxEdge > 0.05 ? 'text-[var(--accent-win)]' : 'text-[var(--text-primary)]'}`}>
                {stats.maxEdge > 0 ? `+%${Math.round(stats.maxEdge * 100)}` : '\u2014'}
              </p>
            </div>
          </div>

          {/* Siralama + Model versiyonu */}
          <div className="flex items-center justify-between">
            {data.modelVersion && (
              <p className="text-[10px] text-[var(--text-muted)]">
                Model: <span className="font-mono">{data.modelVersion}</span>
              </p>
            )}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-[var(--text-muted)]">Sirala:</span>
              {SORT_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setSortBy(opt.value)}
                  className={`text-[10px] px-2 py-1 rounded-md font-medium transition-colors ${
                    sortBy === opt.value
                      ? 'bg-[var(--accent-blue)] text-white'
                      : 'text-[var(--text-tertiary)] hover:bg-[var(--bg-tertiary)] hover:text-[var(--text-primary)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {/* Mac kartlari */}
          <div className="space-y-3">
            {sortedMatches.map((match) => (
              <MatchCard key={match.matchCode} match={match} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
