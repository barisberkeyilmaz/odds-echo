'use client'

import { useState, useEffect } from 'react'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type CalibrationBracket = {
  bracket: string
  avgPredicted: number
  avgActual: number
  count: number
}

type MarketStat = {
  market: string
  total: number
  accuracy: number
  calibration: CalibrationBracket[]
  confidentPickCount: number
  confidentPickHits: number
  confidentPickHitRate: number
  confidentPickByLevel: Record<string, { total: number; hits: number }>
  coverage: number
}

type RecentPick = {
  matchCode: string
  homeTeam: string
  awayTeam: string
  matchDate: string
  market: string
  predicted: string
  actual: string
  isCorrect: boolean
  confidence: number
  scoreFt: string
  hasConfidentPick: boolean
  confidenceLevel: string | null
}

type BacktestResponse = {
  modelVersion: string | null
  totalMatchesWithPrediction: number
  settledMatches: number
  summary: {
    totalPredictions: number
    overallAccuracy: number
    confidentPicks: { total: number; hits: number; hitRate: number }
  } | null
  markets: MarketStat[]
  recentPicks: RecentPick[]
}

// ---------------------------------------------------------------------------
// Yardimcilar
// ---------------------------------------------------------------------------

const MARKET_LABELS: Record<string, string> = {
  ms: 'Mac Sonucu',
  kg: 'Karsilikli Gol',
  au25: '2.5 Alt/Ust',
  tg: 'Toplam Gol',
  iyms: 'IY/MS',
}

const CONFIDENCE_LEVEL_LABELS: Record<string, { text: string; color: string }> = {
  cok_emin: { text: 'COK EMIN', color: 'var(--accent-win)' },
  emin: { text: 'EMIN', color: 'var(--accent-blue)' },
  olasi: { text: 'OLASI', color: 'var(--accent-draw)' },
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function pctColor(value: number, threshold: number) {
  return value >= threshold ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'
}

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('tr-TR', { day: '2-digit', month: '2-digit' })
  } catch {
    return dateStr
  }
}

// ---------------------------------------------------------------------------
// Alt Bilesenler
// ---------------------------------------------------------------------------

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg p-4">
      <p className="text-xs text-[var(--text-muted)] mb-1">{label}</p>
      <p className={`text-xl font-bold font-mono tabular-nums ${color ?? 'text-[var(--text-primary)]'}`}>
        {value}
      </p>
      {sub && <p className="text-[10px] text-[var(--text-muted)] mt-0.5">{sub}</p>}
    </div>
  )
}

