'use client'

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'

// ---------------------------------------------------------------------------
// Tipler
// ---------------------------------------------------------------------------

type BacktestPick = {
  id: number
  pick_date: string
  match_id: number
  home_team: string
  away_team: string
  league: string | null
  match_date: string
  outcome_key: string
  outcome_label: string
  category_label: string
  odds_value: number
  wilson_lower: number
  hit_rate: number
  total_similar: number
  hit_count: number
  ev: number
  implied_prob: number
  score_ft: string | null
  score_ht: string | null
  is_hit: boolean | null
  is_settled: boolean
}

type CalibrationBracket = {
  bracket: string
  totalPicks: number
  hitCount: number
  actualHitRate: number
}

type CategoryStat = {
  label: string
  totalPicks: number
  hitCount: number
  hitRate: number
  avgEV: number
  roi: number
}

type Summary = {
  totalPicks: number
  hitCount: number
  hitRate: number
  avgEV: number
  avgOdds: number
  roi: number
  totalDays: number
  calibration: CalibrationBracket[]
  categories: CategoryStat[]
}

type BacktestResponse = {
  from: string
  to: string
  summary: Summary
  picks: BacktestPick[]
}

// ---------------------------------------------------------------------------
// Yardımcılar
// ---------------------------------------------------------------------------

function formatDate(dateStr: string) {
  try {
    return new Date(dateStr).toLocaleDateString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
    })
  } catch {
    return dateStr
  }
}

function formatPct(value: number) {
  return `${(value * 100).toFixed(1)}%`
}

function pctColor(value: number, threshold: number) {
  return value >= threshold ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'
}

function defaultFromDate() {
  const d = new Date()
  d.setDate(d.getDate() - 30)
  return d.toISOString().split('T')[0]
}

function defaultToDate() {
  return new Date().toISOString().split('T')[0]
}

// ---------------------------------------------------------------------------
// Alt Bileşenler
// ---------------------------------------------------------------------------

