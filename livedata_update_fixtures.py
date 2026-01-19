import argparse
import datetime as dt
import json
import re
from typing import Any, Optional, List, Dict, Tuple

import requests
from postgrest.exceptions import APIError

from config import supabase

LIVEDATA_URL = "https://vd.mackolik.com/livedata"
REFERER = "https://arsiv.mackolik.com/Canli-Sonuclar"
REQUEST_TIMEOUT = 20
INSERT_BATCH_SIZE = 200

JSONP_RE = re.compile(r"^[\w.$]+\((.*)\)\s*;?\s*$", re.S)


def format_date(date_obj: dt.date) -> str:
    return date_obj.strftime("%d/%m/%Y")


def parse_json_or_jsonp(text: str):
    s = text.strip()
    if not s:
        raise ValueError("Empty response body")

    if s[0] in "{[":
        return json.loads(s)

    m = JSONP_RE.match(s)
    if m:
        return json.loads(m.group(1))

    first = s.find("(")
    last = s.rfind(")")
    if first != -1 and last != -1 and last > first:
        return json.loads(s[first + 1 : last])

    raise ValueError("Unsupported JSON/JSONP response format")


def fetch_livedata(date_str: str):
    headers = {
        "User-Agent": (
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/120.0.0.0 Safari/537.36"
        ),
        "Referer": REFERER,
        "Accept": "application/json, text/javascript, */*; q=0.01",
    }
    r = requests.get(
        LIVEDATA_URL,
        params={"date": date_str},
        headers=headers,
        timeout=REQUEST_TIMEOUT,
    )
    r.raise_for_status()
    return parse_json_or_jsonp(r.text)


def _safe_get(lst: list, idx: int, default=None):
    try:
        return lst[idx]
    except Exception:
        return default


def _coerce_match_code(value: Any) -> Optional[str]:
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        code = str(value)
    elif isinstance(value, str) and value.isdigit():
        code = value
    else:
        return None
    return code if 5 <= len(code) <= 10 else None


def _is_football_row(row: list) -> bool:
    """
    row[36] = meta list
    meta[-1] behaves like sportId: 1=football, 2=basketball
    """
    if not isinstance(row, list) or len(row) < 37:
        return False
    meta = _safe_get(row, 36, [])
    if not isinstance(meta, list) or not meta:
        return False
    return meta[-1] == 1


def _extract_season_fields(meta: list) -> Tuple[Optional[int], Optional[str]]:
    # observed: meta[4] season_id, meta[5] season_name
    sid_raw = _safe_get(meta, 4, None)
    sname = _safe_get(meta, 5, None)

    sid: Optional[int] = None
    if isinstance(sid_raw, int):
        sid = sid_raw
    elif isinstance(sid_raw, str) and sid_raw.isdigit():
        sid = int(sid_raw)

    if sname is not None and not isinstance(sname, str):
        sname = str(sname)

    return sid, sname


def extract_football_matches(payload) -> List[Dict]:
    """
    For printing + queue insert.
    """
    if not isinstance(payload, dict) or not isinstance(payload.get("m"), list):
        raise ValueError("Unexpected livedata format: payload['m'] not found")

    out: List[Dict] = []
    for row in payload["m"]:
        if not _is_football_row(row):
            continue

        match_code = _coerce_match_code(_safe_get(row, 0))
        if not match_code:
            continue

        meta = _safe_get(row, 36, [])
        season_id, season_name = _extract_season_fields(meta)

        country = _safe_get(meta, 1, "")
        league = _safe_get(meta, 3, "")

        home = _safe_get(row, 2, "")
        away = _safe_get(row, 4, "")
        time_str = _safe_get(row, 16, "")
        date_str = _safe_get(row, 35, "")

        odds_1 = _safe_get(row, 18, "")
        odds_x = _safe_get(row, 19, "")
        odds_2 = _safe_get(row, 20, "")

        out.append(
            {
                "match_code": match_code,
                "date": date_str,
                "time": time_str,
                "country": country,
                "league": league,
                "home": home,
                "away": away,
                "odds_1": odds_1,
                "odds_x": odds_x,
                "odds_2": odds_2,
                "season_id": season_id,
                "season_name": season_name,
            }
        )

    out.sort(key=lambda m: (m.get("date") or "", m.get("time") or "", int(m["match_code"])))
    return out


def print_matches(matches: List[Dict], title: str) -> None:
    print(f"\n=== {title} | football matches: {len(matches)} ===")
    for m in matches:
        code = m["match_code"]
        url = f"https://arsiv.mackolik.com/Match/Default.aspx?id={code}"
        dt_part = f"{m.get('date','')} {m.get('time','')}".strip()
        league_part = f"{m.get('country','')} - {m.get('league','')}".strip(" -")
        odds = f"1:{m.get('odds_1','')}  X:{m.get('odds_x','')}  2:{m.get('odds_2','')}".strip()
        season = f"season_id={m.get('season_id')} season_name={m.get('season_name')}"
        print(f"- {code} | {dt_part} | {league_part} | {m.get('home','')} vs {m.get('away','')} | {odds} | {season}")
        print(f"  {url}")


