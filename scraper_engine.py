import re
import ast
import time
import copy
from datetime import datetime
from bs4 import BeautifulSoup
from selenium import webdriver
from urllib.parse import urlparse, parse_qs
from config import supabase

def clean_odd(value):
    if not value or value == '-' or value == '': return None
    try: return float(value.replace(',', '.'))
    except Exception: return None

def parse_date(date_str):
    try:
        clean_str = date_str.replace('Tarih :', '').strip()
        dt_obj = datetime.strptime(clean_str, '%d.%m.%Y %H:%M')
        return dt_obj.strftime('%Y-%m-%d %H:%M:%S')
    except Exception: return None

def process_full_match(match_url, driver):
    """Tek bir maçı işleyen ana fonksiyon"""
    print(f"   🌍 {match_url}")
    driver.get(match_url)
    
    # Sayfanın tam yüklenmesi ve JS'in çalışması için bekle
    time.sleep(2)
    soup = BeautifulSoup(driver.page_source, 'html.parser')
    
    # 1. Kod Çözümleme
    match_code = "0"
    try:
        parsed = urlparse(match_url)
        qs = parse_qs(parsed.query)
        match_code = qs['id'][0] if 'id' in qs else match_url.lower().split('/mac/')[1].split('/')[0]
    except Exception: match_code = str(int(time.time()))

    # 2. Metadata
    match_info = {"league": None, "season": None, "match_date": None}
    info_div = soup.find("div", class_="match-info-wrapper-top")
    if info_div:
        s_div = info_div.find("div", class_="match-info-wrapper-season")
        if s_div:
            txt = s_div.get_text(strip=True)
            rgx = re.search(r'(\d{4}/\d{4})', txt)
            if rgx:
                match_info["season"] = rgx.group(1)
                match_info["league"] = txt.replace(rgx.group(1), "").strip()
            else: match_info["league"] = txt
        
        d_div = info_div.find("div", class_="match-info-date")
        if d_div: match_info["match_date"] = parse_date(d_div.get_text(strip=True))

    # 3. Skorlar & Durum
    score_ft, score_ht, status = None, None, "Bilinmiyor"
    try:
        st_div = soup.find("div", id="dvStatusText") or soup.find("div", class_="match-time")
        if st_div: status = st_div.get_text(strip=True)
        
        ft_div = soup.find("div", id="dvScoreText") or soup.find("div", class_="match-score")
        if ft_div: score_ft = ft_div.get_text(strip=True)

        ht_div = soup.find("div", id="dvHTScoreText")
        if not ht_div:
            # Fallback: hf-match-score class'ı birden fazla elementte olabilir, skor pattern'i olanı bul
            for div in soup.find_all("div", class_="hf-match-score"):
                txt = div.get_text(strip=True)
                if re.search(r'\d+\s*[-:]\s*\d+', txt):  # Skor pattern'i: "1 - 0" veya "1:0"
                    ht_div = div
                    break
        if ht_div:
            raw = ht_div.get_text(strip=True)
            # Regex ile skoru çek: "İY : 2 - 0" -> "2 - 0"
            score_match = re.search(r'(\d+)\s*[-:]\s*(\d+)', raw)
            if score_match:
                score_ht = f"{score_match.group(1)} - {score_match.group(2)}"
    except Exception: pass

    # 4. İY Skor Fallback
    if (not score_ht) and match_code != "0":
        try:
            driver.get(f"https://arsiv.mackolik.com/AjaxHandlers/MatchHandler.aspx?command=header&id={match_code}")
            msoup = BeautifulSoup(driver.page_source, 'html.parser')
            # Fallback: Önce ID ile, sonra Class ile ara
            mht = msoup.find("div", id="dvHTScoreText")
            if not mht:
                for div in msoup.find_all("div", class_="hf-match-score"):
                    if re.search(r'\d+\s*[-:]\s*\d+', div.get_text(strip=True)):
                        mht = div
                        break
            
            if mht:
                raw = mht.get_text(strip=True)
                score_match = re.search(r'(\d+)\s*[-:]\s*(\d+)', raw)
                if score_match:
                    score_ht = f"{score_match.group(1)} - {score_match.group(2)}"
        except Exception: pass

    # 5. Takımlar
    home, away = None, None
    try:
        if soup.find("a", class_="left-block-team-name"):
            home = soup.find("a", class_="left-block-team-name").get_text(strip=True)
        if soup.find("a", class_="r-left-block-team-name"):
            away = soup.find("a", class_="r-left-block-team-name").get_text(strip=True)
    except Exception: pass

    row = {
        "match_code": match_code,
        "home_team": home, "away_team": away,
        "league": match_info["league"], "season": match_info["season"],
        "match_date": match_info["match_date"],
        "score_ft": score_ft, "score_ht": score_ht,
        "status": status
    }

    # 6. Oranlar
    bet_boxes = soup.find_all("div", class_="md")
    for box in bet_boxes:
        mname = None
        lnk = box.find("a", href=True)
        
        # Sadece oran dialogu olanları işle
        if not lnk or "openOddsDialog" not in lnk['href']:
            continue

        # Başlığı (Market Adı) JS argümanlarından çek: openOddsDialog('ID', 'BAŞLIK', ...)
        # Bu yöntem HTML/CSS yapısından etkilenmez ve en doğru sonucu verir.
        js_match = re.search(r"openOddsDialog\s*\(\s*['\"].*?['\"]\s*,\s*['\"](.*?)['\"]", lnk['href'])
        if js_match:
            mname = js_match.group(1).replace(',', '.')
        else:
            # Fallback: HTML'den al (eğer Regex başarısız olursa)
            title = box.find("div", class_="detail-title")
            if title: mname = title.get_text(strip=True).replace(',', '.')
        
        if not mname: continue

        # Oran Değerlerini Çek
        rgx = re.search(r"openOddsDialog\((.*?)\)", lnk['href'])
        if rgx:
            # Tüm parametreleri değil, sadece arrayleri çekmeye çalışıyoruz
            arr = re.findall(r"\[.*?\]", rgx.group(1))
            if len(arr) >= 2:
                try:
                    k = ast.literal_eval(arr[0])
                    v = ast.literal_eval(arr[1])
                    d = dict(zip(k, v))

                    # Exact Match ile Market Kontrolleri
                    if mname == "Maç Sonucu":
                        row.update({"ms_1": clean_odd(d.get('1')), "ms_x": clean_odd(d.get('X')), "ms_2": clean_odd(d.get('2'))})
                    elif mname == "Çifte Şans":
                        row.update({"cs_1x": clean_odd(d.get('1-X')), "cs_12": clean_odd(d.get('1-2')), "cs_x2": clean_odd(d.get('X-2'))})
                    elif mname == "İlk Yarı/Maç Sonucu":
                        row.update({
                            "iyms_11": clean_odd(d.get('1/1')), "iyms_1x": clean_odd(d.get('1/X')), "iyms_12": clean_odd(d.get('1/2')),
                            "iyms_x1": clean_odd(d.get('X/1')), "iyms_xx": clean_odd(d.get('X/X')), "iyms_x2": clean_odd(d.get('X/2')),
                            "iyms_21": clean_odd(d.get('2/1')), "iyms_2x": clean_odd(d.get('2/X')), "iyms_22": clean_odd(d.get('2/2'))
                        })
                    elif mname == "1.5 Alt/Üst":
                        row.update({"au_15_alt": clean_odd(d.get('Alt')), "au_15_ust": clean_odd(d.get('Üst'))})
                    elif mname == "2.5 Alt/Üst":
                        row.update({"au_25_alt": clean_odd(d.get('Alt')), "au_25_ust": clean_odd(d.get('Üst'))})
                    elif mname == "Karşılıklı Gol":
                        row.update({"kg_var": clean_odd(d.get('Var')), "kg_yok": clean_odd(d.get('Yok'))})
                    elif mname == "Toplam Gol Aralığı":
                        row.update({
                            "tg_0_1": clean_odd(d.get('0-1 Gol')), "tg_2_3": clean_odd(d.get('2-3 Gol')),
                            "tg_4_5": clean_odd(d.get('4-5 Gol')), "tg_6_plus": clean_odd(d.get('6+ Gol'))
                        })
                except Exception as e:
                    print(f"Odds parse hatası '{mname}': {e}")

    # Kaydet
    # Tek Tablo Stratejisi: Her şeyi 'matches' tablosuna yaz.
    # Statüsü ne olursa olsun (Oynanmış, Oynanacak) fark etmez.
    
    supabase.table("matches").upsert(row, on_conflict="match_code").execute()

    # Kalite Kontrolü ve Yönlendirme (Önce tarihi parse edelim)
    is_future_match = False
    
    if match_info["match_date"]:
        try:
            mdate = datetime.strptime(match_info["match_date"], '%Y-%m-%d %H:%M:%S')
            now = datetime.now()
            if mdate > now: is_future_match = True
        except Exception: pass

    # Kuyruk Yönetimi için Dönüş Değerleri
    
    # Zorunlu alan kontrolü
    missing = []
    if not home: missing.append("home")
    if not away: missing.append("away")
    if not match_info["league"]: missing.append("league")
    if not match_info["season"]: missing.append("season")

    if missing:
        return "BAD_DATA", f"Eksik Veri: {', '.join(missing)}"

    # 1. Eğer maç bitmişse (Skor var ve gelecekte değil) -> SUCCESS
    if not is_future_match and score_ft and score_ht:
        return "SUCCESS", None
    
    # 2. Eğer maç henüz oynanmamışsa -> MONITORING (Takibe devam)
    if is_future_match or (not score_ft):
        return "MONITORING", "Fikstür takibinde"

    # Buraya düşerse: Geçmiş tarihli ama skoru yok.
    return "BAD_DATA", "Geçmiş maç ama skor eksik"