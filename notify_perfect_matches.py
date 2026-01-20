import argparse
import math
import os
import re
import tempfile
from pathlib import Path
from datetime import datetime

import requests
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from webdriver_manager.chrome import ChromeDriverManager

from config import supabase

MATCH_CORE_FIELDS = ["id", "home_team", "away_team", "match_date", "league", "season"]
SCORE_FIELDS = ["score_ht", "score_ft"]
ODDS_FIELDS = [
    "ms_1",
    "ms_x",
    "ms_2",
    "iyms_11",
    "iyms_1x",
    "iyms_12",
    "iyms_x1",
    "iyms_xx",
    "iyms_x2",
    "iyms_21",
    "iyms_2x",
    "iyms_22",
    "au_15_alt",
    "au_15_ust",
    "au_25_alt",
    "au_25_ust",
    "kg_var",
    "kg_yok",
    "tg_0_1",
    "tg_2_3",
    "tg_4_5",
    "tg_6_plus",
]

CATEGORIES = [
    {
        "id": "ms",
        "label": "MS 1/X/2",
        "fields": ["ms_1", "ms_x", "ms_2"],
        "outcome_keys": ["ms_1", "ms_x", "ms_2"],
    },
    {
        "id": "iyms",
        "label": "IY/MS",
        "fields": [
            "iyms_11",
            "iyms_1x",
            "iyms_12",
            "iyms_x1",
            "iyms_xx",
            "iyms_x2",
            "iyms_21",
            "iyms_2x",
            "iyms_22",
        ],
        "outcome_keys": [
            "iyms_11",
            "iyms_1x",
            "iyms_12",
            "iyms_x1",
            "iyms_xx",
            "iyms_x2",
            "iyms_21",
            "iyms_2x",
            "iyms_22",
        ],
    },
    {
        "id": "tg",
        "label": "Toplam Gol",
        "fields": ["tg_0_1", "tg_2_3", "tg_4_5", "tg_6_plus"],
        "outcome_keys": ["tg_0_1", "tg_2_3", "tg_4_5", "tg_6_plus"],
    },
]

ODDS_LABELS = {
    "ms_1": "MS 1",
    "ms_x": "MS X",
    "ms_2": "MS 2",
    "iyms_11": "1/1",
    "iyms_1x": "1/X",
    "iyms_12": "1/2",
    "iyms_x1": "X/1",
    "iyms_xx": "X/X",
    "iyms_x2": "X/2",
    "iyms_21": "2/1",
    "iyms_2x": "2/X",
    "iyms_22": "2/2",
    "tg_0_1": "0-1",
    "tg_2_3": "2-3",
    "tg_4_5": "4-5",
    "tg_6_plus": "6+",
}


def _build_select(fields):
    return ", ".join(fields)


def _is_valid_odd(value):
    return isinstance(value, (int, float)) and math.isfinite(value) and value > 0


def _has_at_least_two_primary_odds(record):
    count = 0
    for key in ("ms_1", "ms_x", "ms_2"):
        if _is_valid_odd(record.get(key)):
            count += 1
    return count >= 2


def _is_valid_fixture(record):
    if not record.get("match_date"):
        return False
    if not str(record.get("home_team") or "").strip():
        return False
    if not str(record.get("away_team") or "").strip():
        return False
    if not str(record.get("league") or "").strip():
        return False
    return True


def _parse_score(value):
    if not value:
        return None
    match = re.search(r"(\d+)\s*-\s*(\d+)", str(value))
    if not match:
        return None
    home = int(match.group(1))
    away = int(match.group(2))
    return {"home": home, "away": away}


def _get_result_key(home, away):
    if home > away:
        return "1"
    if home < away:
        return "2"
    return "X"


