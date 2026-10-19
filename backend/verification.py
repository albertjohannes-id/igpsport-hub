"""Confirm a new Garmin activity using the source FIT session metrics."""

from datetime import datetime, timedelta, timezone
import io
import time
import fitdecode


def fit_summary(content):
    sessions = []
    with fitdecode.FitReader(io.BytesIO(content)) as reader:
        for frame in reader:
            if isinstance(frame, fitdecode.FitDataMessage) and frame.name == "session":
                sessions.append({field.name: field.value for field in frame.fields})
    if len(sessions) != 1:
        raise ValueError("Verification requires one FIT session")
    session = sessions[0]
    start = session.get("start_time")
    duration = session.get("total_timer_time")
    distance = session.get("total_distance")
    if not isinstance(start, datetime) or duration is None or distance is None:
        raise ValueError("FIT session metrics missing")
    return {"start": start.replace(tzinfo=timezone.utc) if start.tzinfo is None else start.astimezone(timezone.utc),
            "duration": float(duration), "distance": float(distance)}


def matches(activity, summary):
    try:
        start = datetime.fromisoformat(activity["startTimeGMT"].replace("Z", "+00:00"))
        if start.tzinfo is None:
            start = start.replace(tzinfo=timezone.utc)
        return (abs((start - summary["start"]).total_seconds()) <= 2
                and abs(float(activity["duration"]) - summary["duration"]) <= 3
                and abs(float(activity["distance"]) - summary["distance"]) <= 20)
    except (KeyError, TypeError, ValueError, AttributeError):
        return False


def fetch_candidates(client, summary):
    start = summary["start"]
    # Garmin's date filter uses local dates; include adjacent days for timezone offsets.
    result = client.get_activities_by_date((start - timedelta(days=1)).date().isoformat(),
                                           (start + timedelta(days=1)).date().isoformat())
    if not isinstance(result, list) or any(not isinstance(a, dict) or not a.get("activityId") for a in result):
        raise ValueError("Unexpected activity list")
    return result


def verify(client, summary, before, sleep=time.sleep, say=print):
    previous = {str(activity["activityId"]) for activity in before}
    for attempt in range(4):
        if attempt:
            sleep(5)
        say(f"Checking Garmin for the ride ({attempt + 1}/4)...")
        after = fetch_candidates(client, summary)
        found = [str(a["activityId"]) for a in after if str(a["activityId"]) not in previous and matches(a, summary)]
        if len(found) == 1:
            return found[0]
        if len(found) > 1:
            return None
    return None
