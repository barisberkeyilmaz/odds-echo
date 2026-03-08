"use client"

import { useRef } from 'react'
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
  isHit ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : 'border-gray-100 bg-white text-gray-700'

const getMatchBadgeClass = (count: number, total: number) => {
  if (total === 0) return 'bg-gray-100 text-gray-600'
  if (count === total) return 'bg-emerald-100 text-emerald-700'
  if (count >= Math.max(1, total - 1)) return 'bg-green-100 text-green-700'
  if (count >= Math.ceil(total / 2)) return 'bg-yellow-100 text-yellow-700'
  return 'bg-orange-100 text-orange-700'
}

const ROW_HEIGHT = 60
const VIRTUALIZATION_THRESHOLD = 50

export const MatchOddsTable = ({
  matches,
  totalCategories,
}: {
  matches: OddsTableMatch[]
  totalCategories: number
}) => {
  const parentRef = useRef<HTMLDivElement>(null)
  const useVirtual = matches.length > VIRTUALIZATION_THRESHOLD

  const virtualizer = useVirtualizer({
    count: matches.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 10,
    enabled: useVirtual,
  })

  const renderRow = (match: OddsTableMatch) => {
    const outcomeKeys = getOutcomeKeys(match)
    return (
      <>
        <td className="px-3 py-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-gray-900">
                {match.home_team} vs {match.away_team}
              </div>
              <div className="text-[10px] text-gray-400">{match.league}</div>
            </div>
            <div
              className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[10px] font-semibold ${getMatchBadgeClass(
                match.matchCount,
                totalCategories
              )}`}
            >
              {totalCategories > 0
                ? `${match.matchCount}/${totalCategories} eşleşme`
                : `${match.matchCount} eşleşme`}
            </div>
          </div>
          {match.matchedCategoryIds.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-1">
              {match.matchedCategoryIds.map((categoryId) => (
                <span key={categoryId} className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-gray-500">
                  {CATEGORY_LABELS[categoryId] ?? categoryId}
                </span>
              ))}
            </div>
          ) : null}
        </td>
        <td className="px-3 py-3" suppressHydrationWarning>
          {formatMatchDateTime(match.match_date, { includeYear: true })}
        </td>
        <td className="px-3 py-3 text-center">
          <div>{match.score_ft ?? '-'}</div>
          {match.score_ht ? (
            <div className="text-[10px] text-gray-400">{`İY: ${match.score_ht}`}</div>
          ) : null}
        </td>
        {ODDS_COLUMNS.map((field) => (
          <td
            key={`${match.id}-${field}`}
            className={`px-3 py-3 text-center font-mono border ${getCellClass(outcomeKeys.has(field))}`}
          >
            {formatOdd(match[field])}
          </td>
        ))}
      </>
    )
  }

  const tableHeader = (
    <thead className="bg-gray-50 text-gray-500 sticky top-0 z-10">
      <tr>
        <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Maç</th>
        <th rowSpan={2} className="px-3 py-3 text-left font-semibold">Tarih</th>
        <th rowSpan={2} className="px-3 py-3 text-center font-semibold">Skor</th>
        {ODDS_GROUPS.map((group) => (
          <th key={group.id} colSpan={group.fields.length} className="px-3 py-2 text-center font-semibold">
            {group.label}
          </th>
        ))}
      </tr>
      <tr>
        {ODDS_COLUMNS.map((field) => (
          <th key={field} className="px-3 py-2 text-center font-semibold">
            {ODDS_LABELS[field]}
          </th>
        ))}
      </tr>
    </thead>
  )

  if (!useVirtual) {
    return (
      <div className="overflow-x-auto rounded-xl border border-gray-100 bg-white">
        <table className="min-w-full text-xs">
          {tableHeader}
          <tbody className="divide-y divide-gray-100 text-gray-700">
            {matches.map((match) => (
              <tr key={match.id} className="hover:bg-gray-50">
                {renderRow(match)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  return (
    <div
      ref={parentRef}
      className="overflow-x-auto overflow-y-auto max-h-[600px] rounded-xl border border-gray-100 bg-white"
    >
      <table className="min-w-full text-xs">
        {tableHeader}
        <tbody className="divide-y divide-gray-100 text-gray-700">
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
                className="hover:bg-gray-50"
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
}