def _get_outcome_keys(match):
    outcome_keys = set()
    ft = _parse_score(match.get("score_ft"))
    if not ft:
        return outcome_keys

    ft_result = _get_result_key(ft["home"], ft["away"])
    if ft_result == "1":
        outcome_keys.add("ms_1")
    elif ft_result == "X":
        outcome_keys.add("ms_x")
    else:
        outcome_keys.add("ms_2")

    total_goals = ft["home"] + ft["away"]
    if total_goals <= 1:
        outcome_keys.add("tg_0_1")
    elif total_goals <= 3:
        outcome_keys.add("tg_2_3")
    elif total_goals <= 5:
        outcome_keys.add("tg_4_5")
    else:
        outcome_keys.add("tg_6_plus")

    ht = _parse_score(match.get("score_ht"))
    if ht:
        ht_result = _get_result_key(ht["home"], ht["away"])
        iyms_key_map = {
            "1-1": "iyms_11",
            "1-X": "iyms_1x",
            "1-2": "iyms_12",
            "X-1": "iyms_x1",
            "X-X": "iyms_xx",
            "X-2": "iyms_x2",
            "2-1": "iyms_21",
            "2-X": "iyms_2x",
            "2-2": "iyms_22",
        }
        combined_key = f"{ht_result}-{ft_result}"
        iyms_key = iyms_key_map.get(combined_key)
        if iyms_key:
            outcome_keys.add(iyms_key)

    return outcome_keys


def _are_odds_equal(base, candidate, tolerance_abs=0.0, tolerance_pct=0.0):
    if not _is_valid_odd(base) or not _is_valid_odd(candidate):
        return False
    diff = abs(base - candidate)
    return diff <= tolerance_abs or diff <= max(base, candidate) * tolerance_pct


def _is_category_match(base, candidate, fields):
    return all(_are_odds_equal(base.get(field), candidate.get(field)) for field in fields)


def _has_full_category_odds(record, fields):
    return all(_is_valid_odd(record.get(field)) for field in fields)


def _format_match_datetime(value):
    try:
        dt_value = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return str(value)
    return dt_value.strftime("%d.%m.%Y %H:%M")


def _get_date_key(date_value):
    return date_value.strftime("%Y-%m-%d")


def _fetch_fixtures_for_date(date_key):
    fixture_start = f"{date_key}T00:00:00"
    fixture_end = f"{date_key}T23:59:59"
    select_fields = _build_select(MATCH_CORE_FIELDS + SCORE_FIELDS + ODDS_FIELDS)

    response = (
        supabase.table("matches")
        .select(select_fields)
        .gte("match_date", fixture_start)
        .lte("match_date", fixture_end)
        .order("match_date", desc=False)
        .execute()
    )
    records = response.data or []
    return [
        record
        for record in records
        if _is_valid_fixture(record) and _has_at_least_two_primary_odds(record)
    ]


def _fetch_historical_matches(fixture_start):
    select_fields = _build_select(MATCH_CORE_FIELDS + SCORE_FIELDS + ODDS_FIELDS)
    page_size = 1000
    offset = 0
    all_records = []

    while True:
        response = (
            supabase.table("matches")
            .select(select_fields)
            .filter("score_ft", "not.is", "null")
            .lt("match_date", fixture_start)
            .order("match_date", desc=True)
            .range(offset, offset + page_size - 1)
            .execute()
        )
        page = response.data or []
        all_records.extend(page)
        if len(page) < page_size:
            break
        offset += page_size

    return [
        record
        for record in all_records
        if _is_valid_fixture(record) and _has_at_least_two_primary_odds(record)
    ]


def _get_outcome_stats(matches, category):
    counts = {key: 0 for key in category["outcome_keys"]}
    total = 0
    for match in matches:
        outcome_keys = _get_outcome_keys(match)
        for key in category["outcome_keys"]:
            if key in outcome_keys:
                counts[key] += 1
                total += 1
    return counts, total


def _pick_top_outcome(counts):
    if not counts:
        return None
    top_key = max(counts, key=lambda key: counts[key])
    return top_key, counts[top_key]


