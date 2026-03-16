'use client'

import { useState, useEffect, useMemo } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type ValueBet = {
  market: string
  outcome: string
  modelProb: number
  impliedProb: number
  edge: number
}

type MarketPrediction = {
  market: string
  probs: Record<string, number>
  predicted: string
  valueBets: Array<{ outcome: string; modelProb: number; impliedProb: number; edge: number }> | null
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
  valueBets: ValueBet[]
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
  iy: 'İY',
}

const MS_LABELS: Record<string, string> = {
  '1': 'Ev Sahibi',
  'X': 'Beraberlik',
  '2': 'Deplasman',
}

const SECONDARY_LABELS: Record<string, Record<string, string>> = {
  kg: { var: 'Var', yok: 'Yok' },
  au25: { alt: 'Alt', ust: 'Üst' },
  tg: { '0-1': '0-1', '2-3': '2-3', '4-5': '4-5', '6+': '6+' },
  iy: { '1': 'Ev', 'X': 'X', '2': 'Dep' },
}

function getOutcomeLabel(market: string, outcome: string): string {
  if (market === 'ms') return MS_LABELS[outcome] ?? outcome
  return SECONDARY_LABELS[market]?.[outcome] ?? outcome
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

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

/** MS olasılık barları — büyük ve net */
function MSBars({ probs, valueBets }: { probs: Record<string, number>; valueBets: Array<{ outcome: string }> | null }) {
  const order = ['1', 'X', '2']
  const valueOutcomes = new Set((valueBets ?? []).map((v) => v.outcome))
  const maxProb = Math.max(...Object.values(probs))

  return (
    <div className="space-y-1.5">
      {order.map((key) => {
        const prob = probs[key] ?? 0
        const pct = Math.round(prob * 100)
        const isMax = prob === maxProb
        const isValue = valueOutcomes.has(key)
        const barColor = isValue
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
                style={{ width: `${pct}%`, backgroundColor: barColor, opacity: isMax || isValue ? 1 : 0.25 }}
              />
            </div>
            <span className={`font-mono tabular-nums text-xs w-10 text-right shrink-0 ${
              isValue ? 'text-[var(--accent-win)] font-bold' : isMax ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'
            }`}>
              {pct}%
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Diğer marketler — tek satırda en olası sonuç */
function SecondaryMarketsSummary({ markets, valueBets }: { markets: MarketPrediction[]; valueBets: ValueBet[] }) {
  const secondary = markets.filter((m) => m.market !== 'ms')
  if (secondary.length === 0) return null

  const valueMap = new Map<string, ValueBet>()
  for (const vb of valueBets) {
    valueMap.set(`${vb.market}:${vb.outcome}`, vb)
  }

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1">
      {secondary.map((m) => {
        // En olası sonuç
        const entries = Object.entries(m.probs).sort((a, b) => b[1] - a[1])
        if (entries.length === 0) return null
        const [bestOutcome, bestProb] = entries[0]
        const pct = Math.round(bestProb * 100)
        const vbKey = `${m.market}:${bestOutcome}`
        const isValue = valueMap.has(vbKey)

        return (
          <span key={m.market} className="flex items-center gap-1 text-xs">
            <span className="text-[var(--text-muted)]">{MARKET_LABELS[m.market] ?? m.market}</span>
            <span className={`font-medium ${isValue ? 'text-[var(--accent-win)]' : 'text-[var(--text-secondary)]'}`}>
              {getOutcomeLabel(m.market, bestOutcome)}
            </span>
            <span className={`font-mono tabular-nums ${isValue ? 'text-[var(--accent-win)]' : 'text-[var(--text-muted)]'}`}>
              %{pct}
            </span>
          </span>
        )
      })}
    </div>
  )
}

/** Maç kartı */
function MatchCard({ match }: { match: MatchData }) {
  const hasValue = match.valueBets.length > 0
  const msMarket = match.markets.find((m) => m.market === 'ms')
  const msValueBets = msMarket?.valueBets ?? null

  return (
    <Link
      href={`/analysis/${match.matchId}`}
      target="_blank"
      className="block group"
    >
      <div className={`bg-[var(--bg-secondary)] border rounded-lg p-4 transition-all group-hover:border-[var(--accent-blue)] group-hover:shadow-[var(--glow-blue)] ${
        hasValue
          ? 'border-[color-mix(in_srgb,var(--accent-win)_30%,var(--border-primary))]'
          : 'border-[var(--border-primary)]'
      }`}>
        {/* Başlık */}
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
            {hasValue && (
              <span className="text-[10px] px-2 py-0.5 rounded-full font-semibold bg-[var(--accent-win-bg)] text-[var(--accent-win)] border border-[color-mix(in_srgb,var(--accent-win)_20%,transparent)]">
                VALUE
              </span>
            )}
            <span className="text-xs font-mono tabular-nums text-[var(--text-muted)]">
              {formatTime(match.matchDate)}
            </span>
          </div>
        </div>

        {/* MS olasılık barları */}
        {msMarket && (
          <MSBars probs={msMarket.probs} valueBets={msValueBets} />
        )}

        {/* Diğer marketler özet */}
        <div className="mt-3 pt-2 border-t border-[var(--border-subtle)]">
          <SecondaryMarketsSummary markets={match.markets} valueBets={match.valueBets} />
        </div>

        {/* Value bet satırları */}
        {hasValue && (
          <div className="mt-2 pt-2 border-t border-[var(--border-subtle)] flex flex-col gap-1">
            {match.valueBets.map((vb, i) => (
              <div key={`${vb.market}-${vb.outcome}-${i}`} className="flex items-center gap-2 text-[11px]">
                <span className="text-[var(--accent-win)] font-semibold">VALUE</span>
                <span className="text-[var(--text-secondary)]">
                  {MARKET_LABELS[vb.market]} {getOutcomeLabel(vb.market, vb.outcome)}
                </span>
                <span className="font-mono tabular-nums text-[var(--text-muted)]">
                  %{Math.round(vb.modelProb * 100)} vs %{Math.round(vb.impliedProb * 100)}
                </span>
                <span className="font-mono tabular-nums text-[var(--accent-win)] font-semibold">
                  +{(vb.edge * 100).toFixed(1)}%
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Link>
  )
}

// ---------------------------------------------------------------------------
// Ana Dashboard
// ---------------------------------------------------------------------------

export default function MLPredictionsDashboard({ dateKey }: { dateKey: string }) {
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(true)

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
    const valueBetCount = data.matches.reduce((sum, m) => sum + m.valueBets.length, 0)
    const allEdges = data.matches.flatMap((m) => m.valueBets.map((vb) => vb.edge))
    const maxEdge = allEdges.length > 0 ? Math.max(...allEdges) : 0
    return { totalMatches: data.matches.length, valueBetCount, maxEdge }
  }, [data])

  const isEmpty = !loading && (!data || data.matches.length === 0)

  return (
    <div className="space-y-4 mt-4">
      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <div className="inline-block w-6 h-6 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--text-muted)]">ML tahminleri yükleniyor...</p>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-tertiary)]">Bu tarih için ML tahmini bulunamadı.</p>
        </div>
      )}

      {/* Data */}
      {!loading && data && stats && (
        <>
          {/* Özet kartlar */}
          <div className="grid grid-cols-3 gap-3">
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Maç</p>
              <p className="text-xl font-bold font-mono tabular-nums text-[var(--text-primary)]">{stats.totalMatches}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Value Bet</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${stats.valueBetCount > 0 ? 'text-[var(--accent-win)]' : 'text-[var(--text-primary)]'}`}>{stats.valueBetCount}</p>
            </div>
            <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-4 py-3">
              <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] mb-1">Max Edge</p>
              <p className={`text-xl font-bold font-mono tabular-nums ${stats.maxEdge > 0 ? 'text-[var(--accent-win)]' : 'text-[var(--text-primary)]'}`}>
                {stats.maxEdge > 0 ? `%${(stats.maxEdge * 100).toFixed(1)}` : '—'}
              </p>
            </div>
          </div>

          {/* Model versiyonu */}
          {data.modelVersion && (
            <p className="text-[10px] text-[var(--text-muted)]">
              Model: <span className="font-mono">{data.modelVersion}</span>
            </p>
          )}

          {/* Maç kartları */}
          <div className="space-y-3">
            {data.matches.map((match) => (
              <MatchCard key={match.matchCode} match={match} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}
