"""Per-run diagnostics without request arguments or raw response text."""

from datetime import datetime, timezone
import functools
import json
import os
from pathlib import Path
import time
import uuid
from upload_result import normalize, response_shape, sanitize


class Trace:
    def __init__(self, directory):
        Path(directory).mkdir(mode=0o700, parents=True, exist_ok=True)
        self.path = Path(directory) / f"run-{uuid.uuid4().hex}.jsonl"
        self.sequence = 0

    def emit(self, operation, result=None, error=None, elapsed_ms=0):
        self.sequence += 1
        response = getattr(error, "response", None) if error is not None else result
        body = None if operation.startswith("fit.") and not isinstance(response, dict) else normalize(response)
        status = getattr(response, "status_code", None)
        event = {
            "sequence": self.sequence, "time_utc": datetime.now(timezone.utc).isoformat(),
            "operation": operation, "elapsed_ms": round(elapsed_ms, 1),
            "http_status": status if isinstance(status, int) else None,
            "error_type": type(error).__name__ if error else None,
            "result_type": type(result).__name__,
            "response": sanitize(body), "response_shape": response_shape(body),
        }
        if isinstance(result, bool):
            event["returned_boolean"] = result
        try:
            fd = os.open(self.path, os.O_APPEND | os.O_CREAT | os.O_WRONLY, 0o600)
            with os.fdopen(fd, "a") as handle:
                handle.write(json.dumps(event) + "\n")
        except OSError:
            print("Diagnostic log could not be written; the operation result is unchanged.")

    def wrap(self, operation, function):
        @functools.wraps(function)
        def wrapped(*args, **kwargs):
            started = time.monotonic()
            try:
                result = function(*args, **kwargs)
            except Exception as error:
                self.emit(operation, error=error, elapsed_ms=(time.monotonic() - started) * 1000)
                raise
            self.emit(operation, result=result, elapsed_ms=(time.monotonic() - started) * 1000)
            return result
        return wrapped

    def instrument(self, provider, client, methods):
        for method in methods:
            setattr(client, method, self.wrap(f"{provider}.{method}", getattr(client, method)))
        return client