def _render_html_card(fixture, matches, total_matches, matched_category_ids):
    """Render HTML card for Perfect Match visualization with odds."""
    home_team = fixture.get("home_team") or "-"
    away_team = fixture.get("away_team") or "-"

    raw_date = fixture.get("match_date")
    try:
        dt = datetime.fromisoformat(str(raw_date).replace("Z", "+00:00"))
        match_date_str = dt.strftime("%d.%m.%Y • %H:%M")
    except (ValueError, TypeError):
        match_date_str = str(raw_date)

    league = fixture.get("league") or "Lig"

    category_chips = ""
    for category in CATEGORIES:
        if category["id"] in matched_category_ids:
            category_chips += f"<span class='chip'>{category['label']}</span>"

    odds_sections = ""
    for category in CATEGORIES:
        fields = category["fields"]
        if not any(_is_valid_odd(fixture.get(field)) for field in fields):
            continue
        items = ""
        for field in fields:
            value = fixture.get(field)
            formatted = f"{value:.2f}" if _is_valid_odd(value) else "-"
            items += (
                "<div class='odds-item'>"
                f"<div class='odds-label'>{ODDS_LABELS.get(field, field)}</div>"
                f"<div class='odds-value'>{formatted}</div>"
                "</div>"
            )
        layout_class = "odds-group wide" if category["id"] == "iyms" else "odds-group"
        odds_sections += (
            f"<div class='{layout_class}'>"
            f"<div class='odds-title'>{category['label']}</div>"
            f"<div class='odds-grid'>{items}</div>"
            "</div>"
        )

    if not odds_sections:
        odds_sections = "<div class='odds-empty'>Oran bulunamadi.</div>"

    history_rows = ""
    display_matches = matches[:6]

    for m in display_matches:
        try:
            m_dt = datetime.fromisoformat(str(m.get("match_date")).replace("Z", "+00:00"))
            m_date = m_dt.strftime("%d.%m.%y")
        except (ValueError, TypeError):
            m_date = str(m.get("match_date")).split(" ")[0]

        history_rows += f"""
        <tr>
            <td class="col-date">{m_date}</td>
            <td class="col-match">
                <span class="t-home">{m.get('home_team')}</span>
                <span class="vs">vs</span>
                <span class="t-away">{m.get('away_team')}</span>
            </td>
            <td class="col-ht">{m.get('score_ht') or '-'}</td>
            <td class="col-ft">{m.get('score_ft') or '-'}</td>
        </tr>
        """

    html_content = f"""<!doctype html>
<html lang="tr">
<head>
  <meta charset="utf-8" />
  <link href="https://fonts.googleapis.com/css2?family=Oswald:wght@500;700&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
  <title>Perfect Match Analysis</title>
  <style>
    * {{ box-sizing: border-box; margin: 0; padding: 0; }}

    body {{
      font-family: 'Inter', -apple-system, sans-serif;
      background: radial-gradient(circle at top, #f8fafc 0%, #eef2f7 60%, #e2e8f0 100%);
      color: #0f172a;
      display: flex; justify-content: center; align-items: center;
      min-height: 100vh;
      padding: 20px;
    }}

    .container {{
      width: 1040px;
      background: #ffffff;
      border: 1px solid #e2e8f0;
      border-radius: 18px;
      box-shadow: 0 18px 60px rgba(15, 23, 42, 0.12);
      overflow: hidden;
    }}

    .top-bar {{
      height: 6px;
      background: linear-gradient(90deg, #0ea5e9 0%, #22c55e 60%, #f59e0b 100%);
    }}

    .content {{ padding: 36px 44px 40px; }}

    .header {{
        display: flex; justify-content: space-between; align-items: flex-start;
        margin-bottom: 28px; padding-bottom: 18px;
        border-bottom: 1px solid #e2e8f0;
    }}
    .brand {{ display: flex; align-items: center; gap: 12px; }}
    .brand-logo {{
        width: 10px; height: 36px;
        background: linear-gradient(180deg, #0ea5e9 0%, #2563eb 100%);
        border-radius: 4px;
    }}
    .brand-text {{
        font-family: 'Oswald', sans-serif;
        font-size: 20px; font-weight: 700;
        text-transform: uppercase; letter-spacing: 1.2px;
        color: #0f172a;
    }}
    .match-meta {{ text-align: right; }}
    .date-badge {{ color: #0f172a; font-weight: 600; font-size: 14px; margin-bottom: 4px; }}
    .league-badge {{
        font-size: 12px; color: #0ea5e9; font-weight: 600;
        text-transform: uppercase; letter-spacing: 0.5px;
    }}

    .matchup {{
        display: grid; grid-template-columns: 1fr auto 1fr;
        align-items: center; gap: 18px;
        margin-bottom: 22px; padding: 16px 0 20px;
    }}
    .team {{
        font-family: 'Oswald', sans-serif;
        font-size: 32px; font-weight: 700;
        line-height: 1.1; text-transform: uppercase;
        color: #0f172a;
    }}
    .team.home {{ text-align: right; }}
    .team.away {{ text-align: left; }}

    .vs-divider {{
        display: flex; flex-direction: column; align-items: center; gap: 8px;
    }}
    .vs-line {{ width: 1px; height: 22px; background: #e2e8f0; }}
    .vs-text {{
        font-size: 12px; font-weight: 600;
        color: #94a3b8; letter-spacing: 1px;
    }}

    .chips {{
        display: flex; flex-wrap: wrap; gap: 8px;
        margin-bottom: 22px;
    }}
    .chip {{
        padding: 6px 10px; border-radius: 999px;
        background: #f0f9ff; color: #0ea5e9;
        font-size: 11px; font-weight: 600;
        border: 1px solid #bae6fd;
        text-transform: uppercase; letter-spacing: 0.4px;
    }}

    .odds-section {{
        margin-bottom: 26px;
    }}
    .section-title {{
        font-size: 12px; text-transform: uppercase; color: #64748b;
        font-weight: 700; letter-spacing: 0.6px;
        margin-bottom: 12px;
    }}
    .odds-sections {{
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 14px;
    }}
    .odds-group {{
        background: #f8fafc;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        padding: 14px 16px 16px;
    }}
    .odds-group.wide {{
        grid-column: span 2;
    }}
    .odds-title {{
        font-size: 12px; font-weight: 700; color: #0f172a;
        margin-bottom: 10px;
    }}
    .odds-grid {{
        display: grid; grid-template-columns: repeat(3, minmax(0, 1fr));
        gap: 8px;
    }}
    .odds-item {{
        background: #ffffff;
        border: 1px solid #e2e8f0;
        border-radius: 10px;
        padding: 8px 10px;
        text-align: center;
    }}
    .odds-label {{
        font-size: 10px; color: #94a3b8; margin-bottom: 4px;
    }}
    .odds-value {{
        font-size: 12px; font-weight: 700; color: #0f172a;
    }}
    .odds-empty {{
        padding: 14px 16px;
        background: #fff7ed; border: 1px solid #fed7aa; border-radius: 12px;
        color: #c2410c; font-size: 12px; font-weight: 600;
        grid-column: span 2;
    }}

    .history-container {{
        background: #ffffff;
        border-radius: 12px;
        border: 1px solid #e2e8f0;
        padding: 20px 24px;
    }}
    .hist-title {{
        font-size: 12px; text-transform: uppercase; color: #64748b;
        font-weight: 700; letter-spacing: 0.8px;
        margin-bottom: 16px; display: flex; justify-content: space-between; align-items: center;
        padding-bottom: 12px; border-bottom: 2px solid #0ea5e9;
    }}
    .hist-title span.count {{
        color: #ffffff; background: #0ea5e9;
        padding: 5px 12px; border-radius: 999px;
        font-size: 11px; font-weight: 700; letter-spacing: 0.5px;
    }}

    table {{ width: 100%; border-collapse: collapse; font-size: 13px; }}
    th {{
        text-align: left; color: #94a3b8; font-weight: 700;
        font-size: 11px; padding-bottom: 12px; text-transform: uppercase; letter-spacing: 0.5px;
    }}
    td {{
        padding: 12px 0; border-bottom: 1px solid #e2e8f0;
        color: #475569; vertical-align: middle;
    }}
    tr:last-child td {{ border-bottom: none; }}

    .col-date {{ width: 14%; color: #94a3b8; font-family: 'SF Mono', monospace; font-size: 11px; }}
    .col-match {{ width: 62%; font-weight: 600; font-size: 13px; }}
    .t-home {{ color: #0f172a; font-weight: 700; }}
    .t-away {{ color: #0f172a; font-weight: 700; }}
    .vs {{ color: #94a3b8; margin: 0 6px; font-size: 10px; font-weight: 600; }}
    .col-ht {{ width: 12%; color: #64748b; font-size: 12px; text-align: center; font-family: 'SF Mono', monospace; }}
    .col-ft {{ width: 12%; color: #16a34a; font-size: 13px; font-weight: 700; text-align: center; font-family: 'SF Mono', monospace; }}

    .footer {{
        margin-top: 22px; display: flex; justify-content: space-between; align-items: center;
        color: #94a3b8; font-size: 11px; font-weight: 600;
    }}
    .footer-left {{ display: flex; align-items: center; gap: 8px; }}
    .footer-dot {{ width: 4px; height: 4px; background: #0ea5e9; border-radius: 50%; }}
    .footer-tag {{
        color: #0f172a; font-weight: 700;
        background: #f1f5f9; padding: 6px 12px; border-radius: 999px;
        border: 1px solid #e2e8f0;
    }}
  </style>
</head>
<body>
  <div class="container">
    <div class="top-bar"></div>
    <div class="content">
        <div class="header">
            <div class="brand">
                <div class="brand-logo"></div>
                <div class="brand-text">Perfect Match</div>
            </div>
            <div class="match-meta">
                <div class="date-badge">{match_date_str}</div>
                <div class="league-badge">{league}</div>
            </div>
        </div>

        <div class="matchup">
            <div class="team home">{home_team}</div>
            <div class="vs-divider">
                <div class="vs-line"></div>
                <div class="vs-text">VS</div>
                <div class="vs-line"></div>
            </div>
            <div class="team away">{away_team}</div>
        </div>

        <div class="chips">{category_chips}</div>

        <div class="odds-section">
            <div class="section-title">Mac Oranlari</div>
            <div class="odds-sections">
                {odds_sections}
            </div>
        </div>

        <div class="history-container">
            <div class="hist-title">
                Ayni Oranlarla Acilan Gecmis Maclar
                <span class="count">{total_matches} MAC BULUNDU</span>
            </div>
            <table>
                <thead>
                    <tr>
                        <th class="col-date">TARIH</th>
                        <th class="col-match">MAC</th>
                        <th class="col-ht">IY</th>
                        <th class="col-ft">MS</th>
                    </tr>
                </thead>
                <tbody>
                    {history_rows}
                </tbody>
            </table>
        </div>

        <div class="footer">
            <div class="footer-left">
                <span>Tarihi Oran Analizi</span>
                <div class="footer-dot"></div>
                <span>Model V1</span>
            </div>
            <div class="footer-tag">odds-scrape</div>
        </div>
    </div>
  </div>
</body>
</html>
"""
    return html_content


