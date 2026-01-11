import requests
import ast
import time

def fetch_season_matches(season_id, total_weeks=38):
    """API üzerinden bir sezonun tüm maçlarını çeker."""
    print(f"   ↳ Sezon ID {season_id} taranıyor...")
    
    base_url = "https://arsiv.mackolik.com/AjaxHandlers/FixtureHandler.aspx"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://arsiv.mackolik.com/"
    }

    found_matches = []

    for week in range(1, total_weeks + 1):
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