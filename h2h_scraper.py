"""
Head2Head + Form + İstatistik Scraper
arsiv.mackolik.com/Match/Head2Head.aspx?id={code}&s=1 sayfasını parse eder.
Her parse_* fonksiyonu bağımsızdır — biri başarısız olursa diğerleri etkilenmez.
"""

import re
import json
from scraping_client import fetch_static


def scrape_h2h(match_code: str) -> dict:
    """H2H sayfasını çeker ve parse eder."""
    url = f"https://arsiv.mackolik.com/Match/Head2Head.aspx?id={match_code}&s=1"
    response = fetch_static(url)

    data = {}

    parsers = [
        parse_form,
        parse_standings,
        parse_goal_dist,
        parse_kg_pct,
        parse_au_pct,
        parse_referee,
        parse_h2h_summary,
    ]

    for parser in parsers:
        try:
            result = parser(response)
            if result:
                data.update(result)
        except Exception as e:
            print(f"   H2H parse warning ({parser.__name__}): {e}")

    return data if data else None


def parse_form(response) -> dict:
    """Form Durumu: Son 5 maçın sonuçlarını çeker (G/B/M)."""
    data = {}
    body = str(response.body)

    # Her takımın form tablosu "Form Durumu" başlığı altında
    # Form tablosundaki sonuç ikonlarından çıkar
    # kk-1.gif = Galibiyet, kk-0.gif = Beraberlik, kk-2.gif = Mağlubiyet
    sections = body.split("Form Durumu")

    for i, section in enumerate(sections[1:3], 1):  # İlk 2 form bölümü (ev/deplasman)
        results = []
        icons = re.findall(r'kk-(\d)\.gif', section[:3000])
        for icon in icons[:5]:  # Son 5 maç
            if icon == '1':
                results.append('G')
            elif icon == '0':
                results.append('B')
            elif icon == '2':
                results.append('M')

        form_str = ''.join(results)
        if form_str:
            if i == 1:
                data['form_home'] = form_str
            else:
                data['form_away'] = form_str

    return data if data else None


def parse_standings(response) -> dict:
    """Puan durumundan sıra ve puan bilgisi çeker."""
    data = {}

    # tblStanding tablosu
    table = response.css_first("table#tblStanding")
    if not table:
        return None

    rows = table.css("tr.row")
    # Highlighted (vurgulanan) satırlar takımlardır (background-color: #fff3a5)
    highlighted = []
    for row in rows:
        style = row.attrib.get('style', '')
        if 'fff3a5' in style:
            highlighted.append(row)

    for i, row in enumerate(highlighted[:2]):
        tds = row.css("td")
        if len(tds) >= 5:
            try:
                standing = int(tds[0].text.strip())
                points_td = tds[-2]  # P sütunu
                points_text = points_td.text.strip()
                points = int(points_text) if points_text.isdigit() else None

                if i == 0:
                    data['standing_home'] = standing
                    data['points_home'] = points
                else:
                    data['standing_away'] = standing
                    data['points_away'] = points
            except (ValueError, IndexError):
                pass

    return data if data else None


def parse_goal_dist(response) -> dict:
    """Toplam Gol dağılımını parse eder."""
    data = {}
    body = str(response.body)

    # "Toplam Gol" bölümünü bul
    sections = body.split("Toplam Gol")
    for idx, section in enumerate(sections[1:3], 1):
        dist = {}
        # 0-1, 2-3, 4-5, 6+ satırları
        for label in ['0-1', '2-3', '4-5', '6+']:
            pattern = rf'<b>{re.escape(label)}</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>'
            match = re.search(pattern, section[:2000], re.DOTALL)
            if match:
                dist[label] = {"count": int(match.group(1)), "pct": int(match.group(2))}

        if dist:
            key = 'tg_dist_home' if idx == 1 else 'tg_dist_away'
            data[key] = json.dumps(dist, ensure_ascii=False)

    return data if data else None


def parse_kg_pct(response) -> dict:
    """Karşılıklı Gol yüzdesini parse eder."""
    data = {}
    body = str(response.body)

    sections = body.split("Karşılıklı Gol")
    for idx, section in enumerate(sections[1:3], 1):
        # "Var" satırındaki toplam yüzde
        match = re.search(r'<b>Var</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>', section[:1000], re.DOTALL)
        if match:
            key = 'kg_pct_home' if idx == 1 else 'kg_pct_away'
            data[key] = float(match.group(2))

    return data if data else None


def parse_au_pct(response) -> dict:
    """2.5 Alt/Üst yüzdesini parse eder."""
    data = {}
    body = str(response.body)

    # "2,5 Üst" veya "2.5 Üst" satırını bul
    sections = body.split("2,5 Alt/Üst")
    if len(sections) < 2:
        sections = body.split("2.5 Alt/Üst")

    for idx, section in enumerate(sections[1:3], 1):
        # "Üst" satırındaki toplam yüzde
        match = re.search(r'<b>Üst</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>', section[:1000], re.DOTALL)
        if match:
            key = 'au25_over_pct_home' if idx == 1 else 'au25_over_pct_away'
            data[key] = float(match.group(2))

    return data if data else None


def parse_referee(response) -> dict:
    """Hakem istatistiklerini parse eder."""
    body = str(response.body)

    idx = body.find("Hakem İstatistikleri")
    if idx < 0:
        return None

    section = body[idx:idx+3000]

    # Hakem adı
    name_match = re.search(r'Hakem:\s*.*?<a[^>]*>([^<]+)</a>', section, re.DOTALL)
    referee_name = name_match.group(1).strip() if name_match else None

    # Basit istatistikler: sarı kart ort., kırmızı kart ort., faul ort.
    stats = {"name": referee_name}

    return {"referee_stats": json.dumps(stats, ensure_ascii=False)} if referee_name else None


def parse_h2h_summary(response) -> dict:
    """H2H genel istatistikleri (her iki takımın karşılaştığı maç özeti)."""
    body = str(response.body)

    # md-omparison (sic) tablosundaki maçları say
    section_start = body.find('class="md-omparison"')
    if section_start < 0:
        return None

    section = body[section_start:section_start + 20000]

    # Maç sonuçlarını say
    home_wins = section.count('style="background-color: #D5F5E3"')  # Yeşil = galibiyet
    draws = section.count('style="background-color: #FEF9E7"')  # Sarı = beraberlik
    away_wins = section.count('style="background-color: #FADBD8"')  # Kırmızı = mağlubiyet

    # Toplam maç
    total = len(re.findall(r'<tr class="">', section)) + len(re.findall(r'<tr class="row', section))

    if total == 0:
        return None

    summary = {
        "total": total,
        "home_wins": home_wins,
        "draws": draws,
        "away_wins": away_wins,
    }

    return {"h2h_total": json.dumps(summary, ensure_ascii=False)}
