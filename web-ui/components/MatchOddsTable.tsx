"use client"

import { useRef, useState } from 'react'
import Link from 'next/link'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  formatMatchDateTime,
  formatOdd,
  getOutcomeKeys,
  ODDS_CATEGORIES,
  CATEGORY_LABELS,
  type MatchWithScores,
  type OddsKey,
} from '@/lib/match'

export type OddsTableMatch = MatchWithScores & {
  matchCount: number
  matchedCategoryIds: string[]
}

const ODDS_LABELS: Record<OddsKey, string> = {
  ms_1: 'MS 1',
  ms_x: 'MS X',
  ms_2: 'MS 2',
  iyms_11: '1/1',
  iyms_1x: '1/X',
  iyms_12: '1/2',
  iyms_x1: 'X/1',
  iyms_xx: 'X/X',
  iyms_x2: 'X/2',
  iyms_21: '2/1',
  iyms_2x: '2/X',
  iyms_22: '2/2',
  au_15_alt: '1.5 Alt',
  au_15_ust: '1.5 Üst',
  au_25_alt: '2.5 Alt',
  au_25_ust: '2.5 Üst',
  kg_var: 'KG Var',
  kg_yok: 'KG Yok',
  tg_0_1: '0-1',
  tg_2_3: '2-3',
  tg_4_5: '4-5',
  tg_6_plus: '6+',
}

const ODDS_GROUPS = ODDS_CATEGORIES.map((category) => ({
  id: category.id,
  label: category.label,
  fields: category.fields,
}))

const ODDS_COLUMNS = ODDS_GROUPS.flatMap((group) => group.fields)

const getCellClass = (isHit: boolean) =>
  isHit
    ? 'border-[var(--border-subtle)] bg-[var(--accent-win-bg)] text-[var(--accent-win)] font-semibold'
    : 'border-[var(--border-subtle)] text-[var(--text-secondary)]'

const getMatchBadgeClass = (count: number, total: number) => {
  if (total === 0) return 'bg-[var(--bg-tertiary)] text-[var(--text-tertiary)]'
  if (count === total) return 'bg-[var(--accent-win-bg)] text-[var(--accent-win)]'
  if (count >= Math.max(1, total - 1)) return 'bg-[var(--accent-win-bg)] text-[var(--accent-win)]'
  if (count >= Math.ceil(total / 2)) return 'bg-[var(--accent-draw-bg)] text-[var(--accent-draw)]'
  return 'bg-[var(--accent-loss-bg)] text-[var(--accent-loss)]'
}

const ROW_HEIGHT = 60
const VIRTUALIZATION_THRESHOLD = 50

// Mobile tab definitions using ODDS_CATEGORIES
const MOBILE_TABS = ODDS_CATEGORIES.map((cat) => ({
  id: cat.id,
  label: cat.id === 'ms' ? 'MS 1/X/2' : cat.id === 'iyms' ? 'İY/MS' : cat.id === 'au15' ? '1.5 A/Ü' : cat.id === 'au25' ? '2.5 A/Ü' : cat.id === 'kg' ? 'KG' : 'TG',
  fields: cat.fields,
}))

