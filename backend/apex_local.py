"""One persistent entry point for the iGPSPORT Hub local trial."""

import os
from session_trial import ROOT
from diagnostics import Trace
from connections import Connections
from activities import normalize_activity, display
import trial


def browse_garmin(connections):
    client, _ = connections.get("garmin")
    if client is None:
        return
    offset = 0
    while True:
        rows = client.get_activities(offset, 10)
        if not isinstance(rows, list):
            raise ValueError("Unexpected Garmin response")
        print("\nGarmin activities")
        for index, row in enumerate(rows, 1):
            print(f"{index}. {display(normalize_activity('garmin', row))}")
        if not rows:
            print("No activities on this page.")
        choice = input("Number for details / n next / p previous / b back: ").strip().lower()
        if choice in ("b", "q"):
            return
        if choice == "n":
            offset += 10
        elif choice == "p":
            offset = max(0, offset - 10)
        elif choice.isdigit() and 1 <= int(choice) <= len(rows):
            row = rows[int(choice) - 1]
            detail = client.get_activity(str(row["activityId"]))
            merged = row | (detail.get("summaryDTO", {}) if isinstance(detail, dict) else {})
            print(display(normalize_activity("garmin", merged)))
            print(f"https://connect.garmin.com/modern/activity/{row['activityId']}")
            print("Garmin to iGPSPORT transfer is not supported in this trial.")


def main():
    os.umask(0o077)
    trace = Trace(ROOT / "logs")
    connections = Connections(trace)
    print("iGPSPORT Hub local app")
    print("Saved tokens stay in .local-auth with owner-only access, not encrypted. Passwords are not saved.")
    print(f"Diagnostics: {trace.path}")
    while True:
        print("\nHome | " + " | ".join(f"{name}: {status}" for name, status in connections.status.items()))
        print("1 iGPSPORT activities / select and send to Garmin")
        print("2 Garmin activities / details")
        print("3 Check saved sessions   4 Reconnect account")
        print("5 Test Garmin refresh   6 Disconnect account   0 Exit")
        try:
            choice = input("Choose: ").strip()
            if choice in ("0", "q"):
                return
            if choice == "1":
                trial.main(connections)
            elif choice == "2":
                browse_garmin(connections)
            elif choice == "3":
                for provider in ("igpsport", "garmin"):
                    if provider in connections.clients or connections.path(provider).exists():
                        connections.get(provider)
                    else:
                        print(f"{provider}: no saved session; connect through its activity menu.")
            elif choice == "5":
                connections.refresh_garmin()
            elif choice in ("4", "6"):
                selected = input("1 iGPSPORT / 2 Garmin / b back: ").strip()
                provider = {"1": "igpsport", "2": "garmin"}.get(selected)
                if provider:
                    if choice == "4":
                        connections.get(provider, reconnect=True)
                    else:
                        connections.disconnect(provider)
            else:
                print("Choose one of the listed options.")
        except KeyboardInterrupt:
            print("\nAction stopped. If interrupted during upload, check Garmin before retrying.")
        except EOFError:
            return
        except Exception as error:
            trace.emit("menu.action_failed", error=error)
            print(f"Action could not finish ({type(error).__name__}). Returning to Home; no automatic upload retry.")


if __name__ == "__main__":
    main()
