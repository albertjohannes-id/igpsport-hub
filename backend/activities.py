"""Provider-neutral activity summaries. Missing metrics remain null."""

from datetime import datetime, timezone
import math


def number(value):
    return value if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value) and value >= 0 else None


def normalize_activity(provider, raw):
    if provider not in ("igpsport", "garmin"):
        raise ValueError("Unknown provider")
    igps = provider == "igpsport"
    identifier = raw.get("rideId" if igps else "activityId")
    if identifier is None:
        raise ValueError("Missing activity ID")
    local = raw.get("startTime" if igps else "startTimeLocal")
    utc = None
    if not igps and raw.get("startTimeGMT"):
        try:
            parsed = datetime.fromisoformat(raw["startTimeGMT"].replace("Z", "+00:00"))
            utc = (parsed.replace(tzinfo=timezone.utc) if parsed.tzinfo is None else parsed.astimezone(timezone.utc)).isoformat()
        except (ValueError, TypeError):
            pass
    return {
        "id": str(identifier), "provider": provider,
        "title": raw.get("title" if igps else "activityName") or "Activity",
        "startTimeUtc": utc, "sourceDateTime": local,
        "timePrecision": "date" if igps and isinstance(local, str) and len(local) == 10 else "datetime" if utc else "unknown",
        "distanceMeters": number(raw.get("rideDistance" if igps else "distance")),
        "movingSeconds": number(raw.get("totalMovingTime" if igps else "movingDuration")),
        "timerSeconds": None if igps else number(raw.get("duration")),
        "elapsedSeconds": number(raw.get("totalTime" if igps else "elapsedDuration")),
        "averageSpeedMps": number(raw.get("avgSpeed" if igps else "averageSpeed")),
        "ascentMeters": number(raw.get("totalAscent" if igps else "elevationGain")),
        "maxSpeedMps": number(raw.get("maxSpeed")),
        "averageHeartRateBpm": number(raw.get("avgHrm" if igps else "averageHR")) or None,
        "maxHeartRateBpm": number(raw.get("maxHrm" if igps else "maxHR")) or None,
        "averageCadenceRpm": number(raw.get("avgCad" if igps else "averageBikingCadenceInRevPerMinute")) or None,
        "maxCadenceRpm": number(raw.get("maxCad" if igps else "maxBikingCadenceInRevPerMinute")) or None,
        "caloriesKcal": number(raw.get("calorie" if igps else "calories")),
        "deviceName": raw.get("productName") if igps else None,
        "syncStatus": "unknown",
    }


def display(activity):
    distance = activity["distanceMeters"]
    moving, timer = activity["movingSeconds"], activity["timerSeconds"]
    time_label = f"moving {moving / 60:.1f} min" if moving is not None else f"timer {timer / 60:.1f} min" if timer is not None else "time unavailable"
    return f"{activity['sourceDateTime'] or 'Date unavailable'} | {activity['title']} | {distance / 1000:.2f} km | {time_label}" if distance is not None else f"{activity['title']} | distance unavailable | {time_label}"
