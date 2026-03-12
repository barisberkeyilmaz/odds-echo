import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.SUPABASE_URL
const supabaseKey = process.env.SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL ve Key ortam değişkenlerinde bulunamadı. .env.local dosyasını kontrol edin.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)

/**
 * Supabase'in 1000 satır limitini aşmak için batch fetch.
 * Query builder her iterasyonda yeniden oluşturulmalı (mutability sorunu).
 *
 * @param buildQuery - Her batch için taze query oluşturan fonksiyon (.range() EKLEME)
 * @param options.batchSize - Batch boyutu (default: 1000)
 */
export async function fetchAllRows<T = Record<string, unknown>>(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  buildQuery: () => { range: (from: number, to: number) => PromiseLike<{ data: any; error: any }> },
  options?: { batchSize?: number }
): Promise<T[]> {
  const batchSize = options?.batchSize ?? 1000
  const allData: T[] = []
  let offset = 0

  while (true) {
    const { data, error } = await buildQuery().range(offset, offset + batchSize - 1)

    if (error) throw error

    const rows = (data ?? []) as T[]
    allData.push(...rows)

    if (rows.length < batchSize) break
    offset += batchSize
  }

  return allData
}
