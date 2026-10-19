"""Local, single-ride evaluation of the upstream integrations."""

import getpass
import logging
import os
from pathlib import Path
import sys
import tempfile

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "upstream-trial"))
from sync_igpsport_to_garmin import IGPSportClient
from garminconnect import Garmin
from upload_result import record
from login_flow import connect, garmin_factory
from verification import fit_summary, fetch_candidates, matches, verify
from upload_result import response_shape
import json
import uuid
from diagnostics import Trace
from ride_display import igps_row, garmin_row, title

# Upstream exceptions may contain signed URLs or authentication responses.
logging.disable(logging.CRITICAL)


def main(connections=None):
    trace = connections.trace if connections is not None else Trace(ROOT / "logs")
    print("iGPSPORT Hub — local integration trial")
    print("No source activities are deleted. Uploading requires confirmation.")
    print("You will select one ride and confirm before its Garmin upload.\n")
    print(f"Session diagnostics: {trace.path}")
    def igps_factory(name, password, secret):
        instance = IGPSportClient(name, password, "global")
        instance.session.request = trace.wrap("igpsport.http", instance.session.request)
        return trace.instrument("igpsport", instance, ("login", "get_activities", "get_activity_detail"))
    client, _ = connections.get("igpsport") if connections is not None else connect("iGPSPORT", igps_factory)
    if client is None:
        return 1
    page = 1
    while True:
        result = client.get_activities(page, 20)
        if not isinstance(result, dict) or "rows" not in result:
            print("Could not read the activity list; the API response may have changed.")
            return 1
        rides = result["rows"]
        save_structure("igpsport-list", result)
        if not rides:
            print("No rides on this page.")
            return 0
        print(f"\niGPSPORT activities: page {page}/{result.get('totalPage', '?')}, {result.get('totalRows', '?')} total")
        for number, ride in enumerate(rides, 1):
            print(f"{number:2}. {igps_row(ride)}")
        selection = input("\nRide number, n for next page, or q to quit: ").strip().lower()
        if selection == "q":
            return 0
        if selection == "n":
            page += 1
            continue
        if not selection.isdigit() or not 1 <= int(selection) <= len(rides):
            print("Choose a listed number.")
            continue
        ride = rides[int(selection) - 1]
        break
    detail = client.get_activity_detail(ride["rideId"])
    print(f"\nSelected: {title(detail) if detail else title(ride)}")
    save_structure("igpsport-detail", detail)
    url = detail.get("fitUrl") or ride.get("fitOssPath")
    if not isinstance(url, str) or not url.startswith("https://"):
        print("This ride did not provide an HTTPS FIT download URL.")
        return 1
    import requests
    from security import validate_fit_url, RequestError
    try:
        url = validate_fit_url(url)
    except RequestError as error:
        print(error.message)
        return 1

    # Download separately so the iGPSPORT bearer token is not sent to file storage.
    with trace.wrap("fit.download_response", requests.get)(url, timeout=60, stream=True, allow_redirects=False) as response:
        if response.is_redirect:
            print("FIT download redirects are not allowed.")
            return 1
        response.raise_for_status()
        content = bytearray()
        for chunk in response.iter_content(65536):
            content.extend(chunk)
            if len(content) > 50 * 1024 * 1024:
                print("File exceeds the trial's 50 MB limit.")
                return 1
    if len(content) < 12 or content[8:12] != b".FIT":
        print("Download was not a recognizable FIT file. Nothing was uploaded.")
        return 1
    print(f"\nFIT retrieved successfully ({len(content):,} bytes).")
    trace.emit("fit.download_complete", {"fileSize": len(content)})
    try:
        summary = fit_summary(content)
        print(f"Ride: {summary['distance'] / 1000:.2f} km | {summary['duration'] / 60:.1f} min")
    except Exception:
        summary = None
        print("FIT summary unavailable; automatic verification will be unavailable.")
    if input("Connect Garmin to upload this ride? [y/N]: ").strip().lower() != "y":
        return 0
    def traced_garmin_factory(name, password, secret):
        instance = garmin_factory(name, password, secret)
        instance.client._run_request = trace.wrap("garmin.http", instance.client._run_request)
        return trace.instrument("garmin", instance, ("login", "get_activities", "get_activities_by_date", "get_activity", "upload_activity"))
    garmin, email = connections.get("garmin") if connections is not None else connect("Garmin", traced_garmin_factory)
    if garmin is None:
        return 1
    print("\nRecent Garmin activities (latest 5):")
    try:
        recent = garmin.get_activities(0, 5)
        if not isinstance(recent, list):
            raise ValueError("Unexpected Garmin list")
        for index, activity in enumerate(recent, 1):
            print(f"{index}. {garmin_row(activity)}")
        if not recent:
            print("No activities returned.")
    except Exception:
        print("Recent activity list unavailable. The duplicate check will run separately.")
    before = None
    if summary is not None:
        try:
            before = fetch_candidates(garmin, summary)
            existing = [a for a in before if matches(a, summary)]
            if existing:
                print("A matching ride is already in Garmin. No upload will be started.")
                for activity in existing:
                    print(f"https://connect.garmin.com/modern/activity/{activity['activityId']}")
                return 0
        except Exception:
            print("Could not check existing Garmin rides. Stopping to avoid a duplicate; try later.")
            return 1
    print(f"\nDestination: {email}")
    print(f"Source ride: {ride['rideId']} ({ride.get('startTime', '')})")
    print("Choose a ride not already in Garmin. This trial has no persistent sync history.")
    if input("Type UPLOAD to transfer this one ride: ").strip() != "UPLOAD":
        print("Cancelled. Nothing uploaded.")
        return 0
    with tempfile.TemporaryDirectory(prefix="apex-pulse-") as directory:
        fit = Path(directory) / "activity.fit"
        fit.write_bytes(content)
        try:
            result = garmin.upload_activity(str(fit))
        except Exception as error:
            save_diagnostic(getattr(error, "response", None), error)
            print(f"Upload did not return success ({type(error).__name__}).")
            print("Check Garmin before trying again: the upload may have been accepted.")
            check_uploaded_ride(garmin, summary, before)
            return 1
    outcome, ids = save_diagnostic(result)
    if outcome == "success":
        print("Garmin confirmed a successful import.")
        for activity_id in ids:
            print(f"https://connect.garmin.com/modern/activity/{activity_id}")
    elif outcome == "rejected":
        print("Garmin reported an import failure; this may be a duplicate or rejected file.")
        print("Check Garmin before retrying.")
    else:
        report = result.get("detailedImportResult", {}) if isinstance(result, dict) else {}
        if isinstance(report, dict) and report.get("uploadId"):
            print(f"Garmin received upload {report['uploadId']}. Checking whether the activity is available...")
        else:
            print("Garmin responded, but a successful import was not confirmed.")
        check_uploaded_ride(garmin, summary, before)
    return 0