function MarketTable({ data }: { data: MarketStat[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">Market</th>
            <th className="text-right px-3 py-2.5 font-medium">Tahmin</th>
            <th className="text-right px-3 py-2.5 font-medium">Isabet %</th>
            <th className="text-right px-3 py-2.5 font-medium">Emin Tahmin</th>
            <th className="text-right px-3 py-2.5 font-medium">Emin Isabet</th>
            <th className="text-right px-4 py-2.5 font-medium">Coverage</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.market} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors">
              <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">
                {MARKET_LABELS[row.market] ?? row.market}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {row.total}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${pctColor(row.accuracy, 0.4)}`}>
                {formatPct(row.accuracy)}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {row.confidentPickCount}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${
                row.confidentPickCount > 0 ? pctColor(row.confidentPickHitRate, 0.5) : 'text-[var(--text-muted)]'
              }`}>
                {row.confidentPickCount > 0 ? formatPct(row.confidentPickHitRate) : '\u2014'}
              </td>
              <td className="px-4 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {formatPct(row.coverage)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CalibrationTable({ markets }: { markets: MarketStat[] }) {
  const brackets = ['0-20%', '20-40%', '40-60%', '60-80%', '80-100%']
  const combined = brackets.map((bracket) => {
    let totalCount = 0
    let totalPred = 0
    let totalActual = 0
    for (const m of markets) {
      const b = m.calibration.find((c) => c.bracket === bracket)
      if (b && b.count > 0) {
        totalCount += b.count
        totalPred += b.avgPredicted * b.count
        totalActual += b.avgActual * b.count
      }
    }
    return {
      bracket,
      avgPredicted: totalCount > 0 ? totalPred / totalCount : 0,
      avgActual: totalCount > 0 ? totalActual / totalCount : 0,
      count: totalCount,
    }
  })

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">Guven Araligi</th>
            <th className="text-right px-3 py-2.5 font-medium">Sayi</th>
            <th className="text-right px-3 py-2.5 font-medium">Ort. Tahmin</th>
            <th className="text-right px-4 py-2.5 font-medium">Gercek Oran</th>
            <th className="text-right px-4 py-2.5 font-medium">Fark</th>
          </tr>
        </thead>
        <tbody>
          {combined.map((row) => {
            const diff = row.count > 0 ? row.avgActual - row.avgPredicted : 0
            return (
              <tr key={row.bracket} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors">
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                  {row.bracket}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                  {row.count}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-secondary)]">
                  {row.count > 0 ? formatPct(row.avgPredicted) : '\u2014'}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${
                  row.count > 0 ? pctColor(row.avgActual, row.avgPredicted) : 'text-[var(--text-muted)]'
                }`}>
                  {row.count > 0 ? formatPct(row.avgActual) : '\u2014'}
                </td>
                <td className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${
                  row.count > 0 ? (diff >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]') : 'text-[var(--text-muted)]'
                }`}>
                  {row.count > 0 ? `${diff >= 0 ? '+' : ''}${(diff * 100).toFixed(1)}pp` : '\u2014'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function RecentPicksTable({ picks }: { picks: RecentPick[] }) {
  const [page, setPage] = useState(0)
  const pageSize = 50
  const totalPages = Math.ceil(picks.length / pageSize)
  const paged = picks.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div>
      {/* Desktop */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-[var(--border-primary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 font-medium">Tarih</th>
              <th className="text-left px-3 py-2.5 font-medium">Mac</th>
              <th className="text-left px-3 py-2.5 font-medium">Market</th>
              <th className="text-center px-3 py-2.5 font-medium">Tahmin</th>
              <th className="text-center px-3 py-2.5 font-medium">Gercek</th>
              <th className="text-right px-3 py-2.5 font-medium">Guven</th>
              <th className="text-center px-3 py-2.5 font-medium">Skor</th>
              <th className="text-center px-3 py-2.5 font-medium">Seviye</th>
              <th className="text-center px-4 py-2.5 font-medium">Sonuc</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((pick, i) => {
              const levelInfo = pick.confidenceLevel ? CONFIDENCE_LEVEL_LABELS[pick.confidenceLevel] : null
              return (
                <tr
                  key={`${pick.matchCode}-${pick.market}-${i}`}
                  className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors"
                >
                  <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-muted)]">
                    {formatDate(pick.matchDate)}
                  </td>
                  <td className="px-3 py-2.5 text-sm text-[var(--text-primary)]">
                    {pick.homeTeam} - {pick.awayTeam}
                  </td>
                  <td className="px-3 py-2.5">
                    <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                      {pick.market.toUpperCase()}
                    </span>
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                    {pick.predicted}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono tabular-nums text-xs font-medium text-[var(--text-secondary)]">
                    {pick.actual}
                  </td>
                  <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                    {formatPct(pick.confidence)}
                  </td>
                  <td className="px-3 py-2.5 text-center font-mono text-xs text-[var(--text-secondary)]">
                    {pick.scoreFt}
                  </td>
                  <td className="px-3 py-2.5 text-center">
                    {levelInfo ? (
                      <span className="text-[10px] font-bold" style={{ color: levelInfo.color }}>
                        {levelInfo.text}
                      </span>
                    ) : (
                      <span className="text-[var(--text-muted)] text-xs">&mdash;</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-center">
                    {pick.isCorrect ? (
                      <span className="text-[var(--accent-win)] font-bold text-sm">&#10003;</span>
                    ) : (
                      <span className="text-[var(--accent-loss)] font-bold text-sm">&#10007;</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile */}
      <div className="block sm:hidden divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-primary)] overflow-hidden bg-[var(--bg-secondary)]">
        {paged.map((pick, i) => {
          const levelInfo = pick.confidenceLevel ? CONFIDENCE_LEVEL_LABELS[pick.confidenceLevel] : null
          return (
            <div key={`${pick.matchCode}-${pick.market}-${i}`} className="px-4 py-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-[var(--text-primary)] truncate">
                    {pick.homeTeam} - {pick.awayTeam}
                  </div>
                  <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                    {formatDate(pick.matchDate)} &bull; {pick.scoreFt}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                    {pick.market.toUpperCase()}
                  </span>
                  {pick.isCorrect ? (
                    <span className="text-[var(--accent-win)] font-bold text-sm">&#10003;</span>
                  ) : (
                    <span className="text-[var(--accent-loss)] font-bold text-sm">&#10007;</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-4 mt-2 text-[10px]">
                <span className="text-[var(--text-muted)]">
                  Tahmin: <span className="font-mono text-[var(--text-secondary)]">{pick.predicted}</span>
                </span>
                <span className="text-[var(--text-muted)]">
                  Gercek: <span className="font-mono text-[var(--text-secondary)]">{pick.actual}</span>
                </span>
                <span className="text-[var(--text-muted)]">
                  Guven: <span className="font-mono text-[var(--text-secondary)]">{formatPct(pick.confidence)}</span>
                </span>
                {levelInfo && <span className="font-bold" style={{ color: levelInfo.color }}>{levelInfo.text}</span>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <p className="text-xs text-[var(--text-muted)]">
            {picks.length} sonuctan {page * pageSize + 1}&ndash;{Math.min((page + 1) * pageSize, picks.length)} arasi
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(page - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              &larr; Onceki
            </button>
            <button
              onClick={() => setPage(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Sonraki &rarr;
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Ana Dashboard
// ---------------------------------------------------------------------------

export default function MLBacktestDashboard() {
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function fetchData() {
      try {
        const res = await fetch('/api/matches/ml-backtest')
        if (res.ok) {
          setData(await res.json())
        }
      } catch {
        // ignore
      }
      setLoading(false)
    }
    fetchData()
  }, [])

  const summary = data?.summary
  const markets = data?.markets ?? []
  const recentPicks = data?.recentPicks ?? []
  const isEmpty = !loading && (!summary || summary.totalPredictions === 0)

  return (
    <div className="space-y-6">
      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <div className="inline-block w-6 h-6 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--text-muted)]">ML backtest verileri yukleniyor...</p>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-tertiary)]">
            {data && data.totalMatchesWithPrediction > 0
              ? 'Henuz oyanmis mac yok. Tahmin edilen maclar oyandikca backtest verileri burada gorunecek.'
              : 'ML backtest verisi bulunamadi.'}
          </p>
          {(!data || data.totalMatchesWithPrediction === 0) && (
            <p className="text-xs text-[var(--text-muted)] mt-2">
              Once <code className="font-mono">python main.py predict</code> calistirarak tahmin uretin.
            </p>
          )}
        </div>
      )}

      {/* Pending info */}
      {!loading && data && data.totalMatchesWithPrediction > 0 && data.settledMatches < data.totalMatchesWithPrediction && (
        <div className="bg-[color-mix(in_srgb,var(--accent-draw)_8%,var(--bg-secondary))] border border-[color-mix(in_srgb,var(--accent-draw)_30%,var(--border-primary))] rounded-lg px-4 py-3">
          <p className="text-sm text-[var(--text-secondary)]">
            <span className="font-mono font-semibold text-[var(--accent-draw)]">{data.settledMatches}</span>
            <span className="text-[var(--text-muted)]"> / </span>
            <span className="font-mono">{data.totalMatchesWithPrediction}</span>
            {' '}mac oyanmis.{' '}
            <span className="text-[var(--text-muted)]">
              Kalan {data.totalMatchesWithPrediction - data.settledMatches} mac oyaninca backtest otomatik guncellenecek.
            </span>
          </p>
        </div>
      )}

      {/* Content */}
      {!loading && summary && summary.totalPredictions > 0 && (
        <>
          {/* Model version badge */}
          {data?.modelVersion && (
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-md font-mono bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                Model: {data.modelVersion}
              </span>
            </div>
          )}

          {/* Ozet kartlar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Toplam Tahmin"
              value={summary.totalPredictions.toLocaleString('tr-TR')}
              sub="Oyanmis maclar"
            />
            <StatCard
              label="Genel Isabet"
              value={formatPct(summary.overallAccuracy)}
              color={pctColor(summary.overallAccuracy, 0.4)}
            />
            <StatCard
              label="Emin Tahmin Isabet"
              value={summary.confidentPicks.total > 0
                ? formatPct(summary.confidentPicks.hitRate)
                : '\u2014'}
              sub={`${summary.confidentPicks.hits} / ${summary.confidentPicks.total} emin tahmin`}
              color={summary.confidentPicks.total > 0
                ? pctColor(summary.confidentPicks.hitRate, 0.5)
                : undefined}
            />
            <StatCard
              label="Emin Tahmin Sayisi"
              value={summary.confidentPicks.total > 0
                ? summary.confidentPicks.total.toString()
                : '\u2014'}
              sub={`${summary.confidentPicks.hits} tuttu`}
            />
          </div>

          {/* Market Performansi */}
          {markets.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
                Market Performansi
              </h3>
              <MarketTable data={markets} />
            </div>
          )}

          {/* Kalibrasyon */}
          {markets.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
                Kalibrasyon
              </h3>
              <p className="text-[10px] text-[var(--text-muted)] mb-3">
                Model %X guvenle tahmin ettiginde, gercekte ne kadar isabetli? Ideal: tahmin = gercek.
              </p>
              <CalibrationTable markets={markets} />
            </div>
          )}

          {/* Son Tahminler */}
          {recentPicks.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
                Son Tahminler
              </h3>
              <RecentPicksTable picks={recentPicks} />
            </div>
          )}
        </>
      )}
    </div>
  )
}
