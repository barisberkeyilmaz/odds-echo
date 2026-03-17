import re
import ast
from datetime import datetime
from urllib.parse import urlparse, parse_qs
from config import supabase
from scripts.normalize_leagues import normalize_league
from scraping_client import fetch_page, fetch_static


def get_text(el):
    """Element'ten tüm text'i çeker (nested dahil). Scrapling Adaptor uyumlu."""
    if el is None:
        return ""
    # Önce get_all_text dene (nested text dahil)
    try:
        txt = el.get_all_text()
        if txt and txt.strip():
            return txt.strip()
    except Exception:
        pass
    # Fallback: .text (sadece doğrudan text node)
    try:
        txt = el.text
        if txt and txt.strip() and txt.strip() != "None":
            return txt.strip()
    except Exception:
        pass
    # Son çare: HTML'den tag'ları temizle
    try:
        import re as _re
        html = str(el.html_content) if hasattr(el, 'html_content') else str(el)
        return _re.sub(r'<[^>]+>', '', html).strip()
    except Exception:
        return ""


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

def process_full_match(match_url, page):
    """Tek bir maçı işleyen ana fonksiyon"""
    print(f"   🌍 {match_url}")
    response = fetch_page(match_url, page)

    # 1. Kod Çözümleme
    match_code = "0"
    try:
        parsed = urlparse(match_url)
        qs = parse_qs(parsed.query)
        match_code = qs['id'][0] if 'id' in qs else match_url.lower().split('/mac/')[1].split('/')[0]
    except Exception: match_code = str(int(datetime.now().timestamp()))

    # 2. Metadata
    match_info = {"league": None, "season": None, "match_date": None}
    info_div = response.css_first("div.match-info-wrapper-top")
    if info_div:
        s_div = info_div.css_first("div.match-info-wrapper-season")
        if s_div:
            txt = get_text(s_div)
            rgx = re.search(r'(\d{4}/\d{4})', txt)
            if rgx:
                match_info["season"] = rgx.group(1)
                match_info["league"] = txt.replace(rgx.group(1), "").strip()
            else: match_info["league"] = txt

        d_div = info_div.css_first("div.match-info-date")
        if d_div: match_info["match_date"] = parse_date(get_text(d_div))

    # 3. Skorlar & Durum
    score_ft, score_ht, status = None, None, "Bilinmiyor"
    try:
        st_div = response.css_first("div#dvStatusText") or response.css_first("div.match-time")
        if st_div: status = get_text(st_div)

        ft_div = response.css_first("div#dvScoreText") or response.css_first("div.match-score")
        if ft_div: score_ft = get_text(ft_div)

        ht_div = response.css_first("div#dvHTScoreText")
        if not ht_div:
            for div in response.css("div.hf-match-score"):
                txt = get_text(div)
                if re.search(r'\d+\s*[-:]\s*\d+', txt):
                    ht_div = div
                    break
        if ht_div:
            raw = get_text(ht_div)
            score_match = re.search(r'(\d+)\s*[-:]\s*(\d+)', raw)
            if score_match:
                score_ht = f"{score_match.group(1)} - {score_match.group(2)}"
    except Exception: pass

    # 4. İY Skor Fallback (MatchData JSON endpoint)
    if (not score_ht) and match_code != "0":
        try:
            import requests as _req
            _r = _req.get(
                f"https://arsiv.mackolik.com/Match/MatchData.aspx?t=dtl&id={match_code}&s=0",
                headers={"User-Agent": "Mozilla/5.0", "Referer": "https://arsiv.mackolik.com/"},
                timeout=10,
            )
            if _r.status_code == 200 and _r.text.strip():
                import json as _json
                _data = _json.loads(_r.text)
                _ht_raw = _data.get("d", {}).get("ht", "")
                if _ht_raw:
                    _m = re.search(r'(\d+)\s*[-:]\s*(\d+)', _ht_raw)
                    if _m:
                        score_ht = f"{_m.group(1)} - {_m.group(2)}"
        except Exception: pass

    # 5. Takımlar
    home, away = None, None
    try:
        home_el = response.css_first("a.left-block-team-name")
        if home_el: home = get_text(home_el)
        away_el = response.css_first("a.r-left-block-team-name")
        if away_el: away = get_text(away_el)
    except Exception: pass

    # Lig ismini normalize et
    raw_league = match_info["league"] or ""
    league_display, league_country, _ = normalize_league(raw_league) if raw_league else ("", "", 99)

    row = {
        "match_code": match_code,
        "home_team": home, "away_team": away,
        "league": raw_league, "season": match_info["season"],
        "league_display": league_display or None,
        "league_country": league_country or None,
        "match_date": match_info["match_date"],
        "score_ft": score_ft, "score_ht": score_ht,
        "status": status
    }

    # 6. Oranlar
    # Canlı oran kontrolü: HTML içinde "Canlı Oranlar" metnini ara
    page_html = str(response.html_content) if hasattr(response, 'html_content') else ""
    is_live_odds = bool(re.search(r"Canlı\s*Oranlar", page_html))

    if is_live_odds:
        print(f"   ⚡ Canlı oranlar tespit edildi, oranlar atlanıyor (match_code={match_code})")

    bet_boxes = [] if is_live_odds else response.css("div.md")
    for box in bet_boxes:
        mname = None
        lnk = box.css_first("a[href]")

        if not lnk or "openOddsDialog" not in lnk.attrib.get('href', ''):
            continue

        href = lnk.attrib['href']

        # Başlığı JS argümanlarından çek
        js_match = re.search(r"openOddsDialog\s*\(\s*['\"].*?['\"]\s*,\s*['\"](.*?)['\"]", href)
        if js_match:
            mname = js_match.group(1).replace(',', '.')
        else:
            title = box.css_first("div.detail-title")
            if title: mname = get_text(title).replace(',', '.')

        if not mname: continue

        # Oran Değerlerini Çek
        rgx = re.search(r"openOddsDialog\((.*?)\)", href)
        if rgx:
            arr = re.findall(r"\[.*?\]", rgx.group(1))
            if len(arr) >= 2:
                try:
                    k = ast.literal_eval(arr[0])
                    v = ast.literal_eval(arr[1])
                    d = dict(zip(k, v))

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
    supabase.table("matches").upsert(row, on_conflict="match_code").execute()

    # Kalite Kontrolü — önce future/past belirle, sonra stats/h2h zamanlama
    is_future_match = False
    if match_info["match_date"]:
        try:
            mdate = datetime.strptime(match_info["match_date"], '%Y-%m-%d %H:%M:%S')
            now = datetime.now()
            if mdate > now: is_future_match = True
        except Exception: pass

    # Stats → sadece maç kesin bittikten sonra (status=MS veya tarih+3h geçmiş)
    from utils import is_match_finished
    match_finished = is_match_finished({
        "match_date": match_info["match_date"],
        "score_ft": score_ft,
        "status": status,
    })
    if match_finished:
        try:
            stats = parse_match_stats(response)
            if stats:
                stats["match_code"] = match_code
                supabase.table("match_stats").upsert(stats, on_conflict="match_code").execute()
        except Exception as e:
            print(f"   Stats failed for {match_code}: {e}")

    # H2H → pre-match snapshot'ı koru, üzerine yazma.
    # İlk scrape (maç öncesi) kaydedilir, sonraki çağrılar mevcut kaydı değiştirmez.
    try:
        from h2h_scraper import scrape_h2h
        existing = supabase.table("match_h2h").select("match_code").eq("match_code", match_code).execute()
        if not existing.data:
            h2h_data = scrape_h2h(match_code)
            if h2h_data:
                h2h_data["match_code"] = match_code
                supabase.table("match_h2h").insert(h2h_data).execute()
    except Exception as e:
        print(f"   H2H failed for {match_code}: {e}")

    missing = []
    if not home: missing.append("home")
    if not away: missing.append("away")
    if not match_info["league"]: missing.append("league")
    if not match_info["season"]: missing.append("season")

    if missing:
        return "BAD_DATA", f"Eksik Veri: {', '.join(missing)}"

    if not is_future_match and score_ft and score_ht:
        return "SUCCESS", None

    if is_future_match or (not score_ft):
        return "MONITORING", "Fikstür takibinde"

    return "BAD_DATA", "Geçmiş maç ama skor eksik"


