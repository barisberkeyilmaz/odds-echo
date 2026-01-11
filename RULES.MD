# 📋 RULES.MD - Project Guidelines & Constraints

Bu dosya, **Mackolik Value Betting Scraper** projesi için geliştirme kurallarını, mimari kararları ve kodlama standartlarını içerir. AI asistanı (Claude), tüm öneri ve kod üretimlerinde bu kurallara sadık kalmalıdır.

## 1. 🛑 PRIME DIRECTIVE (BİRİNCİL KURAL)
**Masterplan Güncelliği:** Herhangi bir mimari değişiklik, veritabanı şema güncellemesi veya yeni bir özellik eklendiğinde; **öncelikle `masterplan.md` dosyası güncellenmelidir.** Kod yazmaya başlamadan önce bu dosyanın projenin güncel durumuyla senkronize olduğundan emin olunmalıdır. Masterplan, projenin tek gerçek kaynağıdır (Single Source of Truth).

## 2. Teknoloji Yığını (Tech Stack)
*   **Dil:** Python 3.x
*   **Veritabanı:** Supabase (PostgreSQL). Bağlantı için `supabase-py` kütüphanesi kullanılmalıdır.
*   **Scraping (Bot):**
    *   **Statik/API İstekleri:** `requests` (Link toplama ve hafif işler için).
    *   **Dinamik/Render:** `selenium` (Chrome WebDriver) + `beautifulsoup4` (Parse işlemi için).
    *   **Yöntem:** "Playwright" veya "Scrapy" önerilmemelidir. Mevcut yapı Selenium üzerine kuruludur.
*   **Ortam:** Kodlar hem Google Colab (Prototip) hem de Local Server/Docker ortamında çalışabilir olmalıdır.

## 3. Mimari Prensipler (Architecture)
Sistem **"Dispatcher - Worker" (Dağıtıcı - İşçi)** modeline göre çalışır:
1.  **Queue System:** Asla direkt link toplayıp o an işlemeyin. Önce `match_queue` tablosuna `PENDING` statüsüyle kaydedin.
2.  **Worker:** Ayrı bir işlem (fonksiyon) kuyruktan verileri çeker ve işler.
3.  **Disposable Driver:** Selenium tarayıcısı uzun süre açık kalmamalıdır. Bellek sızıntılarını (Memory Leak) önlemek için **"Kullan-At"** veya **"Batch/Chunk"** (her 20 maçta bir restart) yöntemi kullanılmalıdır.

## 4. Scraping Kuralları (Scraping Rules)
*   **Veri Bütünlüğü:**
    *   Maç bitmemişse (`MS` değilse), skorlar `NULL` geçilmeli ancak oranlar kaydedilmelidir.
    *   Takım isimleri veya skor "Bilinmiyor" olarak gelirse veritabanında `status` kolonu `BAD_DATA` olarak işaretlenmelidir.
*   **Hata Toleransı:**
    *   `re.split` ile metin ayrıştırırken dikkatli olunmalı (Örn: "1,5 Alt" başlığındaki rakamlar bölünmemeli).
    *   `span` temizliği: Mackolik başlıklarındaki kodları (`<span>02277</span>`) silmek için `.decompose()` veya benzeri bir yöntem kullanılmalıdır.
*   **Yedek Plan (Fallback):**
    *   Ana sayfada İlk Yarı (İY) skoru yoksa, sistem otomatik olarak `AjaxHandlers/MatchHandler.aspx?command=header` uç noktasına gidip skoru oradan almalıdır.
*   **Performans:** Resimleri yüklemeyin (`blink-settings=imagesEnabled=false`). `page_load_strategy = 'eager'` kullanın.

## 5. Veritabanı Kuralları (Database Rules)
*   **Upsert Kullanımı:** Veri eklerken asla sadece `insert` kullanılmamalıdır. Her zaman `match_code` üzerinden çakışma kontrolü yapan `upsert` (Update if exists, Insert if new) metodu kullanılmalıdır.
*   **SQL Schema:** Yeni bir veri alanı gerekiyorsa, önce Supabase SQL kodunu üret, sonra Python kodunu yaz.
*   **Bağlantı:** Veritabanı bağlantısı `try-except` blokları ile korunmalıdır.

## 6. Güvenlik ve Konfigürasyon
*   **Hard-Code Yasak:** API Anahtarları (Supabase Key/URL) asla kodun içine açıkça yazılmamalıdır.
*   **.env Kullanımı:** Tüm hassas veriler ve ayarlar (`SEASON_ID`, `CHUNK_SIZE` vb.) `.env` dosyasından veya ortam değişkenlerinden `os.getenv` ile okunmalıdır.

## 7. Kodlama Standartları
*   **Hata Yönetimi:** Tüm ağ istekleri ve tarayıcı işlemleri `try-except` blokları içinde olmalıdır. Hata durumunda sistem çökmemeli, log basıp bir sonraki öğeye geçmelidir.
*   **Modülerlik:** Kodlar tek bir blok halinde değil, `config`, `harvester`, `scraper`, `manager` gibi mantıksal fonksiyonlara/dosyalara bölünmelidir.
*   **Loglama:** İşlem adımları (Örn: "🌍 Veri çekiliyor...", "✅ Kaydedildi") konsola basılmalıdır.

---