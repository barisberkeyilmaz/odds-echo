# OddsEcho

**Mackolik verilerinden oran bazli mac analiz platformu.**

Gecmis mac oranlarini toplayarak "benzer oranli maclarin gecmiste nasil sonuclandigini" gorsellestirir. Queue tabanli scraping altyapisi ve modern analiz arayuzuyle calisan ucan uca bir sistemdir.

**[Canli Demo &rarr; odds-echo.vercel.app](https://odds-echo.vercel.app)**

![Python](https://img.shields.io/badge/Python-3.x-3776AB?logo=python&logoColor=white)
![Next.js](https://img.shields.io/badge/Next.js-16-000000?logo=next.js&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Supabase](https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?logo=supabase&logoColor=white)
![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?logo=tailwindcss&logoColor=white)
![Selenium](https://img.shields.io/badge/Selenium-Scraping-43B02A?logo=selenium&logoColor=white)

---

## Ozellikler

- **Oran Benzerlik Analizi** — Secilen macin oranlarina yakin gecmis maclari bulur ve sonuc dagilimlarini gosterir
- **Queue Tabanli Scraping** — `match_queue` uzerinden chunk bazli, hataya dayanikli veri toplama
- **Fikstur Takibi** — LiveData kaynagindan otomatik fikstur senkronu ve skor takibi (MONITORING worker)
- **Mukemmel Eslesme** — Tam oran eslesmesi bulunan maclari tespit edip Telegram ile bildirim gonderir
- **Tek Kaynak Tablo** — Fikstur ve gecmis veriler tek `matches` tablosunda birlesik

---

## Mimari

```
Mackolik (Web)
    |
    v
[Selenium Scraper]  <-->  [Supabase / PostgreSQL]  <-->  [Next.js Web UI]
    |                           |
    v                           v
[match_queue]              [matches]
(PENDING/MONITORING)       (tek kaynak tablo)
    |
    v
[Telegram Bildirim]
```

**Scraper (Python):** Mackolik arsiv ve LiveData kaynaklarindan veri toplar, Supabase'e yazar.
**Web UI (Next.js):** Supabase'den okur; oran arama, benzerlik analizi ve mukemmel eslesme dashboard sunar.

---

## Proje Yapisi

```
odds-scrape-mackolik/
├── main.py                      # CLI giris noktasi
├── config.py                    # Supabase baglantisi ve ortam degiskenleri
├── scraper_engine.py            # Tek mac scraping + upsert
├── batch_processor.py           # PENDING/ERROR/MONITORING maclari isleyen worker
├── monitoring_worker.py         # Fikstuleri zaman penceresinde takip eden worker
├── queue_manager.py             # Kuyruk yonetimi
├── link_harvester.py            # Sezon/hafta bazli mac link toplama
├── livedata_update_fixtures.py  # LiveData fikstur senkronu
├── notify_perfect_matches.py    # Telegram gorsel bildirim akisi
├── repair_queue.py              # matches -> match_queue durum senkronu
├── requirements.txt
└── web-ui/                      # Next.js 16 + React 19 + Tailwind CSS 4
    ├── app/
    │   ├── page.tsx             # Fikstur listesi
    │   ├── odds-search/         # Oran arama
    │   ├── match/[id]/          # Benzer mac listesi
    │   ├── analysis/[id]/       # Kategori bazli analiz
    │   └── perfect-match/       # Tam eslesme dashboard
    └── components/
```

---

## Sayfalar

| Sayfa | Aciklama |
|-------|----------|
| [`/`](https://odds-echo.vercel.app) | Tarih bazli fikstur tablosu |
| `/odds-search` | Oran arama ve sonuc dagilimlari |
| `/match/[id]` | Benzer oranlara sahip gecmis maclar |
| `/analysis/[id]` | Kategori bazli analiz dashboard |
| `/perfect-match` | Tam oran eslesmesi dashboard |

---

## Veritabani

**Temel tablolar:**

| Tablo | Amac |
|-------|------|
| `matches` | Tek kaynak tablo — fikstur ve gecmis mac verileri |
| `match_queue` | Scraping kuyrugu ve durum takibi |
| `leagues` | Lig referans bilgileri |
| `seasons` | Sezon referans bilgileri |

**Statusler:**

| Status | Anlam |
|--------|-------|
| `PENDING` | Islenmeyi bekliyor |
| `MONITORING` | Fikstur, skor bekleniyor |
| `SUCCESS` | Basariyla islendi |
| `ERROR` | Hata olustu, tekrar denenebilir |
| `BAD_DATA` | Eksik/gecersiz veri |

---

## Teknoloji Yigini

| Katman | Teknoloji |
|--------|-----------|
| Scraping | Python, Selenium, BeautifulSoup |
| Veritabani | Supabase (PostgreSQL) |
| Backend API | Supabase Client |
| Frontend | Next.js 16, React 19, TypeScript |
| Styling | Tailwind CSS 4 |
| Grafikler | Recharts |
| Bildirim | Telegram Bot API |

---

## Lisans

Bu proje kisisel kullanim amaciyla gelistirilmistir.
