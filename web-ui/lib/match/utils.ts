import type { Fixture, MatchCore, MatchDateGroup, OddsKey, OddsRecord } from './types'
import { MATCH_CORE_FIELDS, ODDS_FIELDS, PRIMARY_ODDS_FIELDS } from './constants'

export const buildMatchSelect = (extraFields: readonly string[] = []) =>
  [...MATCH_CORE_FIELDS, ...extraFields, ...ODDS_FIELDS].join(', ')

export const isValidOdd = (value: number | null) =>
  typeof value === 'number' && Number.isFinite(value) && value > 0

export const hasCompleteOdds = (record: OddsRecord) => ODDS_FIELDS.every((field) => isValidOdd(record[field]))

export const hasPrimaryOdds = (record: OddsRecord) =>
  PRIMARY_ODDS_FIELDS.every((field) => isValidOdd(record[field]))

const parseScore = (value?: string | null) => {
  if (!value) return null
  const match = value.match(/(\d+)\s*-\s*(\d+)/)
  if (!match) return null
  const home = Number.parseInt(match[1], 10)
  const away = Number.parseInt(match[2], 10)
  if (Number.isNaN(home) || Number.isNaN(away)) return null
  return { home, away }
}

const getResultKey = (home: number, away: number) => {
  if (home > away) return '1'
  if (home < away) return '2'
  return 'X'
}

export const getOutcomeKeys = (match: { score_ft?: string | null; score_ht?: string | null }) => {
  const outcomeKeys = new Set<OddsKey>()
  const ft = parseScore(match.score_ft)
  if (!ft) return outcomeKeys

  const ftResult = getResultKey(ft.home, ft.away)
  if (ftResult === '1') outcomeKeys.add('ms_1')
  if (ftResult === 'X') outcomeKeys.add('ms_x')
  if (ftResult === '2') outcomeKeys.add('ms_2')

  const totalGoals = ft.home + ft.away
  if (totalGoals > 1.5) {
    outcomeKeys.add('au_15_ust')
  } else {
    outcomeKeys.add('au_15_alt')
  }

  if (totalGoals > 2.5) {
    outcomeKeys.add('au_25_ust')
  } else {
    outcomeKeys.add('au_25_alt')
  }

  if (ft.home > 0 && ft.away > 0) {
    outcomeKeys.add('kg_var')
  } else {
    outcomeKeys.add('kg_yok')
  }

  if (totalGoals <= 1) outcomeKeys.add('tg_0_1')
  else if (totalGoals <= 3) outcomeKeys.add('tg_2_3')
  else if (totalGoals <= 5) outcomeKeys.add('tg_4_5')
  else outcomeKeys.add('tg_6_plus')

  const ht = parseScore(match.score_ht)
  if (ht) {
    const htResult = getResultKey(ht.home, ht.away)
    const iymsKeyMap: Record<string, OddsKey> = {
      '1-1': 'iyms_11',
      '1-X': 'iyms_1x',
      '1-2': 'iyms_12',
      'X-1': 'iyms_x1',
      'X-X': 'iyms_xx',
      'X-2': 'iyms_x2',
      '2-1': 'iyms_21',
      '2-X': 'iyms_2x',
      '2-2': 'iyms_22',
    }
    const combinedKey = `${htResult}-${ftResult}`
    const iymsKey = iymsKeyMap[combinedKey]
    if (iymsKey) outcomeKeys.add(iymsKey)
  }

  return outcomeKeys
}

const extractDateKey = (value: string) => {
  const match = value.match(/\d{4}-\d{2}-\d{2}/)
  if (match) return match[0]
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate()
  ).padStart(2, '0')}`
}

export const hasValidMatchCore = (record: MatchCore) => {
  if (!record.match_date) return false
  if (!extractDateKey(record.match_date)) return false
  if (!record.home_team?.trim() || !record.away_team?.trim() || !record.league?.trim()) return false
  return true
}

export const isValidFixture = (record: Fixture) => hasValidMatchCore(record)

export const formatMatchDateHeading = (value: string) =>
  new Date(`${extractDateKey(value)}T00:00:00`).toLocaleDateString('tr-TR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  })

export const formatMatchDateTime = (value: string, options?: { includeYear?: boolean }) => {
  const includeYear = options?.includeYear ?? false
  const formatOptions: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }

  if (includeYear) {
    formatOptions.year = 'numeric'
  }

  return new Date(value).toLocaleString('tr-TR', formatOptions)
}

export const formatOdd = (value: number | null | undefined) =>
  typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-'

export const groupMatchesByLocalDate = <T extends MatchCore>(matches: T[]): MatchDateGroup<T>[] => {
  const grouped = new Map<string, MatchDateGroup<T>>()

  matches.forEach((match) => {
    const dateKey = extractDateKey(match.match_date)
    if (!dateKey) return
    const label = formatMatchDateHeading(dateKey)
    const timestamp = new Date(`${dateKey}T00:00:00`).getTime()
    const entry = grouped.get(dateKey)

    if (entry) {
      entry.matches.push(match)
    } else {
      grouped.set(dateKey, { label, dateKey, matches: [match], timestamp })
    }
  })

  return Array.from(grouped.values()).sort((a, b) => a.timestamp - b.timestamp)
}

export const areOddsSimilar = (
  base: number,
  compare: number,
  toleranceAbs: number,
  tolerancePct: number
) => {
  const diff = Math.abs(base - compare)
  return diff <= toleranceAbs || diff <= Math.max(base, compare) * tolerancePct
}

export const isCategoryMatch = (
  base: OddsRecord,
  candidate: OddsRecord,
  fields: OddsKey[],
  toleranceAbs: number,
  tolerancePct: number
) =>
  fields.every((field) => {
    const baseValue = base[field]
    const candidateValue = candidate[field]

    if (!isValidOdd(baseValue) || !isValidOdd(candidateValue) || baseValue === null || candidateValue === null) return false
    return areOddsSimilar(baseValue, candidateValue, toleranceAbs, tolerancePct)
  })
