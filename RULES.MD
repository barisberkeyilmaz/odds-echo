# 📋 RULES.MD - Project Guidelines & Constraints

Bu dosya, **OddsEcho** projesi için geliştirme kurallarını, mimari kararları ve kodlama standartlarını içerir. AI asistanı (Claude), tüm öneri ve kod üretimlerinde bu kurallara sadık kalmalıdır.

## 1. 🛑 PRIME DIRECTIVE (BİRİNCİL KURAL)
**Masterplan Güncelliği:** Herhangi bir mimari değişiklik, veritabanı şema güncellemesi veya yeni bir özellik eklendiğinde; **öncelikle `masterplan.md` dosyası güncellenmelidir.** Kod yazmaya başlamadan önce bu dosyanın projenin güncel durumuyla senkronize olduğundan emin olunmalıdır. Masterplan, projenin tek gerçek kaynağıdır (Single Source of Truth).

## 2. Teknoloji Yığını (Tech Stack)
*   **Dil:** Python 3.x
*   **Veritabanı:** Supabase (PostgreSQL). Bağlantı için `supabase-py` kütüphanesi kullanılmalıdır.
*   **Scraping:**
    *   **Browser rendering (oranlar):** Playwright (Chromium, `domcontentloaded` stratejisi) ile sayfa çekimi.
    *   **HTML parse:** Scrapling `Adaptor` (CSS selectors).
    *   **Statik sayfalar / AJAX:** Scrapling `Fetcher` (H2H, MatchHandler fallback vb.).
    *   **API İstekleri:** `requests` (Link toplama ve hafif işler için).
    *   **Yöntem:** Selenium, Playwright doğrudan kullanımı (scrapling aracılığı olmadan), Scrapy önerilmemelidir. Mevcut yapı `scraping_client.py` wrapper'ı üzerine kuruludur.
*   **Ortam:** Kodlar hem Google Colab (Prototip) hem de Local Server/Docker ortamında çalışabilir olmalıdır.

## 3. Mimari Prensipler (Architecture)
Sistem **"Dispatcher - Worker" (Dağıtıcı - İşçi)** modeline göre çalışır:
1.  **Queue System:** Asla direkt link toplayıp o an işlemeyin. Önce `match_queue` tablosuna `PENDING` statüsüyle kaydedin.
2.  **Worker:** Ayrı bir işlem (fonksiyon) kuyruktan verileri çeker ve işler.
3.  **Her istek bağımsızdır.** Playwright browser oturum boyunca açık kalır, ancak driver yönetimi yoktur. Sayfa crash olursa yeni sayfa açılır.

## 4. Scraping Kuralları (Scraping Rules)
*   **Veri Bütünlüğü:**
    *   Maç bitmemişse (`MS` değilse), skorlar `NULL` geçilmeli ancak oranlar kaydedilmelidir.
    *   Takım isimleri veya skor "Bilinmiyor" olarak gelirse veritabanında `status` kolonu `BAD_DATA` olarak işaretlenmelidir.
*   **Hata Toleransı:**
    *   `re.split` ile metin ayrıştırırken dikkatli olunmalı (Örn: "1,5 Alt" başlığındaki rakamlar bölünmemeli).
*   **Yedek Plan (Fallback):**
    *   Ana sayfada İlk Yarı (İY) skoru yoksa, sistem otomatik olarak `AjaxHandlers/MatchHandler.aspx?command=header` uç noktasına gidip skoru oradan almalıdır. Bu istek `fetch_static()` ile yapılır (browser gerektirmez).
*   **Rate Limiting:** İstekler arası 0.5s bekleme süresi korunmalıdır.

## 5. Veritabanı Kuralları (Database Rules)
*   **Upsert Kullanımı:** Veri eklerken asla sadece `insert` kullanılmamalıdır. Her zaman `match_code` üzerinden çakışma kontrolü yapan `upsert` (Update if exists, Insert if new) metodu kullanılmalıdır.
*   **SQL Schema:** Yeni bir veri alanı gerekiyorsa, önce Supabase SQL kodunu üret, sonra Python kodunu yaz.
*   **Bağlantı:** Veritabanı bağlantısı `try-except` blokları ile korunmalıdır.
*   **Stats/H2H bağımsızlığı:** `match_stats` ve `match_h2h` parse hataları ana maç verisini (`matches` tablosu) ETKİLEMEMELİDİR.

## 6. Güvenlik ve Konfigürasyon
*   **Hard-Code Yasak:** API Anahtarları (Supabase Key/URL) asla kodun içine açıkça yazılmamalıdır.
*   **.env Kullanımı:** Tüm hassas veriler ve ayarlar (`SEASON_ID`, `CHUNK_SIZE` vb.) `.env` dosyasından veya ortam değişkenlerinden `os.getenv` ile okunmalıdır.

## 7. Kodlama Standartları
*   **Hata Yönetimi:** Tüm ağ istekleri ve tarayıcı işlemleri `try-except` blokları içinde olmalıdır. Hata durumunda sistem çökmemeli, log basıp bir sonraki öğeye geçmelidir.
*   **Modülerlik:** Kodlar tek bir blok halinde değil, `config`, `scraping_client`, `scraper_engine`, `h2h_scraper`, `batch_processor` gibi mantıksal fonksiyonlara/dosyalara bölünmelidir.
*   **Loglama:** İşlem adımları (Örn: "🌍 Veri çekiliyor...", "✅ Kaydedildi") konsola basılmalıdır.

---
