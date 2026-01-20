# 🦅 Odds Scrape (Mackolik)

Bu proje, Mackolik arşiv sisteminden geçmiş futbol maçlarının verilerini ve bahis oranlarını toplamak için geliştirilmiş, **Supabase** destekli bir Python otomasyon aracıdır.

Proje, Google Colab ortamından tamamen **lokal Python ortamına** taşınmış ve modüler hale getirilmiştir.

## 📁 Proje Yapısı

*   **`main.py`**: Projenin ana kontrol merkezi (CLI). Tüm komutlar buradan verilir.
*   **`scraper_engine.py`**: Maç detaylarını ve oranları çeken ana motor. (Selenium & BS4)
*   **`batch_processor.py`**: Kuyruktaki maçları sırayla işleyen, hataları yöneten ve sonsuz döngüde çalışan worker.
*   **`queue_manager.py`**: Sezon ve lig bilgilerine göre fikstürü tarayıp maçları kuyruğa ekler.
*   **`config.py`**: Veritabanı ve ortam değişkenleri ayarları.

## 🚀 Kurulum

1.  **Gereksinimleri Yükleyin:**
    Python 3.9+ gereklidir. Gerekli kütüphaneleri yükleyin:
    ```bash
    pip3 install -r requirements.txt
    ```

2.  **Ortam Değişkenlerini Ayarlayın:**
    Root dizininde bir `.env` dosyası oluşturun ve aşağıdaki bilgileri girin:
    ```env
    SUPABASE_URL="https://your-project-id.supabase.co"
    SUPABASE_KEY="your-service-role-key"
    CHUNK_SIZE=20
    ```

## 🛠️ Kullanım Komutları

Projeyi yönetmek için terminalde `main.py` dosyasını argümanlarla çalıştırın.

### 1. Durum Kontrolü
Sistemdeki kuyruk durumunu, işlenen ve bekleyen maç sayılarını gösterir.
```bash
python3 main.py status
```

### 2. Kuyruğu Doldurma (Fill Queue)
`seasons` tablosunda `is_active = true` olan ligleri tarar ve maç linklerini `match_queue` tablosuna ekler.
```bash
python3 main.py fill-queue
```

### 3. Worker Başlatma (Scraper'ı Çalıştır)
Kuyruktaki (`PENDING` veya `ERROR`) maçları çeker ve işlemeye başlar.
*   Sonsuz döngüde çalışır.
*   Her 500 maçta bir veritabanından yeni görev çeker.
*   Chrome tarayıcısını RAM şişmesine karşı belirli aralıklarla yeniler.
```bash
python3 main.py run-worker
```

### 4. Hataları Resetleme
Hata almış veya `BAD_DATA` olarak işaretlenmiş kayıtları tekrar `PENDING` durumuna çeker.
```bash
python3 main.py reset-errors
```

### 5. Telegram Mükemmel Eşleşme Bildirimi
Günün maçları için **MS 1/X/2 + İY/MS + Toplam Gol** kategorilerinde tam eşleşme yakalanan maçları Telegram'a görsel olarak gönderir.

Önce `.env` içine Telegram bilgilerini ekleyin:
```env
TELEGRAM_BOT_TOKEN="123456:ABCDEF..."
TELEGRAM_CHAT_ID="-1001234567890"
```

Manuel çalıştırmak için:
```bash
python3 main.py notify-perfect-matches
```

Tarih seçmek için:
```bash
python3 main.py notify-perfect-matches --date 2025-01-20
```

Cron örneği (her gün 17:00):
```bash
0 17 * * * cd /Users/barisberkeyilmaz/Projects/odds-scrape/odds-scrape-mackolik && /usr/bin/python3 main.py notify-perfect-matches
```

## 📊 Veri Kalitesi ve Hata Yönetimi

*   **BAD_DATA**: Eğer bir maçın ev sahibi, deplasman, lig, sezon, maç sonu skoru veya ilk yarı skoru eksikse, o kayıt `BAD_DATA` olarak işaretlenir.
*   **Oranlar**: Oranlar dinamik olarak JS fonksiyonlarından çekilir. "Maç Sonucu", "2.5 Alt/Üst" vb. marketler tam eşleşme ile kaydedilir.

## 📝 Notlar

*   Scraper çalışırken bir Chrome penceresi açılabilir (Headless mod opsiyoneldir).
*   Proje `Ctrl+C` ile güvenli bir şekilde durdurulabilir.