def _create_screenshot(html_content, output_path):
    with tempfile.TemporaryDirectory() as tmpdir:
        html_path = os.path.join(tmpdir, "card.html")
        with open(html_path, "w", encoding="utf-8") as handle:
            handle.write(html_content)

        options = Options()
        options.add_argument("--headless")
        options.add_argument("--no-sandbox")
        options.add_argument("--disable-dev-shm-usage")
        options.add_argument("--disable-gpu")
        driver = webdriver.Chrome(service=Service(ChromeDriverManager().install()), options=options)

        try:
            driver.set_window_size(1280, 720)
            driver.get(Path(html_path).as_uri())
            height = driver.execute_script("return document.body.scrollHeight") or 720
            driver.set_window_size(1280, min(int(height) + 60, 2000))
            driver.get(Path(html_path).as_uri())
            driver.save_screenshot(output_path)
        finally:
            driver.quit()


def _send_telegram_photo(bot_token, chat_id, image_path, caption):
    url = f"https://api.telegram.org/bot{bot_token}/sendPhoto"
    with open(image_path, "rb") as handle:
        files = {"photo": handle}
        data = {"chat_id": chat_id, "caption": caption}
        response = requests.post(url, data=data, files=files, timeout=30)
    response.raise_for_status()


def _collect_perfect_matches(fixtures, historical):
    matches_to_notify = []
    for fixture in fixtures:
        available_categories = [
            category for category in CATEGORIES if _has_full_category_odds(fixture, category["fields"])
        ]
        if not available_categories:
            continue

        perfect_matches = []
        matched_category_ids = set()
        for candidate in historical:
            if candidate.get("id") == fixture.get("id"):
                continue
            matched_ids = []
            for category in available_categories:
                if not _has_full_category_odds(candidate, category["fields"]):
                    continue
                if _is_category_match(fixture, candidate, category["fields"]):
                    matched_ids.append(category["id"])
            if matched_ids:
                candidate_copy = dict(candidate)
                candidate_copy["_matched_categories"] = matched_ids
                perfect_matches.append(candidate_copy)
                matched_category_ids.update(matched_ids)

        if perfect_matches:
            ordered_ids = [category["id"] for category in CATEGORIES if category["id"] in matched_category_ids]
            matches_to_notify.append((fixture, perfect_matches, ordered_ids))

    return matches_to_notify


