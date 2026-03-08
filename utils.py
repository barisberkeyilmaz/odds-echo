from datetime import datetime, timedelta

MIN_MATCH_DURATION = timedelta(hours=3)


def parse_match_date(value):
    if not value:
        return None
    if isinstance(value, datetime):
        dt_value = value
    elif isinstance(value, str):
        try:
            dt_value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            try:
                dt_value = datetime.strptime(value, "%Y-%m-%d %H:%M:%S")
            except ValueError:
                return None
    else:
        return None

    if dt_value.tzinfo:
        return dt_value.astimezone().replace(tzinfo=None)
    return dt_value


def is_match_finished(match_row: dict) -> bool:
    now = datetime.now()
    match_date = parse_match_date(match_row.get("match_date"))
    if match_date and match_date > now:
        return False

    status = str(match_row.get("status") or "").strip().upper()
    if status == "MS":
        return True

    score_ft = match_row.get("score_ft")
    if score_ft and match_date and (now - match_date) >= MIN_MATCH_DURATION:
        return True

    return False
