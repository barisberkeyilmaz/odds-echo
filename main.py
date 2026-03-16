#!/usr/bin/env python3
"""
Mackolik Scraper CLI
Lokal Python üzerinden tüm scraping işlemlerini yönetir.

Kullanım:
    python main.py fill-queue    # Sezonlardan maç linklerini kuyruğa ekle
    python main.py update-fixtures [--days-ahead N]  # Livedata ile fikstur guncele
    python main.py run-worker    # Scraper'ı başlat
    python main.py run-monitoring-worker  # MONITORING maçları takip et
    python main.py run-fast-monitoring    # Yakın maçları hızlı takip et
    python main.py notify-perfect-matches  # Mükemmel eşleşme bildirimleri (Telegram)
    python main.py status        # Kuyruk durumunu göster
    python main.py reset-errors  # Hatalı kayıtları sıfırla
    python main.py create-tables # Tabloları oluştur (weekly_fixtures vb.)
"""

import sys
from config import supabase

def show_status():
    """Kuyruk durumunu gösterir."""
    print("\n📊 KUYRUK DURUMU")
    print("=" * 40)

    # Toplam kayıt
    total = supabase.table("match_queue").select("*", count="exact").execute()
    print(f"Toplam Kayıt: {total.count}")

    # Duruma göre dağılım
    for status in ["PENDING", "SUCCESS", "ERROR", "BAD_DATA", "MONITORING", "PERMANENT_ERROR"]:
        result = supabase.table("match_queue").select("*", count="exact").eq("status", status).execute()
        emoji = {
            "PENDING": "⏳", "SUCCESS": "✅", "ERROR": "❌",
            "BAD_DATA": "⚠️", "MONITORING": "🧭", "PERMANENT_ERROR": "🚫",
        }.get(status, "•")
        print(f"  {emoji} {status}: {result.count}")

    print("=" * 40)

def reset_errors():
    """Hatalı kayıtları PENDING durumuna çeker."""
    print("🔄 Hatalı kayıtlar sıfırlanıyor...")

    result = supabase.table("match_queue").update({
        "status": "PENDING",
        "error_log": None
    }).neq("status", "SUCCESS").execute()

    print(f"✅ {len(result.data)} kayıt sıfırlandı.")

def fill_queue():
    """Sezonlardan maç linklerini kuyruğa ekler (Sadece Geçmiş)."""
    from queue_manager import fill_queue_from_db
    fill_queue_from_db(mode='history')

def update_fixtures():
    from livedata_update_fixtures import run_from_main
    run_from_main(sys.argv[2:])

def repair_queue():
    """Kuyruktaki bozulmuş statüleri onarır."""
    from repair_queue import repair_queue_status
    repair_queue_status()

def run_worker():
    """Scraper worker'ı başlatır."""
    from batch_processor import run_worker as start_worker
    start_worker()

def run_monitoring_worker():
    """MONITORING durumundaki maçları takip eder."""
    from monitoring_worker import run_monitoring_worker as start_worker
    start_worker()

def run_fast_monitoring():
    """Yakın maçları hızlı takip eder (±3h/1h pencere)."""
    from monitoring_worker import run_monitoring_worker
    run_monitoring_worker(window_hours_before=3, window_hours_after=1, include_missing_dates=False)

def notify_perfect_matches():
    """Mükemmel eşleşme bildirimlerini gönderir."""
    from notify_perfect_matches import run_from_main
    run_from_main(sys.argv[2:])

def generate_daily_picks():
    """Günün kuponu üretir (Wilson Score tabanlı)."""
    from generate_daily_picks import run_from_main
    run_from_main(sys.argv[2:])

def create_tables_cmd():
    """Veritabanı tablolarını oluşturur."""
    from create_tables import create_tables
    create_tables()

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\n💡 Örnek: python main.py status")
        sys.exit(0)

    command = sys.argv[1].lower()

    if command == "update-fixtures":
        from livedata_update_fixtures import run_from_main
        run_from_main(sys.argv[2:])  # --date / --days-ahead / --write-db hepsini destekler
        return

    commands = {
        "fill-queue": fill_queue,
        "run-worker": run_worker,
        "run-monitoring-worker": run_monitoring_worker,
        "run-fast-monitoring": run_fast_monitoring,
        "notify-perfect-matches": notify_perfect_matches,
        "status": show_status,
        "reset-errors": reset_errors,
        "repair-queue": repair_queue,
        "generate-daily-picks": generate_daily_picks,
        "create-tables": create_tables_cmd,
    }

    if command in commands:
        commands[command]()
    else:
        print(f"❌ Bilinmeyen komut: {command}")
        print(f"Geçerli komutlar: {', '.join(commands.keys())}")
        sys.exit(1)

if __name__ == "__main__":
    main()
