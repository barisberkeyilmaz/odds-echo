#!/usr/bin/env python3
"""
Mackolik Scraper CLI
Lokal Python üzerinden tüm scraping işlemlerini yönetir.

Kullanım:
    python main.py fill-queue    # Sezonlardan maç linklerini kuyruğa ekle
    python main.py run-worker    # Scraper'ı başlat
    python main.py status        # Kuyruk durumunu göster
    python main.py reset-errors  # Hatalı kayıtları sıfırla
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
    for status in ["PENDING", "SUCCESS", "ERROR", "BAD_DATA"]:
        result = supabase.table("match_queue").select("*", count="exact").eq("status", status).execute()
        emoji = {"PENDING": "⏳", "SUCCESS": "✅", "ERROR": "❌", "BAD_DATA": "⚠️"}.get(status, "•")
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
    """Sezonlardan maç linklerini kuyruğa ekler."""
    from queue_manager import fill_queue_from_db
    fill_queue_from_db()

def run_worker():
    """Scraper worker'ı başlatır."""
    from batch_processor import run_worker as start_worker
    start_worker()

def main():
    if len(sys.argv) < 2:
        print(__doc__)
        print("\n💡 Örnek: python main.py status")
        sys.exit(0)
    
    command = sys.argv[1].lower()
    
    commands = {
        "fill-queue": fill_queue,
        "run-worker": run_worker,
        "status": show_status,
        "reset-errors": reset_errors,
    }
    
    if command in commands:
        commands[command]()
    else:
        print(f"❌ Bilinmeyen komut: {command}")
        print(f"Geçerli komutlar: {', '.join(commands.keys())}")
        sys.exit(1)

if __name__ == "__main__":
    main()
