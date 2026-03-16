#!/usr/bin/env python3
"""
Mackolik Scraper CLI
Lokal Python üzerinden tüm scraping işlemlerini yönetir.

Kullanım:
    python main.py update-fixtures [--days-ahead N]  # Livedata ile fikstur guncele
    python main.py run-worker    # Scraper'ı başlat
    python main.py run-monitoring-worker  # MONITORING maçları takip et
    python main.py run-fast-monitoring    # Yakın maçları hızlı takip et
    python main.py backfill [--months N]  # Stats + H2H backfill (varsayılan 24 ay)
    python main.py status        # Kuyruk durumunu göster
    python main.py reset-errors  # Hatalı kayıtları sıfırla
    python main.py repair-queue  # Kuyruktaki bozulmuş statüleri onar
    python main.py create-tables # Tabloları oluştur
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

def backfill_data():
    """Stats + H2H backfill. Varsayılan 24 ay, --months ile değiştirilebilir."""
    from backfill import run_backfill
    months = 24
    for arg in sys.argv[2:]:
        if arg.startswith("--months="):
            months = int(arg.split("=")[1])
        elif arg.startswith("--months"):
            idx = sys.argv.index(arg)
            if idx + 1 < len(sys.argv):
                months = int(sys.argv[idx + 1])
    run_backfill(months=months)

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
        "run-worker": run_worker,
        "run-monitoring-worker": run_monitoring_worker,
        "run-fast-monitoring": run_fast_monitoring,
        "backfill": backfill_data,
        "status": show_status,
        "reset-errors": reset_errors,
        "repair-queue": repair_queue,
        "create-tables": create_tables_cmd,
    }

    if command in commands:
        commands[command]()
    else:
        print(f"❌ Bilinmeyen komut: {command}")
        print(f"Geçerli komutlar: update-fixtures, {', '.join(commands.keys())}")
        sys.exit(1)

if __name__ == "__main__":
    main()
