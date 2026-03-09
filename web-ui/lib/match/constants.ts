import type { OddsKey } from './types'

export const ODDS_FIELDS: OddsKey[] = [
  'ms_1',
  'ms_x',
  'ms_2',
  'iyms_11',
  'iyms_1x',
  'iyms_12',
  'iyms_x1',
  'iyms_xx',
  'iyms_x2',
  'iyms_21',
  'iyms_2x',
  'iyms_22',
  'au_15_alt',
  'au_15_ust',
  'au_25_alt',
  'au_25_ust',
  'kg_var',
  'kg_yok',
  'tg_0_1',
  'tg_2_3',
  'tg_4_5',
  'tg_6_plus',
]

export const PRIMARY_ODDS_FIELDS: OddsKey[] = ['ms_1', 'ms_x', 'ms_2']

export const MATCH_CORE_FIELDS = [
  'id',
  'home_team',
  'away_team',
  'match_date',
  'league',
  'league_display',
  'league_country',
  'season',
] as const

export const SCORE_FIELDS = ['score_ht', 'score_ft'] as const

export type OddsCategory = {
  id: string
  label: string
  fields: OddsKey[]
}

export const ODDS_CATEGORIES: OddsCategory[] = [
  {
    id: 'ms',
    label: 'MS 1/X/2',
    fields: ['ms_1', 'ms_x', 'ms_2'],
  },
  {
    id: 'iyms',
    label: 'İY/MS',
    fields: [
      'iyms_11',
      'iyms_1x',
      'iyms_12',
      'iyms_x1',
      'iyms_xx',
      'iyms_x2',
      'iyms_21',
      'iyms_2x',
      'iyms_22',
    ],
  },
  {
    id: 'au15',
    label: '1.5 Alt/Üst',
    fields: ['au_15_alt', 'au_15_ust'],
  },
  {
    id: 'au25',
    label: '2.5 Alt/Üst',
    fields: ['au_25_alt', 'au_25_ust'],
  },
  {
    id: 'kg',
    label: 'Karşılıklı Gol',
    fields: ['kg_var', 'kg_yok'],
  },
  {
    id: 'tg',
    label: 'Toplam Gol',
    fields: ['tg_0_1', 'tg_2_3', 'tg_4_5', 'tg_6_plus'],
  },
]

export const CATEGORY_LABELS = ODDS_CATEGORIES.reduce<Record<string, string>>((acc, category) => {
  acc[category.id] = category.label
  return acc
}, {})