def _build_outcome_summary(matches, category_ids=None):
    summary = []
    categories = (
        [category for category in CATEGORIES if category["id"] in category_ids]
        if category_ids
        else CATEGORIES
    )
    for category in categories:
        counts, total = _get_outcome_stats(matches, category)
        top = _pick_top_outcome(counts)
        if top:
            top_key, top_count = top
        else:
            top_key, top_count = None, 0
        summary.append(
            {
                "label": category["label"],
                "total": total,
                "top_key": top_key,
                "top_count": top_count,
            }
        )
    return summary


def _generate_tweet_text(fixture, matches, outcome_summary):
    """Generate ready-to-post tweet text without emojis."""
    home = fixture.get("home_team")
    away = fixture.get("away_team")
    league = fixture.get("league") or "Lig"
    count = len(matches)
    
    # Build outcome lines
    outcome_lines = []
    for item in outcome_summary:
        if item["top_count"] > 0:
            pct = round(item["top_count"] / count * 100)
            label = ODDS_LABELS.get(item["top_key"], item["top_key"])
            outcome_lines.append(f"{item['label']}: {label} (%{pct})")
    
    outcomes_text = "\n".join(f"- {line}" for line in outcome_lines)
    
    tweet = f"""{league}
{home} vs {away}

Tarihi veri tabanindaki 200.000+ mac tarandi.
Bu macla birebir ayni oranlarda acilmis {count} mac bulundu.

Sonuclar:
{outcomes_text}
"""
    
    return tweet.strip()


