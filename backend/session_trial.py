"""Read-only local tests for saved sessions and Garmin DI token refresh."""

import base64
import json
import logging
import math
import os
from pathlib import Path
import sys
import time
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "upstream-trial"))
from sync_igpsport_to_garmin import IGPSportClient
from garminconnect import Garmin
from login_flow import connect, garmin_factory
from diagnostics import Trace
from activities import normalize_activity, display

logging.disable(logging.CRITICAL)
AUTH = ROOT / ".local-auth"


def save(path, value):
    AUTH.mkdir(mode=0o700, exist_ok=True)
    if AUTH.is_symlink() or path.is_symlink():
        raise ValueError("Auth paths must not be symlinks")
    os.chmod(AUTH, 0o700)
    fd, temp = tempfile.mkstemp(dir=AUTH)
    try:
        with os.fdopen(fd, "w") as handle:
            json.dump(value, handle)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def expiry_metadata(token):
    try:
        part = token.split(".")[1]
        payload = json.loads(base64.urlsafe_b64decode(part + "=" * (-len(part) % 4)))
        exp = payload.get("exp")
        if isinstance(exp, bool) or not isinstance(exp, (int, float)) or not math.isfinite(exp):
            return {}
        return {"expires_at": exp, "remaining_seconds": max(0, int(exp - time.time()))}
    except (AttributeError, IndexError, ValueError, TypeError):
        return {}


def main():
    os.umask(0o077)
    if AUTH.is_symlink():
        raise ValueError("Auth path must not be a symlink")
    trace = Trace(ROOT / "logs")
    print("iGPSPORT Hub: local saved-session test (no uploads)")
    print("Tokens are saved locally with owner-only permissions, not encrypted. Passwords are not saved.")
    print(f"Diagnostics: {trace.path}")
    provider = input("Provider: 1 iGPSPORT / 2 Garmin / q quit: ").strip()
    if provider not in ("1", "2"):
        return
    provider = "igpsport" if provider == "1" else "garmin"
    mode = input("1 Connect and save / 2 Reuse saved session / 3 Refresh saved Garmin session / 4 Forget local session: ").strip()
    path = AUTH / f"{provider}.json"
    if path.is_symlink():
        raise ValueError("Auth file must not be a symlink")
    if mode == "4":
        path.unlink(missing_ok=True)
        print("Local session removed. This does not revoke it at the provider.")
        return
    if mode not in ("1", "2", "3"):
        return
    if mode == "3" and provider == "igpsport":
        print("iGPSPORT refresh endpoint is not validated. Use Connect to renew the session.")
        return
    if mode != "1" and not path.exists():
        print("No saved session. Run Connect and save first.")
        return
    metadata = {}
    if provider == "igpsport":
        captured = {}
        if mode == "1":
            def factory(name, password, secret):
                client = IGPSportClient(name, password, "global")
                request = trace.wrap("igpsport.http", client.session.request)
                def capture(*args, **kwargs):
                    response = request(*args, **kwargs)
                    if response.status_code == 200:
                        body = response.json()
                        if body.get("code") == 0 and isinstance(body.get("data"), dict):
                            captured.update(body["data"])
                    return response
                client.session.request = capture
                return client
            client, _ = connect("iGPSPORT", factory)
            if client is None:
                return
            lifetime = captured.get("expires_in")
            metadata = {"received_at": time.time(), "expires_in": lifetime if isinstance(lifetime, (int, float)) and not isinstance(lifetime, bool) else None}
            stored = {"access_token": client.token, "refresh_token": captured.get("refresh_token"), **metadata}
        else:
            stored = json.loads(path.read_text())
            client = IGPSportClient("", "", "global")
            client.token = stored["access_token"]
            client.session.headers["authorization"] = f"Bearer {client.token}"
            client.session.request = trace.wrap("igpsport.http", client.session.request)
            metadata = {key: stored.get(key) for key in ("received_at", "expires_in")}
        response = client.session.get(f"{client.base_url}/web-gateway/web-analyze/activity/queryMyActivity", params={"pageNo": 1, "pageSize": 5, "reqType": 0, "sort": 1}, timeout=30)
        response.raise_for_status()
        body = response.json()
        if body.get("code") != 0 or not isinstance(body.get("data", {}).get("rows"), list):
            raise ValueError("Activity access not confirmed")
        rows = body["data"]["rows"]
        if mode == "1":
            save(path, stored)
    else:
        if mode == "1":
            client, _ = connect("Garmin", garmin_factory)
            if client is None:
                return
        else:
            client = Garmin(retry_attempts=1)
            client.client.loads(path.read_text())
        if not client.client.di_token:
            print("This session did not provide reusable DI tokens. Not saving an unsupported session.")
            return
        refresh = client.client._refresh_di_token
        def monitored_refresh():
            old = client.client.di_refresh_token
            trace.wrap("garmin.refresh", refresh)()
            save(path, json.loads(client.client.dumps()))
            trace.emit("garmin.refresh_rotated", old != client.client.di_refresh_token)
        client.client._refresh_di_token = monitored_refresh
        client.client._run_request = trace.wrap("garmin.http", client.client._run_request)
        if mode == "3":
            print("Testing refresh early; this does not imply the previous token expired.")
            monitored_refresh()
        rows = trace.wrap("garmin.get_activities", client.get_activities)(0, 5)
        if not isinstance(rows, list):
            raise ValueError("Activity access not confirmed")
        save(path, json.loads(client.client.dumps()))
        metadata = expiry_metadata(client.client.di_token)
    trace.emit(f"{provider}.expiry_metadata", metadata)
    trace.emit(f"{provider}.{'refresh_verified' if mode == '3' else 'reuse_verified' if mode == '2' else 'session_saved'}", True)
    print("Session valid: activity access verified.")
    print("Expiry metadata (not a guarantee of continued validity):", json.dumps(metadata))
    for row in rows:
        print(display(normalize_activity(provider, row)))
    if not rows:
        print("No activities returned.")
    print("Close and reopen this tool, then choose Reuse saved session. No password should be needed.")


if __name__ == "__main__":
    try:
        main()
    except (EOFError, KeyboardInterrupt):
        print("\nCancelled.")
    except Exception as error:
        print(f"Session check failed ({type(error).__name__}). Check the diagnostic log; reconnect if credentials were rejected.")
