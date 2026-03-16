'use client'

import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type MarketPrediction = {
  market: string
  probs: Record<string, number>
  predicted: string
  valueBets: Array<{ outcome: string; modelProb: number; impliedProb: number; edge: number }> | null
}

type ValueBet = {
  market: string
  outcome: string
  modelProb: number
  impliedProb: number
  edge: number
}

type MatchPrediction = {
  matchId: number
  matchCode: string
  markets: MarketPrediction[]
  valueBets: ValueBet[]
}

// ---------------------------------------------------------------------------
// Sabitler
// ---------------------------------------------------------------------------

const MARKET_ORDER = ['ms', 'kg', 'au25', 'tg', 'iy']

const MARKET_LABELS: Record<string, string> = {
  ms: 'MS 1/X/2',
  kg: 'KG Var/Yok',
  au25: 'AU 2.5 Alt/Üst',
  tg: 'Toplam Gol',
  iy: 'İlk Yarı',
}

const OUTCOME_LABELS: Record<string, Record<string, string>> = {
  ms: { '1': 'Ev Sahibi', 'X': 'Beraberlik', '2': 'Deplasman' },
  kg: { var: 'Var', yok: 'Yok' },
  au25: { alt: 'Alt 2.5', ust: 'Üst 2.5' },
  tg: { '0-1': '0-1', '2-3': '2-3', '4-5': '4-5', '6+': '6+' },
  iy: { '1': 'Ev', 'X': 'Beraberlik', '2': 'Deplasman' },
}

function getOutcomeLabel(market: string, outcome: string): string {
  return OUTCOME_LABELS[market]?.[outcome] ?? outcome
}

// ---------------------------------------------------------------------------
// Bileşen
// ---------------------------------------------------------------------------

function MarketRow({ market }: { market: MarketPrediction }) {
  const entries = Object.entries(market.probs).sort((a, b) => b[1] - a[1])
  const maxProb = entries.length > 0 ? entries[0][1] : 0
  const valueOutcomes = new Set((market.valueBets ?? []).map((v) => v.outcome))

  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-[var(--text-muted)] font-medium mb-1.5">
        {MARKET_LABELS[market.market] ?? market.market}
      </p>
      <div className="space-y-1">
        {entries.map(([outcome, prob]) => {
          const pct = Math.round(prob * 100)
          const isMax = prob === maxProb
          const isValue = valueOutcomes.has(outcome)
          const barColor = isValue ? 'var(--accent-win)' : isMax ? 'var(--accent-blue)' : 'var(--text-muted)'

          return (
            <div key={outcome} className="flex items-center gap-2">
              <span className="text-[11px] text-[var(--text-tertiary)] w-16 shrink-0">
                {getOutcomeLabel(market.market, outcome)}
              </span>
              <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-tertiary)] overflow-hidden">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${pct}%`, backgroundColor: barColor, opacity: isMax || isValue ? 1 : 0.25 }}
                />
              </div>
              <span className={`font-mono tabular-nums text-[11px] w-10 text-right shrink-0 ${
                isValue ? 'text-[var(--accent-win)] font-bold' : isMax ? 'text-[var(--text-primary)] font-semibold' : 'text-[var(--text-muted)]'
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
  const hasValue = prediction.valueBets.length > 0

  return (
    <div className={`rounded-lg border bg-[var(--bg-secondary)] p-4 card-glow ${
      hasValue
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

      {/* Value betler */}
      {hasValue && (
        <div className="mt-4 pt-3 border-t border-[var(--border-subtle)] flex flex-col gap-1.5">
          {prediction.valueBets.map((vb, i) => (
            <div key={`${vb.market}-${vb.outcome}-${i}`} className="flex items-center gap-2 text-xs">
              <span className="text-[var(--accent-win)] font-semibold">VALUE</span>
              <span className="text-[var(--text-secondary)]">
                {MARKET_LABELS[vb.market] ?? vb.market} {getOutcomeLabel(vb.market, vb.outcome)}
              </span>
              <span className="font-mono tabular-nums text-[var(--text-muted)]">
                Model %{Math.round(vb.modelProb * 100)} vs Bahisçi %{Math.round(vb.impliedProb * 100)}
              </span>
              <span className="font-mono tabular-nums text-[var(--accent-win)] font-semibold">
                +{(vb.edge * 100).toFixed(1)}%
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
