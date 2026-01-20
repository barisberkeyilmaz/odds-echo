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


def _render_html_card(fixture, matches, outcome_summary, category_labels):
    match_title = f"{fixture.get('home_team')} - {fixture.get('away_team')}"
    match_time = _format_match_datetime(fixture.get("match_date"))
    league = fixture.get("league") or "-"
    total_matches = len(matches)
    category_text = " + ".join(category_labels) if category_labels else "N/A"

    outcome_rows = ""
    for summary in outcome_summary:
        label = summary["label"]
        if summary["total"] == 0:
            outcome_rows += (
                f"<div class='row'><div class='name'>{label}</div>"
                "<div class='value muted'>No result data</div></div>"
            )
            continue

        top_label = ODDS_LABELS.get(summary["top_key"], summary["top_key"])
        percent = round((summary["top_count"] / summary["total"]) * 100)
        outcome_rows += (
            f"<div class='row'><div class='name'>{label}</div>"
            f"<div class='value'>{top_label} (%{percent})</div></div>"
        )

    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>Perfect Match</title>
  <style>
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      padding: 32px;
      font-family: "Helvetica Neue", Arial, sans-serif;
      background: linear-gradient(135deg, #0b111a 0%, #111827 50%, #0b111a 100%);
      color: #e5e7eb;
    }}
    .card {{
      max-width: 980px;
      margin: 0 auto;
      background: #0f172a;
      border: 1px solid rgba(148, 163, 184, 0.2);
      border-radius: 24px;
      padding: 28px 32px 30px;
      box-shadow: 0 30px 60px rgba(0,0,0,0.35);
    }}
    .title {{
      font-size: 22px;
      font-weight: 700;
      letter-spacing: 0.4px;
      margin-bottom: 6px;
    }}
    .subtitle {{
      color: #94a3b8;
      font-size: 13px;
      margin-bottom: 20px;
    }}
    .match {{
      font-size: 28px;
      font-weight: 700;
      margin-bottom: 10px;
    }}
    .meta {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      font-size: 13px;
      color: #cbd5f5;
      margin-bottom: 18px;
    }}
    .badge {{
      background: rgba(56, 189, 248, 0.16);
      color: #38bdf8;
      padding: 6px 12px;
      border-radius: 999px;
      font-weight: 600;
    }}
    .panel {{
      background: #111827;
      border-radius: 16px;
      padding: 16px 18px;
      border: 1px solid rgba(148, 163, 184, 0.16);
    }}
    .row {{
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 0;
      border-bottom: 1px dashed rgba(148, 163, 184, 0.2);
      font-size: 15px;
    }}
    .row:last-child {{
      border-bottom: none;
    }}
    .name {{
      font-weight: 600;
      color: #f8fafc;
    }}
    .value {{
      font-weight: 700;
      color: #fbbf24;
    }}
    .muted {{
      color: #94a3b8;
      font-weight: 500;
    }}
    .footer {{
      margin-top: 18px;
      font-size: 12px;
      color: #94a3b8;
    }}
  </style>
</head>
<body>
  <div class="card">
    <div class="title">Perfect Match Alert</div>
    <div class="subtitle">{match_time} • {league}</div>
    <div class="match">{match_title}</div>
    <div class="meta">
      <span class="badge">{total_matches} exact matches</span>
      <span>Eslesen kategoriler: {category_text}</span>
    </div>
    <div class="panel">
      {outcome_rows}
    </div>
    <div class="footer">
      Based on historical matches with identical odds in selected categories.
    </div>
  </div>
</body>
</html>
"""


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
        html = _render_html_card(fixture, matches, outcome_summary, category_labels)
        with tempfile.TemporaryDirectory() as tmpdir:
            output_path = os.path.join(tmpdir, "match.png")
            _create_screenshot(html, output_path)
            caption = f"{fixture.get('home_team')} - {fixture.get('away_team')} ({len(matches)} match)"
            if dry_run:
                print(f"DRY RUN: {caption}")
            else:
                _send_telegram_photo(bot_token, chat_id, output_path, caption)
                print(f"Sent: {caption}")


def run_from_main(argv):
    parser = argparse.ArgumentParser(description="Send perfect match notifications to Telegram.")
    parser.add_argument("--date", help="Target date (YYYY-MM-DD). Defaults to today.")
    parser.add_argument("--dry-run", action="store_true", help="Do not send Telegram message.")
    parser.add_argument("--max-matches", type=int, help="Limit number of matches to send.")
    args = parser.parse_args(argv)
    run(date_key=args.date, dry_run=args.dry_run, max_matches=args.max_matches)


if __name__ == "__main__":
    run_from_main(None)
