import requests
import ast
import time
from bs4 import BeautifulSoup

def get_current_week(season_id):
    """Puan durumu sayfasından aktif haftayı çeker."""
    url = f"https://arsiv.mackolik.com/Standings/Default.aspx?sId={season_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    try:
        response = requests.get(url, headers=headers, timeout=10)
        if response.status_code == 200:
            soup = BeautifulSoup(response.text, 'html.parser')
            # Seçili haftayı bul: <option selected="selected" value="18">...</option>
            selected = soup.select_one('#cboWeek option[selected="selected"]')
            if selected:
                print(f"   📅 Tespit edilen güncel hafta: {selected['value']}")
                return int(selected['value'])
    except Exception as e:
        print(f"      ⚠️ Hafta tespiti yapılamadı: {e}")
    
    return None

def fetch_season_matches(season_id, total_weeks=38, target_week=None):
    """API üzerinden bir sezonun maçlarını çeker. target_week verilirse sadece o haftayı çeker."""
    print(f"   ↳ Sezon ID {season_id} taranıyor...")
    
    base_url = "https://arsiv.mackolik.com/AjaxHandlers/FixtureHandler.aspx"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://arsiv.mackolik.com/"
    }

    found_matches = []
    
    # Eğer hedef hafta varsa sadece o haftayı (ve belki bir sonrakini) tara
    # Kullanıcı "ekranda gördüğüm" dediği için, o an seçili hafta ve +1 hafta mantıklı olabilir.
    # Şimdilik sadece hedef hafta ve +1 hafta.
    if target_week:
        weeks_to_scan = [target_week]
        if target_week < total_weeks:
            weeks_to_scan.append(target_week + 1)
        print(f"   🎯 Hedeflenen haftalar: {weeks_to_scan}")
    else:
        weeks_to_scan = range(1, total_weeks + 1)

    for week in weeks_to_scan:
        try:
            params = {"command": "getMatches", "id": season_id, "week": week}
            response = requests.get(base_url, params=params, headers=headers, timeout=10)
            
            if response.status_code == 200 and response.text.strip():
                # Veri temizliği
                raw_data = response.text.replace('null', 'None')
                while ',,' in raw_data: raw_data = raw_data.replace(',,', ',None,')
                
                # Liste hatası varsa düzelt
                raw_data = raw_data.replace('[,', '[None,').replace(',]', ',None]')

                matches_data = ast.literal_eval(raw_data)
                
                for match in matches_data:
                    # Sadece verisi olan satırlar
                    if len(match) > 3:
                        found_matches.append({
                            "id": str(match[0]),
                            "status": match[2], # MS, Ertelenmiş vb.
                            "week": week
                        })
        except Exception as e:
            print(f"      ❌ Hafta {week} hatası: {e}")
        
        time.sleep(0.1) # Sunucu koruması

    return found_matches