def save_structure(operation, response):
    try:
        directory = ROOT / "logs"
        directory.mkdir(mode=0o700, exist_ok=True)
        path = directory / f"{operation}-{uuid.uuid4().hex}.json"
        with path.open("x") as handle:
            json.dump({"operation": operation, "response_shape": response_shape(response)}, handle, indent=2)
    except OSError:
        print("Could not save API response structure.")


def check_uploaded_ride(client, summary, before):
    if summary is None or before is None:
        print("Automatic verification unavailable. Check Garmin before uploading again.")
        return
    while True:
        try:
            activity_id = verify(client, summary, before)
        except Exception:
            activity_id = None
            print("Could not finish the Garmin activity check.")
        result = {"verification": "confirmed" if activity_id else "unconfirmed", "activityId": activity_id}
        try:
            directory = ROOT / "logs"
            directory.mkdir(mode=0o700, exist_ok=True)
            path = directory / f"verification-{uuid.uuid4().hex}.json"
            with path.open("x") as handle:
                json.dump(result, handle, indent=2)
            print(f"Verification log: {path}")
        except OSError:
            print("Could not save verification log.")
        if activity_id:
            print("Confirmed: a new Garmin activity matches the FIT start time, duration, and distance.")
            print(f"https://connect.garmin.com/modern/activity/{activity_id}")
            return
        print("Not yet confirmed. This does not mean the upload failed.")
        if input("Check again without uploading? [y/N]: ").strip().lower() != "y":
            return


def save_diagnostic(result, error=None):
    from upload_result import classify, normalize

    outcome, ids = classify(normalize(result))
    try:
        outcome, ids, path = record(result, ROOT / "logs", error)
        print(f"Sanitized upload diagnostic: {path}")
    except OSError:
        print("Could not save diagnostic log. Do not repeat the upload just to create a log.")
    return outcome, ids


if __name__ == "__main__":
    os.umask(0o077)
    try:
        sys.exit(main())
    except (KeyboardInterrupt, EOFError):
        print("\nTrial stopped.")
    except Exception as error:
        print(f"Trial stopped ({type(error).__name__}). Credentials and API responses are hidden.")
        sys.exit(1)
