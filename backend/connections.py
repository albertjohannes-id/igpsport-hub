"""Shared local connections for browsing, transfer and session diagnostics."""

import json
import time
import requests
from garminconnect import Garmin
from garminconnect.exceptions import GarminConnectAuthenticationError
from session_trial import AUTH, IGPSportClient, save, expiry_metadata
from login_flow import connect, garmin_factory


class Connections:
    def __init__(self, trace):
        self.trace = trace
        self.clients = {}
        self.labels = {}
        self.status = {p: "Saved (not checked)" if self.path(p).exists() else "Not connected"
                       for p in ("igpsport", "garmin")}

    def path(self, provider):
        path = AUTH / f"{provider}.json"
        if AUTH.is_symlink() or path.is_symlink():
            raise ValueError("Session path must not be a symlink")
        return path

    def instrument(self, provider, client):
        if provider == "igpsport":
            request = client.session.request
            def bounded(*args, **kwargs):
                kwargs.setdefault("timeout", 30)
                return request(*args, **kwargs)
            client.session.request = self.trace.wrap("igpsport.http", bounded)
            self.trace.instrument(provider, client, ("login", "get_activities", "get_activity_detail"))
        else:
            client.client._run_request = self.trace.wrap("garmin.http", client.client._run_request)
            self.trace.instrument(provider, client, ("login", "get_activities", "get_activities_by_date", "get_activity", "upload_activity"))
            refresh = client.client._refresh_di_token
            def refresh_and_save():
                old = client.client.di_refresh_token
                self.trace.wrap("garmin.refresh", refresh)()
                if getattr(client, "_apex_save", False):
                    self.persist(provider, client)
                self.trace.emit("garmin.refresh_rotated", old != client.client.di_refresh_token)
            client.client._refresh_di_token = refresh_and_save
        return client

    def validate(self, provider, client):
        if provider == "igpsport":
            response = client.session.get(f"{client.base_url}/web-gateway/web-analyze/activity/queryMyActivity",
                params={"pageNo": 1, "pageSize": 1, "reqType": 0, "sort": 1})
            if response.status_code == 401:
                raise GarminConnectAuthenticationError("Session rejected")
            response.raise_for_status()
            body = response.json()
            if body.get("code") != 0 or not isinstance(body.get("data", {}).get("rows"), list):
                raise ValueError("Session not confirmed")
        else:
            if not isinstance(client.get_activities(0, 1), list):
                raise ValueError("Session not confirmed")
        self.status[provider] = "Connected (last check passed)"
        self.trace.emit(f"{provider}.session_verified", True)

    def persist(self, provider, client):
        if provider == "garmin":
            if not client.client.di_token:
                print("Garmin session cannot be saved in the supported DI format.")
                return
            payload = json.loads(client.client.dumps())
        else:
            payload = client._apex_session
        save(self.path(provider), payload)
        client._apex_save = True
        print(f"{provider}: session saved locally.")

    def get(self, provider, reconnect=False):
        if not reconnect:
            client = self.clients.get(provider)
            path = self.path(provider)
            if client is None and path.exists():
                try:
                    stored = json.loads(path.read_text())
                    if provider == "igpsport":
                        client = IGPSportClient("", "", "global")
                        client.token = stored["access_token"]
                        client.session.headers["authorization"] = f"Bearer {client.token}"
                        client._apex_session = stored
                    else:
                        client = Garmin(retry_attempts=1)
                        client.client.loads(json.dumps(stored))
                    client._apex_save = True
                    self.instrument(provider, client)
                except (ValueError, KeyError, GarminConnectAuthenticationError):
                    print("Saved session could not be loaded. Please reconnect.")
                    client = None
            if client is not None:
                print(f"Checking saved/current {provider} session...")
                try:
                    self.validate(provider, client)
                    self.clients[provider] = client
                    return client, self.labels.get(provider, "saved account")
                except GarminConnectAuthenticationError:
                    self.status[provider] = "Reconnect needed"
                    print("Session rejected. Please sign in again.")
                except Exception as error:
                    status = getattr(getattr(error, "response", None), "status_code", None)
                    self.status[provider] = "Reconnect needed" if status == 401 else "Unable to check"
                    print("Could not validate the session. A network error does not mean it expired.")
                    if input("Sign in again? [y/N]: ").strip().lower() != "y":
                        return None, ""
        captured = {}
        def factory(name, password, secret):
            client = IGPSportClient(name, password, "global") if provider == "igpsport" else garmin_factory(name, password, secret)
            self.instrument(provider, client)
            if provider == "igpsport":
                request = client.session.request
                def capture(*args, **kwargs):
                    response = request(*args, **kwargs)
                    if response.status_code == 200:
                        try:
                            data = response.json().get("data", {})
                            if isinstance(data, dict) and data.get("access_token"):
                                captured.update({k: data.get(k) for k in ("access_token", "refresh_token", "expires_in")})
                                captured["received_at"] = time.time()
                        except ValueError:
                            pass
                    return response
                client.session.request = capture
            return client
        client, label = connect("iGPSPORT" if provider == "igpsport" else "Garmin", factory)
        if client is None:
            return None, ""
        self.validate(provider, client)
        if provider == "igpsport":
            client._apex_session = captured
        self.clients[provider], self.labels[provider] = client, label
        if input("Save this session for next time? [Y/n]: ").strip().lower() not in ("n", "no"):
            self.persist(provider, client)
        else:
            # Do not leave an older account's session available on the next launch.
            self.path(provider).unlink(missing_ok=True)
            client._apex_save = False
        return client, label

    def disconnect(self, provider):
        self.clients.pop(provider, None)
        self.labels.pop(provider, None)
        self.path(provider).unlink(missing_ok=True)
        self.status[provider] = "Not connected"
        self.trace.emit(f"{provider}.local_disconnect", True)
        print("Local session removed. This does not revoke the provider's token.")

    def refresh_garmin(self):
        client, _ = self.get("garmin")
        if client is None:
            return
        print("Testing Garmin refresh now; this does not mean the token expired.")
        try:
            client.client._refresh_di_token()
            self.validate("garmin", client)
        except Exception:
            self.status["garmin"] = "Unable to check"
            raise
        self.trace.emit("garmin.refresh_verified", True)
        metadata = expiry_metadata(client.client.di_token)
        self.trace.emit("garmin.expiry_metadata", metadata)
        print("Refresh verified through activity access.", metadata)