function StatCard({
  label,
  value,
  sub,
  color,
}: {
  label: string
  value: string
  sub?: string
  color?: string
}) {
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

function CalibrationTable({ data }: { data: CalibrationBracket[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">Wilson Aralığı</th>
            <th className="text-right px-3 py-2.5 font-medium">Öneri</th>
            <th className="text-right px-3 py-2.5 font-medium">İsabet</th>
            <th className="text-right px-4 py-2.5 font-medium">Gerçek Oran</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.bracket} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors">
              <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-secondary)]">
                {row.bracket}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {row.totalPicks}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {row.hitCount}
              </td>
              <td className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${
                row.totalPicks > 0 ? pctColor(row.actualHitRate, 0.4) : 'text-[var(--text-muted)]'
              }`}>
                {row.totalPicks > 0 ? formatPct(row.actualHitRate) : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryTable({ data }: { data: CategoryStat[] }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--border-primary)]">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
            <th className="text-left px-4 py-2.5 font-medium">Kategori</th>
            <th className="text-right px-3 py-2.5 font-medium">Öneri</th>
            <th className="text-right px-3 py-2.5 font-medium">İsabet</th>
            <th className="text-right px-3 py-2.5 font-medium">Ort. EV</th>
            <th className="text-right px-4 py-2.5 font-medium">ROI</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row) => (
            <tr key={row.label} className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors">
              <td className="px-4 py-2.5 text-sm font-medium text-[var(--text-primary)]">
                {row.label}
              </td>
              <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-muted)]">
                {row.totalPicks}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${pctColor(row.hitRate, 0.4)}`}>
                {formatPct(row.hitRate)}
              </td>
              <td className={`px-3 py-2.5 text-right font-mono tabular-nums text-xs ${row.avgEV >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}`}>
                {row.avgEV >= 0 ? '+' : ''}{row.avgEV.toFixed(3)}
              </td>
              <td className={`px-4 py-2.5 text-right font-mono tabular-nums text-xs font-medium ${row.roi >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}`}>
                {row.roi >= 0 ? '+' : ''}{(row.roi * 100).toFixed(1)}%
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function PicksTable({
  picks,
  page,
  onPageChange,
}: {
  picks: BacktestPick[]
  page: number
  onPageChange: (p: number) => void
}) {
  const pageSize = 50
  const totalPages = Math.ceil(picks.length / pageSize)
  const paged = picks.slice(page * pageSize, (page + 1) * pageSize)

  return (
    <div>
      {/* Desktop tablo */}
      <div className="hidden sm:block overflow-x-auto rounded-lg border border-[var(--border-primary)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider">
              <th className="text-left px-4 py-2.5 font-medium">Tarih</th>
              <th className="text-left px-3 py-2.5 font-medium">Maç</th>
              <th className="text-left px-3 py-2.5 font-medium">Sonuç</th>
              <th className="text-right px-3 py-2.5 font-medium">Oran</th>
              <th className="text-right px-3 py-2.5 font-medium">Wilson</th>
              <th className="text-center px-3 py-2.5 font-medium">Skor</th>
              <th className="text-center px-4 py-2.5 font-medium">İsabet</th>
            </tr>
          </thead>
          <tbody>
            {paged.map((pick) => (
              <tr
                key={pick.id}
                className="border-b border-[var(--border-subtle)] hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                <td className="px-4 py-2.5 font-mono text-xs text-[var(--text-muted)]">
                  {formatDate(pick.pick_date)}
                </td>
                <td className="px-3 py-2.5">
                  <Link href={`/analysis/${pick.match_id}`} target="_blank" className="group">
                    <span className="text-sm text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors">
                      {pick.home_team} - {pick.away_team}
                    </span>
                  </Link>
                  <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">{pick.league}</span>
                </td>
                <td className="px-3 py-2.5">
                  <span className="inline-block text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                    {pick.outcome_label}
                  </span>
                  <span className="block text-[10px] text-[var(--text-muted)] mt-0.5">{pick.category_label}</span>
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                  {pick.odds_value.toFixed(2)}
                </td>
                <td className="px-3 py-2.5 text-right font-mono tabular-nums text-xs text-[var(--text-secondary)]">
                  {(pick.wilson_lower * 100).toFixed(1)}%
                </td>
                <td className="px-3 py-2.5 text-center font-mono text-xs text-[var(--text-secondary)]">
                  {pick.score_ft ?? '—'}
                </td>
                <td className="px-4 py-2.5 text-center">
                  {pick.is_settled ? (
                    pick.is_hit ? (
                      <span className="text-[var(--accent-win)] font-bold text-sm">&#10003;</span>
                    ) : (
                      <span className="text-[var(--accent-loss)] font-bold text-sm">&#10007;</span>
                    )
                  ) : (
                    <span className="text-[var(--text-muted)] text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile kartlar */}
      <div className="block sm:hidden divide-y divide-[var(--border-subtle)] rounded-lg border border-[var(--border-primary)] overflow-hidden bg-[var(--bg-secondary)]">
        {paged.map((pick) => (
          <div key={pick.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <Link href={`/analysis/${pick.match_id}`} target="_blank" className="group">
                  <div className="text-sm font-medium text-[var(--text-primary)] group-hover:text-[var(--accent-blue)] transition-colors truncate">
                    {pick.home_team} - {pick.away_team}
                  </div>
                </Link>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">
                  {formatDate(pick.pick_date)} • {pick.league}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <span className="text-xs px-2 py-0.5 rounded-md font-medium bg-[color-mix(in_srgb,var(--accent-blue)_10%,transparent)] text-[var(--accent-blue)]">
                  {pick.outcome_label}
                </span>
                <span className="font-mono tabular-nums text-sm font-semibold text-[var(--text-primary)]">
                  {pick.odds_value.toFixed(2)}
                </span>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px]">
              <span className="text-[var(--text-muted)]">
                Wilson: <span className="font-mono text-[var(--text-secondary)]">{(pick.wilson_lower * 100).toFixed(1)}%</span>
              </span>
              <span className="text-[var(--text-muted)]">
                Skor: <span className="font-mono text-[var(--text-secondary)]">{pick.score_ft ?? '—'}</span>
              </span>
              <span>
                {pick.is_settled ? (
                  pick.is_hit ? (
                    <span className="text-[var(--accent-win)] font-bold">&#10003;</span>
                  ) : (
                    <span className="text-[var(--accent-loss)] font-bold">&#10007;</span>
                  )
                ) : (
                  <span className="text-[var(--text-muted)]">—</span>
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      {/* Sayfalama */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-3 px-1">
          <p className="text-xs text-[var(--text-muted)]">
            {picks.length} sonuçtan {page * pageSize + 1}–{Math.min((page + 1) * pageSize, picks.length)} arası
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => onPageChange(page - 1)}
              disabled={page === 0}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Önceki
            </button>
            <button
              onClick={() => onPageChange(page + 1)}
              disabled={page >= totalPages - 1}
              className="px-3 py-1.5 rounded-lg text-xs font-medium border border-[var(--border-primary)] text-[var(--text-secondary)] hover:bg-[var(--bg-tertiary)] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Sonraki →
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

export default function BacktestDashboard() {
  const [fromDate, setFromDate] = useState(defaultFromDate)
  const [toDate, setToDate] = useState(defaultToDate)
  const [data, setData] = useState<BacktestResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(0)

  const fetchData = useCallback(async (from: string, to: string) => {
    setLoading(true)
    setPage(0)
    try {
      const params = new URLSearchParams({ from, to })
      const res = await fetch(`/api/matches/backtest?${params}`)
      if (res.ok) {
        const json: BacktestResponse = await res.json()
        setData(json)
      }
    } catch {
      // ignore
    }
    setLoading(false)
  }, [])

  useEffect(() => {
    fetchData(fromDate, toDate)
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleApply = useCallback(() => {
    fetchData(fromDate, toDate)
  }, [fromDate, toDate, fetchData])

  const summary = data?.summary
  const picks = data?.picks ?? []
  const isEmpty = !loading && (!picks || picks.length === 0)

  return (
    <div className="space-y-6">
      {/* Tarih Aralığı Seçici */}
      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Başlangıç</label>
          <input
            type="date"
            value={fromDate}
            onChange={(e) => setFromDate(e.target.value)}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
          />
        </div>
        <div>
          <label className="block text-xs text-[var(--text-muted)] mb-1">Bitiş</label>
          <input
            type="date"
            value={toDate}
            onChange={(e) => setToDate(e.target.value)}
            className="bg-[var(--bg-secondary)] border border-[var(--border-primary)] rounded-lg px-3 py-1.5 text-sm text-[var(--text-primary)] focus:outline-none focus:border-[var(--accent-blue)]"
          />
        </div>
        <button
          onClick={handleApply}
          disabled={loading}
          className="px-4 py-1.5 rounded-lg text-sm font-medium bg-[var(--accent-blue)] text-white hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          Uygula
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <div className="text-center py-16">
          <div className="inline-block w-6 h-6 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mb-3" />
          <p className="text-sm text-[var(--text-muted)]">Backtest verileri yükleniyor...</p>
        </div>
      )}

      {/* Empty */}
      {isEmpty && (
        <div className="text-center py-16 bg-[var(--bg-secondary)] rounded-lg border border-[var(--border-primary)]">
          <p className="text-sm text-[var(--text-tertiary)]">Seçilen tarih aralığında backtest verisi bulunamadı.</p>
          <p className="text-xs text-[var(--text-muted)] mt-2">
            Önce <code className="font-mono">python backtest_daily_picks.py --days 30</code> çalıştırın.
          </p>
        </div>
      )}

      {/* Özet Kartlar */}
      {!loading && summary && summary.totalPicks > 0 && (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <StatCard
              label="Toplam Öneri"
              value={summary.totalPicks.toString()}
              sub={`${summary.totalDays} gün`}
            />
            <StatCard
              label="İsabet Oranı"
              value={formatPct(summary.hitRate)}
              sub={`${summary.hitCount} / ${summary.totalPicks}`}
              color={pctColor(summary.hitRate, 0.5)}
            />
            <StatCard
              label="Ortalama EV"
              value={`${summary.avgEV >= 0 ? '+' : ''}${summary.avgEV.toFixed(3)}`}
              sub={`Ort. oran: ${summary.avgOdds.toFixed(2)}`}
              color={summary.avgEV >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}
            />
            <StatCard
              label="ROI"
              value={`${summary.roi >= 0 ? '+' : ''}${(summary.roi * 100).toFixed(1)}%`}
              sub="Birim bahis bazında"
              color={summary.roi >= 0 ? 'text-[var(--accent-win)]' : 'text-[var(--accent-loss)]'}
            />
          </div>

          {/* Kalibrasyon Tablosu */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
              Wilson Kalibrasyonu
            </h3>
            <p className="text-[10px] text-[var(--text-muted)] mb-3">
              Wilson aralığına göre gerçek isabet oranları — modelin güvenilirlik kalibrasyonu.
            </p>
            <CalibrationTable data={summary.calibration} />
          </div>

          {/* Kategori Performansı */}
          {summary.categories.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
                Kategori Performansı
              </h3>
              <CategoryTable data={summary.categories} />
            </div>
          )}

          {/* Pick Detayları */}
          <div>
            <h3 className="text-sm font-semibold text-[var(--text-secondary)] font-[family-name:var(--font-space-grotesk)] mb-2">
              Pick Detayları
            </h3>
            <PicksTable picks={picks} page={page} onPageChange={setPage} />
          </div>
        </>
      )}
    </div>
  )
}
