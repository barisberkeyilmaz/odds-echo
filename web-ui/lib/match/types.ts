export type OddsKey =
  | 'ms_1'
  | 'ms_x'
  | 'ms_2'
  | 'iyms_11'
  | 'iyms_1x'
  | 'iyms_12'
  | 'iyms_x1'
  | 'iyms_xx'
  | 'iyms_x2'
  | 'iyms_21'
  | 'iyms_2x'
  | 'iyms_22'
  | 'au_15_alt'
  | 'au_15_ust'
  | 'au_25_alt'
  | 'au_25_ust'
  | 'kg_var'
  | 'kg_yok'
  | 'tg_0_1'
  | 'tg_2_3'
  | 'tg_4_5'
  | 'tg_6_plus'

export type OddsRecord = Record<OddsKey, number | null>

export type MatchCore = {
  id: number
  match_code: string
  home_team: string
  away_team: string
  match_date: string
  league: string
  league_display?: string | null
  league_country?: string | null
  season: string
}

export type Fixture = MatchCore & OddsRecord

export type MatchWithScores = Fixture & {
  score_ht?: string | null
  score_ft?: string | null
}

export type MatchDateGroup<T extends MatchCore> = {
  label: string
  dateKey: string
  matches: T[]
  timestamp: number
}