export const MatchOddsTable = ({
  matches,
  totalCategories,
}: {
  matches: OddsTableMatch[]
  totalCategories: number
}) => {
  const parentRef = useRef<HTMLDivElement>(null)
  const useVirtual = matches.length > VIRTUALIZATION_THRESHOLD
  const [activeTab, setActiveTab] = useState('ms')

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: useVirtual,
  })

  const activeTabData = MOBILE_TABS.find((t) => t.id === activeTab) ?? MOBILE_TABS[0]

  const renderRow = (match: OddsTableMatch) => {
    const outcomeKeys = getOutcomeKeys(match)
    return (
      <>
        <td className="px-3 py-2 sticky left-0 z-[5] bg-[var(--bg-secondary)]">
          <div className="flex items-start justify-between gap-3">
            <div>
              <Link href={`/analysis/${match.id}`} className="font-semibold text-[var(--text-primary)] hover:text-[var(--accent-blue)] transition-colors">
                {match.home_team} vs {match.away_team}
              </Link>
              <div className="text-[10px] text-[var(--text-muted)]">{match.league}</div>
            </div>
            <div
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold font-mono ${getMatchBadgeClass(
                match.matchCount,
                totalCategories
              )}`}
            >
              {totalCategories > 0
                ? `${match.matchCount}/${totalCategories}`
                : `${match.matchCount}`}
            </div>
          </div>
          {match.matchedCategoryIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {match.matchedCategoryIds.map((categoryId) => (
                <span key={categoryId} className="rounded-full bg-[var(--accent-blue-bg)] px-2 py-0.5 text-[10px] text-[var(--accent-blue)]">
                  {CATEGORY_LABELS[categoryId] ?? categoryId}
                </span>
              ))}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-2 text-[var(--text-secondary)]" suppressHydrationWarning>
          {formatMatchDateTime(match.match_date, { includeYear: true })}
        </td>
        <td className="px-3 py-2 text-center font-mono text-[11px]">
          <div className="text-[var(--text-primary)]">{match.score_ft ?? '-'}</div>
          {match.score_ht ? (
            <div className="text-[9px] text-[var(--text-muted)]">{`İY: ${match.score_ht}`}</div>
          ) : null}
        </td>
        {ODDS_COLUMNS.map((field) => (
          <td
            key={`${match.id}-${field}`}
            className={`px-3 py-2 text-center font-mono tabular-nums border ${getCellClass(outcomeKeys.has(field))}`}
          >
            {formatOdd(match[field])}
          </td>
        ))}
      </>
    )
  }

  const tableHeader = (
    <thead className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider sticky top-0 z-10">
      <tr>
        <th rowSpan={2} className="px-3 py-2 text-left font-medium sticky left-0 top-0 z-20 bg-[var(--bg-tertiary)]">Maç</th>
        <th rowSpan={2} className="px-3 py-2 text-left font-medium sticky top-0 bg-[var(--bg-tertiary)]">Tarih</th>
        <th rowSpan={2} className="px-3 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">Skor</th>
        {ODDS_GROUPS.map((group) => (
          <th key={group.id} colSpan={group.fields.length} className="px-3 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">
            {group.label}
          </th>
        ))}
      </tr>
      <tr>
        {ODDS_COLUMNS.map((field) => (
          <th key={field} className="px-3 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">
            {ODDS_LABELS[field]}
          </th>
        ))}
      </tr>
    </thead>
  )

  // Mobile table render
  const renderMobileTable = () => (
    <div className="block sm:hidden">
      {/* Mobile tab strip */}
      <div className="flex overflow-x-auto scrollbar-thin border-b border-[var(--border-primary)] bg-[var(--bg-tertiary)]">
        {MOBILE_TABS.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setActiveTab(tab.id)}
            className={`px-3 py-2 min-h-[44px] whitespace-nowrap text-xs font-medium transition-colors ${
              activeTab === tab.id
                ? 'text-[var(--accent-blue)] border-b-2 border-[var(--accent-blue)]'
                : 'text-[var(--text-tertiary)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Mobile simplified table */}
      <div className="overflow-x-auto max-h-[70vh] overflow-y-auto">
        <table className="min-w-full text-xs">
          <thead className="bg-[var(--bg-tertiary)] text-[var(--text-tertiary)] text-xs uppercase tracking-wider sticky top-0 z-10">
            <tr>
              <th className="px-3 py-2 text-left font-medium sticky left-0 top-0 z-20 bg-[var(--bg-tertiary)]">Maç</th>
              <th className="px-2 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">Skor</th>
              {activeTabData.fields.map((field) => (
                <th key={field} className="px-2 py-2 text-center font-medium sticky top-0 bg-[var(--bg-tertiary)]">
                  {ODDS_LABELS[field]}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--border-subtle)]">
            {matches.map((match) => {
              const outcomeKeys = getOutcomeKeys(match)
              return (
                <tr key={match.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
                  <td className="px-3 py-2 sticky left-0 z-[5] bg-[var(--bg-secondary)]">
                    <Link href={`/analysis/${match.id}`} className="font-semibold text-[var(--text-primary)] hover:text-[var(--accent-blue)] transition-colors text-xs">
                      {match.home_team} vs {match.away_team}
                    </Link>
                    <div className="text-[10px] text-[var(--text-muted)] flex items-center gap-1">
                      <span className="truncate max-w-[100px]">{match.league}</span>
                      <span
                        className={`shrink-0 rounded-full px-1.5 py-0.5 text-[9px] font-semibold font-mono ${getMatchBadgeClass(
                          match.matchCount,
                          totalCategories
                        )}`}
                      >
                        {match.matchCount}/{totalCategories}
                      </span>
                    </div>
                    {match.matchedCategoryIds.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {match.matchedCategoryIds.map((categoryId) => (
                          <span key={categoryId} className="rounded-full bg-[var(--accent-blue-bg)] px-1.5 py-0.5 text-[9px] text-[var(--accent-blue)]">
                            {CATEGORY_LABELS[categoryId] ?? categoryId}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-center font-mono text-[11px]">
                    <div className="text-[var(--text-primary)]">{match.score_ft ?? '-'}</div>
                    {match.score_ht ? (
                      <div className="text-[9px] text-[var(--text-muted)]">İY: {match.score_ht}</div>
                    ) : null}
                  </td>
                  {activeTabData.fields.map((field) => (
                    <td
                      key={`${match.id}-${field}`}
                      className={`px-2 py-2 text-center font-mono tabular-nums border ${getCellClass(outcomeKeys.has(field))}`}
                    >
                      {formatOdd(match[field])}
                    </td>
                  ))}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )

  // Desktop renders
  const renderDesktopNonVirtual = () => (
    <div className="hidden sm:block overflow-x-auto overflow-y-auto max-h-[1200px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] card-glow">
      <table className="min-w-full text-xs">
        {tableHeader}
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {matches.map((match) => (
            <tr key={match.id} className="hover:bg-[var(--bg-tertiary)] transition-colors">
              {renderRow(match)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )

  const renderDesktopVirtual = () => (
    <div
      ref={parentRef}
      className="hidden sm:block overflow-x-auto overflow-y-auto max-h-[70vh] sm:max-h-[1200px] rounded-lg border border-[var(--border-primary)] bg-[var(--bg-secondary)] card-glow"
    >
      <table className="min-w-full text-xs">
        {tableHeader}
        <tbody className="divide-y divide-[var(--border-subtle)]">
          {virtualizer.getVirtualItems().length > 0 && (
            <tr style={{ height: virtualizer.getVirtualItems()[0].start }}>
              <td colSpan={3 + ODDS_COLUMNS.length} />
            </tr>
          )}
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const match = matches[virtualRow.index]
            return (
              <tr
                key={match.id}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                className="hover:bg-[var(--bg-tertiary)] transition-colors"
              >
                {renderRow(match)}
              </tr>
            )
          })}
          {virtualizer.getVirtualItems().length > 0 && (
            <tr
              style={{
                height:
                  virtualizer.getTotalSize() -
                  (virtualizer.getVirtualItems().at(-1)?.end ?? 0),
              }}
            >
              <td colSpan={3 + ODDS_COLUMNS.length} />
            </tr>
          )}
        </tbody>
      </table>
    </div>
  )

  return (
    <div className="rounded-lg sm:rounded-none border border-[var(--border-primary)] sm:border-0 bg-[var(--bg-secondary)] sm:bg-transparent overflow-hidden sm:overflow-visible">
      {/* Mobile view */}
      {renderMobileTable()}

      {/* Desktop view */}
      {useVirtual ? renderDesktopVirtual() : renderDesktopNonVirtual()}
    </div>
  )
}
