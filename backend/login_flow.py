"""Interactive login with bounded, user-controlled retries."""

from getpass import getpass
import requests
from garminconnect import Garmin
from garminconnect.exceptions import (
    GarminConnectAuthenticationError,
    GarminConnectTooManyRequestsError,
)


def connect(provider, factory, ask=input, secret=getpass, say=print):
    identifier = ""
    for attempt in range(3):
        entered = ask(f"{provider} email/username{f' [{identifier}]' if identifier else ''} (q to cancel): ").strip()
        if entered.lower() == "q":
            return None, identifier
        identifier = entered or identifier
        password = secret(f"{provider} password: ")
        if not identifier or not password:
            say("Email/username and password are required.")
            continue
        client = None
        category = "unknown"
        say(f"Connecting to {provider} (attempt {attempt + 1}/3)...")
        if provider == "Garmin":
            say("Garmin login can take several seconds. Please wait for the result.")
        try:
            client = factory(identifier, password, secret)
            password = None
            if provider == "iGPSPORT":
                request = client.session.request
                observation = {}

                def observed_request(*args, **kwargs):
                    kwargs.setdefault("timeout", 30)
                    try:
                        response = request(*args, **kwargs)
                    except requests.RequestException:
                        observation["category"] = "network"
                        raise
                    status = response.status_code
                    if status == 429:
                        observation["category"] = "rate"
                    elif status >= 500:
                        observation["category"] = "network"
                    elif status == 401:
                        observation["category"] = "auth"
                    elif status == 403:
                        try:
                            payload = response.json()
                        except ValueError:
                            payload = None
                        # Observed in the user's wrong-password trial; other 403s stay ambiguous.
                        observation["category"] = "auth" if isinstance(payload, dict) and payload.get("code") == 1002 else "blocked"
                    return response

                client.session.request = observed_request
                ok = client.login()
                client.password = None
                category = observation.get("category", "unknown")
                if ok:
                    # Keep the timeout, but discard login observations.
                    def bounded_request(*args, **kwargs):
                        kwargs.setdefault("timeout", 30)
                        return request(*args, **kwargs)
                    client.session.request = bounded_request
                    say(f"{provider} connected.")
                    return client, identifier
            else:
                client.login()
                say(f"{provider} connected.")
                return client, identifier
        except GarminConnectAuthenticationError:
            category = "auth"
        except GarminConnectTooManyRequestsError:
            category = "rate"
        except Exception as error:
            status = getattr(getattr(error, "response", None), "status_code", None)
            category = "rate" if status == 429 else "auth" if status == 401 else "network" if isinstance(error, requests.RequestException) or (isinstance(status, int) and status >= 500) else "unknown"
        finally:
            password = None
        if category == "rate":
            say(f"{provider} is limiting login attempts. Please wait and try later.")
            return None, identifier
        if category == "auth":
            say(f"{provider} rejected the login. Check your email/username and password" + (" or verification code." if provider == "Garmin" else "."))
        elif category == "network":
            say(f"Could not reach {provider} reliably. This does not mean your password is wrong.")
        elif category == "blocked":
            say(f"{provider} denied this request. It may require verification or be blocking the connection.")
        else:
            say(f"{provider} login was not confirmed. Check your credentials; the service or API may also be responsible.")
        if attempt < 2 and ask("Re-enter login details? [Y/n]: ").strip().lower() not in ("n", "no", "q"):
            continue
        break
    say("Login stopped. No upload was started.")
    return None, identifier


def garmin_factory(identifier, password, secret):
    return Garmin(identifier, password, retry_attempts=1,
                  prompt_mfa=lambda: secret("Garmin verification code: "))