def run(date_key=None, dry_run=False, max_matches=None):
    today_key = _get_date_key(datetime.now())
    target_key = date_key or today_key
    fixture_start = f"{target_key}T00:00:00"

    fixtures = _fetch_fixtures_for_date(target_key)
    if not fixtures:
        print(f"No fixtures found for {target_key}.")
        return

    historical = _fetch_historical_matches(fixture_start)
    matches_to_notify = _collect_perfect_matches(fixtures, historical)

    if not matches_to_notify:
        print(f"No perfect matches found for {target_key}.")
        return

    bot_token = os.getenv("TELEGRAM_BOT_TOKEN")
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not bot_token or not chat_id:
        raise SystemExit("Missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID in environment.")

    if max_matches:
        matches_to_notify = matches_to_notify[:max_matches]

    for fixture, matches, matched_category_ids in matches_to_notify:
        category_labels = [
            category["label"]
            for category in CATEGORIES
            if category["id"] in matched_category_ids
        ]
        outcome_summary = _build_outcome_summary(matches, matched_category_ids)
        html = _render_html_card(fixture, matches, len(matches), matched_category_ids)
        tweet_text = _generate_tweet_text(fixture, matches, outcome_summary)
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "match.png")
            _create_screenshot(html, output_path)
            if dry_run:
                print(f"DRY RUN:\n{tweet_text}\n")
            else:
                _send_telegram_photo(bot_token, chat_id, output_path, tweet_text)
                print(f"Sent: {fixture.get('home_team')} vs {fixture.get('away_team')}")


def run_from_main(argv):
    parser = argparse.ArgumentParser(description="Send perfect match notifications to Telegram.")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--dry-run", action="store_true", help="Do not send Telegram message.")
    parser.add_argument("--max-matches", type=int, help="Limit number of matches to send.")
    args = parser.parse_args(argv)
    run(date_key=args.date, dry_run=args.dry_run, max_matches=args.max_matches)


if __name__ == "__main__":
    run_from_main(None)
