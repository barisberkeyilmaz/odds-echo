'use client'

import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

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

type ConfidentPick = {
  market: string
  outcome: string
  confidence: number
  threshold: number
  confidenceLevel: string
  impliedProb: number | null
}

type MatchPrediction = {
  matchId: number
  matchCode: string
  markets: MarketPrediction[]
  confidentPicks: ConfidentPick[]
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const MARKET_ORDER = ['ms', 'kg', 'au25', 'tg', 'iyms']

const MARKET_LABELS: Record<string, string> = {
  ms: 'MS 1/X/2',
  kg: 'KG Var/Yok',
  au25: 'AU 2.5 Alt/Ust',
  tg: 'Toplam Gol',
  iyms: 'IY/MS',
}

const OUTCOME_LABELS: Record<string, Record<string, string>> = {
  ms: { '1': 'Ev Sahibi', 'X': 'Beraberlik', '2': 'Deplasman' },
  kg: { Yok: 'Yok', Var: 'Var' },
  au25: { Alt: 'Alt 2.5', Ust: 'Ust 2.5' },
  tg: { '0-1': '0-1', '2-3': '2-3', '4-5': '4-5', '6+': '6+' },
  iyms: { '1/1': '1/1', '1/X': '1/X', '1/2': '1/2', 'X/1': 'X/1', 'X/X': 'X/X', 'X/2': 'X/2', '2/1': '2/1', '2/X': '2/X', '2/2': '2/2' },
}

const CONFIDENCE_LEVEL_LABELS: Record<string, { text: string; color: string }> = {
  cok_emin: { text: 'COK EMIN', color: 'var(--accent-win)' },
  emin: { text: 'EMIN', color: 'var(--accent-blue)' },
  olasi: { text: 'OLASI', color: 'var(--accent-draw)' },
}

function getOutcomeLabel(market: string, outcome: string): string {
  return OUTCOME_LABELS[market]?.[outcome] ?? outcome
}

// ---------------------------------------------------------------------------
// Bilesen
// ---------------------------------------------------------------------------

function MarketRow({ market }: { market: MarketPrediction }) {
  const entries = Object.entries(market.probs).sort((a, b) => b[1] - a[1])
  const maxProb = entries.length > 0 ? entries[0][1] : 0
  const confidentOutcomes = new Set((market.confidentPicks ?? []).map((cp) => cp.outcome))

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5">
        {MARKET_LABELS[market.market] ?? market.market}
      </p>
      <div className="space-y-1">
        {entries.map(([outcome, prob]) => {
          const pct = Math.round(prob * 100)
          const isMax = prob === maxProb
          const isConfident = confidentOutcomes.has(outcome)
          const barColor = isConfident ? 'var(--accent-win)' : isMax ? 'var(--accent-blue)' : 'var(--text-muted)'

          return (
            <div key={outcome} className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-tertiary)] w-16 shrink-0">
                {getOutcomeLabel(market.market, outcome)}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: barColor, opacity: isMax || isConfident ? 1 : 0.25 }}
                />
              </div>
              <span className={`font-mono tabular-nums text-[11px] w-10 text-right shrink-0 ${
                isConfident ? 'text-[var(--accent-win)] font-bold' : isMax ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'
              }`}>
                {pct}%
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default function MLPredictionCard({ matchCode }: { matchCode: string }) {
  const [prediction, setPrediction] = useState<MatchPrediction | null>(null)
  const [loading, setLoading] = useState(true)
  const [notFound, setNotFound] = useState(false)

  useEffect(() => {
    const controller = new AbortController()

    const fetchData = async () => {
      setLoading(true)
      setNotFound(false)
      try {
        const res = await fetch(`/api/matches/ml-predictions?match_code=${matchCode}`, { signal: controller.signal })
        if (res.ok) {
          const data = await res.json()
          if (data.matches && data.matches.length > 0) {
            setPrediction(data.matches[0])
          } else {
            setNotFound(true)
          }
        }
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return
      }
      setLoading(false)
    }

    fetchData()
    return () => controller.abort()
  }, [matchCode])

  if (loading) {
    return (
      <div className="rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] p-4">
        <div className="skeleton h-4 w-1/3 mb-3" />
        <div className="skeleton h-3 w-full mb-2" />
        <div className="skeleton h-3 w-2/3" />
      </div>
    )
  }

  if (notFound || !prediction) return null

  const sortedMarkets = [...prediction.markets].sort(
    (a, b) => MARKET_ORDER.indexOf(a.market) - MARKET_ORDER.indexOf(b.market)
  )
  const hasConfident = prediction.confidentPicks.length > 0

  return (
    <div className={`rounded-lg border bg-[var(--bg-secondary)] p-4 card-glow ${
      hasConfident
        ? 'border-[color-mix(in_srgb,var(--accent-win)_30%,var(--border-primary))]'
        : 'border-[var(--border-primary)]'
    }`}>
      <h3 className="text-sm font-semibold text-[var(--text-primary)] font-[family-name:var(--font-space-grotesk)] mb-4">
        ML Tahminleri
      </h3>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {sortedMarkets.map((m) => (
          <MarketRow key={m.market} market={m} />
        ))}
      </div>

      {/* Emin tahminler */}
      {hasConfident && (
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
          {prediction.confidentPicks.map((cp, i) => {
            const levelInfo = CONFIDENCE_LEVEL_LABELS[cp.confidenceLevel] ?? CONFIDENCE_LEVEL_LABELS.olasi
            return (
              <div key={`${cp.market}-${cp.outcome}-${i}`} className="flex items-center gap-2 text-xs">
                <span className="font-semibold" style={{ color: levelInfo.color }}>
                  {levelInfo.text}
                </span>
                <span className="text-[var(--text-secondary)]">
                  {MARKET_LABELS[cp.market] ?? cp.market} {getOutcomeLabel(cp.market, cp.outcome)}
                </span>
                <span className="font-mono tabular-nums font-semibold" style={{ color: levelInfo.color }}>
                  %{Math.round(cp.confidence * 100)}
                </span>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
