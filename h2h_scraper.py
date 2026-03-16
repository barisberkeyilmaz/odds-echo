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
    resp = fetch_static(url)
    body = str(resp.html_content)

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
            result = parser(body)
            if result:
                data.update(result)
        except Exception as e:
            print(f"   H2H parse warning ({parser.__name__}): {e}")

    return data if data else None


def _get_team_names(body: str) -> tuple:
    """Sayfa başlıklarından ev sahibi ve deplasman takım isimlerini çıkarır."""
    matches = re.findall(r'([^<>]+?)\s*-\s*Form Durumu', body)
    home = matches[0].strip() if len(matches) > 0 else None
    away = matches[1].strip() if len(matches) > 1 else None
    return home, away


def parse_form(body: str) -> dict:
    """Form Durumu: Son maçların sonuçlarını çeker (G/B/M)."""
    data = {}

    # Her takımın form bölümünü "Form Durumu" ile ayır
    sections = body.split("Form Durumu")

    for i, section in enumerate(sections[1:3], 1):
        results = []
        # Her <tr> içindeki kk ikonundan sonucu al
        rows = re.findall(r'<tr class="row[^"]*">(.*?)</tr>', section[:8000], re.DOTALL)
        for row in rows[:5]:
            icon = re.search(r'kk-(\d)\.gif', row)
            if icon:
                code = icon.group(1)
                results.append({'1': 'G', '0': 'B', '2': 'M'}.get(code, '?'))

        form_str = ''.join(results)
        if form_str:
            key = 'form_home' if i == 1 else 'form_away'
            data[key] = form_str

    return data if data else None


def parse_standings(body: str) -> dict:
    """Puan durumundan sıra ve puan bilgisi çeker — takım ismiyle arar."""
    data = {}
    home_name, away_name = _get_team_names(body)
    if not home_name or not away_name:
        return None

    idx = body.find('id="tblStanding"')
    if idx < 0:
        return None

    table_html = body[idx:idx + 8000]
    all_rows = re.findall(r'<tr[^>]*class="row[^"]*"[^>]*>(.*?)</tr>', table_html, re.DOTALL)

    for row in all_rows:
        tds = re.findall(r'<td[^>]*>(.*?)</td>', row, re.DOTALL)
        texts = [re.sub(r'<[^>]+>', '', td).strip() for td in tds]
        row_text = ' '.join(texts)

        target = None
        if home_name in row_text:
            target = 'home'
        elif away_name in row_text:
            target = 'away'

        if target and len(texts) >= 5:
            try:
                standing = int(texts[0]) if texts[0].isdigit() else None
                # Puan sütunu: sondan 2. sütun (O | P | Av yapısı)
                points_text = texts[-2].strip()
                points = int(points_text) if points_text.isdigit() else None
                if standing is not None:
                    data[f'standing_{target}'] = standing
                if points is not None:
                    data[f'points_{target}'] = points
            except (ValueError, IndexError):
                pass

    return data if data else None


def parse_goal_dist(body: str) -> dict:
    """Toplam Gol dağılımını parse eder."""
    data = {}

    sections = body.split("Toplam Gol")
    for idx, section in enumerate(sections[1:3], 1):
        dist = {}
        for label in ['0-1', '2-3', '4-5', '6+']:
            pattern = rf'<b>{re.escape(label)}</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>'
            match = re.search(pattern, section[:2000], re.DOTALL)
            if match:
                dist[label] = {"count": int(match.group(1)), "pct": int(match.group(2))}

        if dist:
            key = 'tg_dist_home' if idx == 1 else 'tg_dist_away'
            data[key] = json.dumps(dist, ensure_ascii=False)

    return data if data else None


def parse_kg_pct(body: str) -> dict:
    """Karşılıklı Gol yüzdesini parse eder."""
    data = {}

    sections = body.split("Karşılıklı Gol")
    for idx, section in enumerate(sections[1:3], 1):
        match = re.search(r'<b>Var</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>', section[:1000], re.DOTALL)
        if match:
            key = 'kg_pct_home' if idx == 1 else 'kg_pct_away'
            data[key] = float(match.group(2))

    return data if data else None


def parse_au_pct(body: str) -> dict:
    """2,5 Alt/Üst yüzdesini parse eder.

    Sayfa yapısı: "Crystal Palace - 2,5 Altı / Üstü" başlığı altında tablo var.
    Tablodaki Üst satırının toplam yüzdesi.
    """
    data = {}

    # "2,5 Altı / Üstü" bölümlerini bul
    sections = body.split("2,5 Altı / Üstü")
    if len(sections) < 2:
        sections = body.split("2,5 Alt/Üst")
    if len(sections) < 2:
        sections = body.split("2.5 Alt/Üst")

    for idx, section in enumerate(sections[1:3], 1):
        match = re.search(r'<b>Üst</b>.*?<td>\s*(\d+)\s*</td>\s*<td>\s*%(\d+)\s*</td>', section[:2000], re.DOTALL)
        if match:
            key = 'au25_over_pct_home' if idx == 1 else 'au25_over_pct_away'
            data[key] = float(match.group(2))

    return data if data else None


def parse_referee(body: str) -> dict:
    """Hakem istatistiklerini parse eder."""
    idx = body.find("Hakem İstatistikleri")
    if idx < 0:
        return None

    section = body[idx:idx + 3000]
    name_match = re.search(r'Hakem:\s*.*?<a[^>]*>([^<]+)</a>', section, re.DOTALL)
    referee_name = name_match.group(1).strip() if name_match else None

    if not referee_name:
        return None

    stats = {"name": referee_name}
    return {"referee_stats": json.dumps(stats, ensure_ascii=False)}


def parse_h2h_summary(body: str) -> dict:
    """H2H genel istatistikleri — iki takım arası geçmiş maçlar."""
    section_start = body.find('class="md-omparison"')
    if section_start < 0:
        return None

    section = body[section_start:section_start + 20000]

    # Maç skorlarını bul: <b>skor</b> pattern'i
    scores = re.findall(r'<b>(\d+)\s*-\s*(\d+)</b>', section)
    if not scores:
        return None

    home_name, away_name = _get_team_names(body)

    # Her maç satırından ev sahibi takımı ve skoru çıkar
    home_wins = 0
    away_wins = 0
    draws = 0

    # Satır pattern: takım ismi ... <b>skor</b> ... takım ismi
    rows = re.findall(
        r'<td[^>]*align="right"[^>]*class="[^"]*"[^>]*>([^<]+)</td>.*?<b>(\d+)\s*-\s*(\d+)</b>',
        section, re.DOTALL
    )

    for row_home_team, h_goals, a_goals in rows:
        h = int(h_goals)
        a = int(a_goals)
        row_home = row_home_team.strip()

        if h > a:
            # Satırdaki ev sahibi kazandı
            if home_name and home_name in row_home:
                home_wins += 1
            else:
                away_wins += 1
        elif a > h:
            if home_name and home_name in row_home:
                away_wins += 1
            else:
                home_wins += 1
        else:
            draws += 1

    total = home_wins + away_wins + draws
    if total == 0:
        return None

    summary = {
        "total": total,
        "home_wins": home_wins,
        "draws": draws,
        "away_wins": away_wins,
    }

    return {"h2h_total": json.dumps(summary, ensure_ascii=False)}