def parse_match_stats(response) -> dict:
    """Maç sayfasındaki istatistik bölümünü parse eder.

    HTML yapısı:
      div.match-statistics-rows (veya match-statistics-rows-2)
        div.team-1-statistics-text → ev sahibi değer
        div.statistics-title-text → istatistik adı
        div.team-2-statistics-text → deplasman değer
    """
    stat_mapping = {
        "Toplam Şut": ("shots_home", "shots_away"),
        "İsabetli Şut": ("shots_on_home", "shots_on_away"),
        "Korner": ("corners_home", "corners_away"),
        "Köşe Vuruşu": ("corners_home", "corners_away"),
        "Topla Oynama": ("possession_home", "possession_away"),
        "Faul": ("fouls_home", "fouls_away"),
        "Fauller": ("fouls_home", "fouls_away"),
        "Ofsayt": ("offsides_home", "offsides_away"),
        "Ofsaytlar": ("offsides_home", "offsides_away"),
    }
    stats = {}

    # Her istatistik satırı match-statistics-rows veya match-statistics-rows-2
    for selector in ["div.match-statistics-rows", "div.match-statistics-rows-2"]:
        for row_el in response.css(selector):
            title_el = row_el.css_first("div.statistics-title-text")
            if not title_el:
                continue
            title = get_text(title_el)

            for stat_name, (home_key, away_key) in stat_mapping.items():
                if stat_name == title:
                    home_el = row_el.css_first("div.team-1-statistics-text")
                    away_el = row_el.css_first("div.team-2-statistics-text")
                    if home_el and away_el:
                        try:
                            h_txt = get_text(home_el).replace('%', '').replace(',', '.').strip()
                            a_txt = get_text(away_el).replace('%', '').replace(',', '.').strip()
                            h_val = float(h_txt)
                            a_val = float(a_txt)
                            # possession FLOAT, diğerleri INT
                            if stat_name != "Topla Oynama":
                                h_val = int(h_val)
                                a_val = int(a_val)
                            stats[home_key] = h_val
                            stats[away_key] = a_val
                        except (ValueError, TypeError):
                            pass
                    break

    return stats if stats else None
