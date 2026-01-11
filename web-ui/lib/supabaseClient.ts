import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_KEY

if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase URL ve Key ortam değişkenlerinde bulunamadı. .env.local dosyasını kontrol edin.')
}

export const supabase = createClient(supabaseUrl, supabaseKey)
