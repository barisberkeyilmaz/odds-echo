# 🦅 Odds Scrape (Mackolik)

Bu repo, Mackolik arşiv ve LiveData kaynaklarından maç + oran verisi toplayan, Supabase'e yazan ve Next.js arayüzüyle analiz sunan bir sistemdir. Python tarafı scraping ve otomasyonu, `web-ui` ise analiz ekranlarını yönetir.

## Öne Çıkanlar
- Supabase destekli tek kaynak tablo: `matches` (fikstür + geçmiş).
- Queue tabanlı scraping (`match_queue`) + chunk bazlı worker.
- LiveData fikstür senkronu ve `MONITORING` worker akışı.
- Telegram "mükemmel eşleşme" bildirimi (HTML kart + screenshot).
- Next.js UI: fikstür listesi, oran arama, benzer maç, analiz, perfect-match dashboard.

## Proje Yapısı (Özet)
- `main.py`: CLI komutları ve giriş noktası.
- `scraper_engine.py`: Tek maç scraping + upsert.
- `batch_processor.py`: `PENDING/ERROR/MONITORING` maçları işleyen worker.
- `monitoring_worker.py`: Fikstürleri zaman penceresinde takip eden worker.
- `queue_manager.py` + `link_harvester.py`: Sezon/hafta bazlı maç link toplama.
- `livedata_update_fixtures.py`: LiveData fikstür senkronu (date/days-ahead).
- `notify_perfect_matches.py`: Telegram görsel bildirim akışı.
- `repair_queue.py`: `matches` -> `match_queue` durum senkronu.
- `web-ui/`: Next.js arayüzü.
- `migrate_fixtures.py`: Legacy `weekly_fixtures` -> `matches` taşıma (gerekirse).
- `create_tables.py`: Legacy tablo kurulumu (aktif kullanım için değil).

## Kurulum
1) Python bağımlılıkları:
```bash
pip3 install -r requirements.txt
```

2) Root dizinde `.env`:
```env
SUPABASE_URL="https://your-project-id.supabase.co"
SUPABASE_KEY="your-service-role-key"
CHUNK_SIZE=20
```

3) Telegram bildirimleri (opsiyonel):
```env
TELEGRAM_BOT_TOKEN="123456:ABCDEF..."
TELEGRAM_CHAT_ID="-1001234567890"
```

4) Web UI için `web-ui/.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL="https://your-project-id.supabase.co"
NEXT_PUBLIC_SUPABASE_KEY="your-anon-or-service-key"
```

## CLI Komutları
Durum:
```bash
python3 main.py status
```

Geçmiş maç kuyruğu:
```bash
python3 main.py fill-queue
```

LiveData fikstür senkronu (varsayılan dry-run):
```bash
python3 main.py update-fixtures --days-ahead 3
python3 main.py update-fixtures --date 19/01/2026 --write-db
python3 main.py update-fixtures --date 19/01/2026 --status MONITORING --error-log "Manual sync"
```

Worker:
```bash
python3 main.py run-worker
```

Fikstür takip worker:
```bash
python3 main.py run-monitoring-worker
```

Mükemmel eşleşme bildirimi:
```bash
python3 main.py notify-perfect-matches
python3 main.py notify-perfect-matches --date 2026-01-20
python3 main.py notify-perfect-matches --date 2026-01-20 --dry-run --max-matches 3
```

Bakım:
```bash
python3 main.py reset-errors
python3 main.py repair-queue
python3 main.py create-tables  # legacy weekly_fixtures
```

## Akışlar (Kısa)
- **Geçmiş**: `fill-queue` → `match_queue:PENDING` → `run-worker` → `matches` upsert → queue status (`SUCCESS/BAD_DATA/ERROR`).
- **Fikstür**: `update-fixtures` → `match_queue:MONITORING` → `run-monitoring-worker` → skor geldikçe `SUCCESS`.
- **Web UI**: `matches` tablosunu okur; analizler tolerans/filtrelerle çalışır.

## Web UI
Çalıştırma:
```bash
cd web-ui
npm install
npm run dev
```

Sayfalar:
- `/`: Tarih bazlı fikstür tablosu.
- `/odds-search`: Oran arama ve sonuç dağılımları.
- `/match/[id]`: Benzer maç listesi.
- `/analysis/[id]`: Kategori bazlı analiz dashboard.
- `/perfect-match`: Tam eşleşme dashboard.

## Veri Kalitesi ve Statüler
- `match_queue.status`: `PENDING`, `MONITORING`, `SUCCESS`, `ERROR`, `BAD_DATA`.
- `matches.status`: Mackolik kaynaklı durum (`MS`, `Ert`, vb.).
- `BAD_DATA`: ev/deplasman/lig/sezon eksikse veya geçmiş maçta skor yoksa.

## Notlar
- Selenium/Chrome headless çalışır; sistemde Chrome kurulumu gerekir.
- `CHUNK_SIZE` worker yükünü dengeler.
- Python tarafında Supabase için service-role key önerilir.
