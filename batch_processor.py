import time
import os
from selenium import webdriver
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.chrome.options import Options
from webdriver_manager.chrome import ChromeDriverManager
from config import supabase, CHUNK_SIZE
from scraper_engine import process_full_match

def create_driver():
    opts = Options()
    opts.add_argument('--headless')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-gpu')
    opts.add_argument('--blink-settings=imagesEnabled=false')
    opts.page_load_strategy = 'eager'
    return webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=opts)

def force_cleanup():
    try:
        os.system("pkill -9 -f chrome")
        os.system("rm -rf /tmp/.org.chromium.Chromium.*")
    except: pass

def run_worker():
    print("🔄 Worker başlatılıyor... (Supabase limit: 500/döngü)")
    
    while True:
        # PENDING: İlk kez taranacaklar
        # ERROR: Hata almış tekrar denenecekler
        # MONITORING: Fikstür maçları (sürekli takip)
        # last_try_at ile sırala ki en eski taranan önce gelsin.
        response = supabase.table("match_queue").select("*").neq("status", "SUCCESS").order("last_try_at", desc=False).limit(500).execute()
        queue = response.data
        
        if not queue:
            print("✅ Tüm kuyruk tamamlanmış! (İşlenecek maç kalmadı)")
            break

        print(f"\n🚀 Çekilen Maç Sayısı: {len(queue)} (Paket Boyutu: {CHUNK_SIZE})")
        
        for i in range(0, len(queue), CHUNK_SIZE):
            chunk = queue[i : i + CHUNK_SIZE]
            print(f"   📦 Alt Paket [{i+1}-{min(i+CHUNK_SIZE, len(queue))}] işleniyor...")
            
            force_cleanup()
            driver = create_driver()
            
            for item in chunk:
                try:
                    status, error = process_full_match(item['match_url'], driver)
                    
                    # Kuyruğu güncelle
                    supabase.table("match_queue").update({
                        "status": status,
                        "error_log": error,
                        "last_try_at": "now()"
                    }).eq("match_code", item['match_code']).execute()
                    
                except Exception as e:
                    print(f"      ⚠️ Hata: {e}")
                    supabase.table("match_queue").update({
                        "status": "ERROR",
                        "error_log": str(e)
                    }).eq("match_code", item['match_code']).execute()
                    
                    # Kritik hata olursa driver yenile
                    try:
                        driver.quit()
                        driver = create_driver()
                    except: pass
                
                time.sleep(0.5)
                
            try: driver.quit()
            except: pass
            time.sleep(1)

if __name__ == "__main__":
    run_worker()
