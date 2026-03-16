import time
from datetime import datetime, timezone

from config import supabase
from scraping_client import create_browser, close_browser
from scraper_engine import process_full_match

def run_worker():
    print("🔄 Worker başlatılıyor... (Supabase limit: 500/döngü)")

    while True:
        response = supabase.table("match_queue").select("*").neq("status", "SUCCESS").neq("status", "PERMANENT_ERROR").order("last_try_at", desc=False).limit(500).execute()
        queue = response.data

        if not queue:
            print("✅ Tüm kuyruk tamamlanmış! (İşlenecek maç kalmadı)")
            break

        print(f"\n🚀 Çekilen Maç Sayısı: {len(queue)}")

        browser = create_browser()
        page = browser.new_page()

        for item in queue:
            try:
                status, error = process_full_match(item['match_url'], page)

                supabase.table("match_queue").update({
                    "status": status,
                    "error_log": error,
                    "last_try_at": datetime.now(timezone.utc).isoformat()
                }).eq("match_code", item['match_code']).execute()

            except Exception as e:
                print(f"      ⚠️ Hata: {e}")
                retry_count = (item.get("retry_count") or 0) + 1
                new_status = "PERMANENT_ERROR" if retry_count >= 5 else "ERROR"
                supabase.table("match_queue").update({
                    "status": new_status,
                    "error_log": str(e),
                    "last_try_at": datetime.now(timezone.utc).isoformat(),
                    "retry_count": retry_count,
                }).eq("match_code", item['match_code']).execute()

                # Sayfa çöktüyse yeni sayfa aç
                try:
                    page.close()
                    page = browser.new_page()
                except Exception:
                    # Browser da çöktüyse yeniden başlat
                    try:
                        close_browser(browser)
                    except Exception:
                        pass
                    browser = create_browser()
                    page = browser.new_page()

            time.sleep(0.5)

        close_browser(browser)

if __name__ == "__main__":
    run_worker()