def _is_duplicate_error(exc: Exception) -> bool:
    if isinstance(exc, APIError):
        details = exc.json if hasattr(exc, "json") else {}
        if isinstance(details, dict) and details.get("code") == "23505":
            return True
        msg = str(details).lower()
        return "duplicate" in msg or "23505" in msg
    msg = str(exc).lower()
    return "duplicate" in msg or "23505" in msg


def build_queue_rows(
    matches: List[Dict],
    status: str,
    error_log: str,
) -> List[Dict]:
    """
    match_queue columns (based on your sample):
      match_code, match_url, season_id, season_name, week, status, error_log, last_try_at
    - idx is NOT inserted.
    - week not important -> not sent (NULL).
    - last_try_at -> None
    """
    rows: List[Dict] = []
    seen = set()

    for m in matches:
        code = m["match_code"]
        if code in seen:
            continue
        seen.add(code)

        rows.append(
            {
                "match_code": code,
                "match_url": f"https://arsiv.mackolik.com/Match/Default.aspx?id={code}",
                "season_id": m.get("season_id"),
                "season_name": m.get("season_name"),
                "status": status,
                "error_log": error_log,
                "last_try_at": None,
                # "week": None,  # intentionally omitted -> NULL
            }
        )

    return rows


def insert_into_queue(
    matches: List[Dict],
    dry_run: bool,
    status: str,
    error_log: str,
) -> Tuple[int, int]:
    rows = build_queue_rows(matches, status=status, error_log=error_log)
    if not rows:
        return 0, 0

    if dry_run:
        print(f"\n[DRY-RUN] would insert {len(rows)} rows into match_queue")
        for r in rows:
            print(
                f"[DRY-RUN] match_code={r['match_code']} season_id={r.get('season_id')} "
                f"season_name={r.get('season_name')} status={r['status']} error_log={r.get('error_log')}"
            )
        return len(rows), 0

    inserted = 0
    skipped = 0

    for start in range(0, len(rows), INSERT_BATCH_SIZE):
        batch = rows[start : start + INSERT_BATCH_SIZE]
        try:
            supabase.table("match_queue").insert(batch, returning="minimal").execute()
            inserted += len(batch)
        except Exception as exc:
            # fallback: try individually
            for row in batch:
                try:
                    supabase.table("match_queue").insert(row, returning="minimal").execute()
                    inserted += 1
                except Exception as exc2:
                    if _is_duplicate_error(exc2):
                        skipped += 1
                    else:
                        print(f"[DB] insert failed match_code={row.get('match_code')}: {exc2}")

    return inserted, skipped


def sync_for_date(date_str: str, dry_run: bool, status: str, error_log: str) -> None:
    payload = fetch_livedata(date_str)
    matches = extract_football_matches(payload)

    print_matches(matches, title=date_str)

    inserted, skipped = insert_into_queue(matches, dry_run=dry_run, status=status, error_log=error_log)
    if dry_run:
        print(f"[DRY-RUN] prepared={inserted} skipped={skipped}")
    else:
        print(f"[DB] inserted={inserted} skipped={skipped}")


def sync_for_days(days_ahead: int, dry_run: bool, status: str, error_log: str) -> None:
    today = dt.date.today()
    for offset in range(days_ahead + 1):
        d = today + dt.timedelta(days=offset)
        sync_for_date(format_date(d), dry_run=dry_run, status=status, error_log=error_log)


def run_from_main(argv: Optional[list] = None) -> None:
    """
    Called from main.py:
      python3 main.py update-fixtures --date 19/01/2026
      python3 main.py update-fixtures --days-ahead 3
      python3 main.py update-fixtures --date 19/01/2026 --write-db
      python3 main.py update-fixtures --date 19/01/2026 --status MONITORING
    """
    p = argparse.ArgumentParser(prog="main.py update-fixtures")
    p.add_argument("--date", type=str, default=None, help="DD/MM/YYYY (e.g., 19/01/2026)")
    p.add_argument("--days-ahead", type=int, default=None, help="Fetch today + N days (e.g., 3)")
    p.add_argument("--write-db", action="store_true", help="Actually insert into match_queue")
    p.add_argument("--status", type=str, default="MONITORING", help="Status to insert (default: MONITORING)")
    p.add_argument(
        "--error-log",
        type=str,
        default="Synced from livedata (fixtures)",
        help="error_log text to insert (default: Synced from livedata (fixtures))",
    )
    args = p.parse_args(argv)

    dry_run = not args.write_db

    if args.date:
        sync_for_date(args.date, dry_run=dry_run, status=args.status, error_log=args.error_log)
        return

    days = args.days_ahead if args.days_ahead is not None else 3
    sync_for_days(days, dry_run=dry_run, status=args.status, error_log=args.error_log)