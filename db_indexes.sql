-- Supabase Dashboard > SQL Editor'da çalıştırılacak index'ler
-- match_queue performansı
CREATE INDEX IF NOT EXISTS idx_match_queue_status ON match_queue(status);
CREATE INDEX IF NOT EXISTS idx_match_queue_status_last_try ON match_queue(status, last_try_at);

-- matches tablosu performansı
CREATE INDEX IF NOT EXISTS idx_matches_match_date ON matches(match_date);
CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
CREATE INDEX IF NOT EXISTS idx_matches_status_score ON matches(status, score_ft) WHERE score_ft IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_date_status ON matches(match_date, status);

-- Oran bazlı sorgular için partial index'ler
CREATE INDEX IF NOT EXISTS idx_matches_ms1 ON matches(ms_1) WHERE ms_1 IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_msx ON matches(ms_x) WHERE ms_x IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_matches_ms2 ON matches(ms_2) WHERE ms_2 IS NOT NULL;

-- retry_count kolonu (eğer yoksa)
ALTER TABLE match_queue ADD COLUMN IF NOT EXISTS retry_count integer DEFAULT 0;
