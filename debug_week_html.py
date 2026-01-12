import requests
from bs4 import BeautifulSoup

def debug_content(season_id):
    url = f"https://arsiv.mackolik.com/Standings/Default.aspx?sId={season_id}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    }
    response = requests.get(url, headers=headers, timeout=10)
    soup = BeautifulSoup(response.text, 'html.parser')
    select = soup.select_one('#cboWeek')
    if select:
        print(f"Select found. Options count: {len(select.find_all('option'))}")
        selected = select.select_one('option[selected]')
        if selected:
            print(f"Selected option: {selected}")
        else:
            print("No option with 'selected' attribute found. Printing first 5 options:")
            for opt in select.find_all('option')[:5]:
                print(opt)
    else:
        print("Select #cboWeek NOT found.")

debug_content(70381)
