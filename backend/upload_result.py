"""Interpret upload results and retain only safe diagnostic fields."""

from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import uuid


def normalize(result):
    if isinstance(result, (dict, list)):
        return result
    if callable(getattr(result, "json", None)):
        try:
            return result.json()
        except (ValueError, TypeError):
            return None
    if isinstance(result, (str, bytes)):
        try:
            return json.loads(result)
        except (ValueError, TypeError):
            return None
    return None


def classify(body):
    if not isinstance(body, dict):
        return "unknown", []
    report = body.get("detailedImportResult", body.get("DetailedImportResult", body))
    if not isinstance(report, dict):
        return "unknown", []
    successes = report.get("successes")
    failures = report.get("failures")
    ids = []
    if isinstance(successes, list):
        for entry in successes:
            if isinstance(entry, dict):
                value = entry.get("internalId", entry.get("activityId"))
                if re.fullmatch(r"[1-9][0-9]{0,19}", str(value)):
                    ids.append(str(value))
    if ids and not failures:
        return "success", ids
    if isinstance(failures, list) and failures and not successes:
        return "rejected", []
    return "unknown", ids


SAFE_KEYS = {
    "detailedImportResult", "DetailedImportResult", "successes", "failures",
    "internalId", "activityId", "externalId", "messages", "message", "code",
    "content", "status", "statusCode", "data", "result", "results", "uploadId",
    "fileSize", "processingTime",
}
NUMERIC_KEYS = {"internalId", "activityId", "code", "statusCode", "uploadId", "fileSize", "processingTime"}
METRIC_KEYS = {"pageNo", "pageSize", "totalPage", "totalRows", "rideId", "rideDistance",
               "totalMovingTime", "totalTime", "avgSpeed", "totalAscent", "distance", "duration"}
METRIC_KEYS.update({"expires_in", "expires_at", "remaining_seconds", "received_at"})
SAFE_KEYS.update(METRIC_KEYS | {"rows", "title", "activityName", "productName", "summaryDTO"})


def sanitize(value, key="", depth=0):
    if depth > 8:
        return "[depth limit]"
    if isinstance(value, dict):
        safe = {k: sanitize(v, k, depth + 1) for k, v in value.items() if k in SAFE_KEYS}
        safe["omitted_field_count"] = sum(k not in SAFE_KEYS for k in value)
        return safe
    if isinstance(value, list):
        return [sanitize(item, key, depth + 1) for item in value[:20]]
    if value is None:
        return None
    if key in METRIC_KEYS and isinstance(value, (int, float)) and not isinstance(value, bool):
        return value
    if key in NUMERIC_KEYS and re.fullmatch(r"[0-9]{1,20}", str(value)):
        return value
    return f"[redacted {type(value).__name__}]"


def response_shape(value, depth=0):
    """Keep field names and types so unfamiliar responses can be investigated."""
    if depth > 8:
        return "depth limit"
    if isinstance(value, dict):
        shape = {}
        for index, (key, item) in enumerate(list(value.items())[:50]):
            name = key if isinstance(key, str) and re.fullmatch(r"[A-Za-z][A-Za-z0-9_]{0,63}", key) else f"redacted_key_{index}"
            if re.search(r"token|password|secret|cookie|authorization|credential", name, re.I):
                shape[name] = "redacted"
            else:
                shape[name] = response_shape(item, depth + 1)
        return shape
    if isinstance(value, list):
        return {"type": "list", "length": len(value),
                "sample_shapes": [response_shape(item, depth + 1) for item in value[:3]]}
    return type(value).__name__


def record(result, directory, error=None):
    body = normalize(result)
    outcome, ids = classify(body)
    status = getattr(result, "status_code", None)
    diagnostic = {
        "recorded_at": datetime.now(timezone.utc).isoformat(),
        "response_type": type(result).__name__,
        "http_status": status if isinstance(status, int) else None,
        "outcome": outcome,
        "activity_ids": ids,
        "error_type": type(error).__name__ if error is not None else None,
        "response": sanitize(body),
        "response_shape": response_shape(body),
    }
    directory = Path(directory)
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    path = directory / f"upload-{uuid.uuid4().hex}.json"
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w") as handle:
        json.dump(diagnostic, handle, indent=2)
        handle.write("\n")
    return outcome, ids, path
