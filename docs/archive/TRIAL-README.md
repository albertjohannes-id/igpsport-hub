# iGPSPORT Hub integration trial

## Web app

Open `Start Web.command`, then http://127.0.0.1:5173. The new responsive interface combines saved sessions, activity browsing, details and confirmed transfers. See [the frontend guide](docs/FRONTEND.md) for the flow, testing and Cloudflare deployment scope. The frontend and Worker preview build are ready; live cloud integrations and D1 are not implemented yet.

The older standalone-trial instructions below describe their specific scripts. The web app saves provider sessions and transfer history locally.

## Combined local app

Both `Start Trial.command` and `Session Test.command` now open `apex_local.py`.
Use this entry point for saved sessions, activity selection, Garmin browsing and
details, transfer, Garmin refresh, reconnect and disconnect. Actions return to Home.
Choose 0 to exit. Existing `.local-auth` sessions are reused and validated on demand.
New connections offer to save locally; passwords are not saved. The old standalone
scripts below remain implementation/diagnostic helpers, not the recommended launchers.
The combined flow supersedes older notes saying session reuse and upload are separate.

Choose 1 to browse iGPSPORT and select a ride. Saved Garmin credentials are reused
when preparing a transfer. Transfers still require `UPLOAD`; completed actions return
to Home. Choose 2 to read Garmin activities and details without transferring anything.
Lists fetch fresh data when opened. No reverse Garmin-to-iGPSPORT transfer is supported.

Integration contracts, observed examples, field mappings and outstanding questions:
[docs/API-NOTES.md](docs/API-NOTES.md). Sanitized observed iGPSPORT schemas are in
`docs/response-examples/`.

The trial displays actual iGPSPORT titles and additional list metadata, then the five
most recent Garmin activities after login. iGPSPORT values with unverified units
are explicitly labeled API units; FIT and Garmin summaries use kilometres/minutes.
Each run prints a `logs/run-*.jsonl` path containing correlated sanitized operation
events. Coverage and exclusions are documented in the API notes.

Double-click `Start Trial.command` in Finder, or run:

```sh
cd /path/to/igpsport-hub
./.venv/bin/python trial.py
```

This is a local terminal trial, not the planned Cloudflare web app.
Enter passwords in Terminal; password input is hidden. Do not paste them into chat.

1. Log in to an international iGPSPORT account.
2. Select one ride from the paginated list.
3. The trial downloads and checks its FIT file.
4. Optionally connect Garmin, including MFA if requested.
5. Type `UPLOAD` to import that single ride.
6. Check Garmin Connect for the ride and its metrics.

No passwords or tokens are intentionally persisted. A temporary FIT file is removed
when the upload attempt finishes. No source rides are deleted. No automatic retries
or bulk uploads run. If an upload errors, check Garmin before retrying because the
server may already have accepted it. Persistent duplicate detection is not implemented.

The isolated `upstream-trial` checkout comes from
https://github.com/hmqgg/iGPSport2Garmin and supplies its iGPSPORT client unchanged.
Its original automatic-sync entry point is not run. No license file was present
when evaluated; do not redistribute its code as iGPSPORT Hub until permission is resolved.
Garmin uploads use the installed MIT-licensed `garminconnect` package instead of
the upstream Garmin wrapper. This trial therefore evaluates a combined path,
not the upstream script unchanged.

Dependency versions are recorded in `requirements-trial.lock.txt`.
Local success does not establish compatibility with Cloudflare Workers.

Evaluated upstream commit: `5a5f635491468cc63943a44db52d2d62a53b2054`.

Upload diagnostics are saved under `logs/upload-<unique-id>.json` after an upload
response or upload exception. They include result structure, numeric activity IDs,
numeric error codes, and an HTTP status when the library exposes it. Arbitrary text,
filenames, and unrecognized fields are redacted or omitted; request headers and
credentials are never captured. Logs are excluded from Git and created with owner-only
permissions. Successful results with an activity ID print a Garmin activity link.
Unknown and mixed responses remain unconfirmed. Logs from earlier runs cannot be recovered.

Run response-handling checks with `.venv/bin/python -m unittest test_upload_result.py`.

Login failures offer up to three attempts. Press Enter to keep the previous username,
enter a fresh password, or type `q` at the username prompt to cancel. Explicit rate
limits stop retries. Authentication rejection, connection failure, and ambiguous
API failures have separate messages; ambiguous failures are not labeled wrong passwords.
Garmin login retries preserve the already selected and downloaded ride.
Numeric upload IDs, file sizes, and processing times are now retained in diagnostics.
An upload ID alone is not treated as confirmation that an activity was created.

The trial now parses the downloaded FIT session to show distance and timer duration.
Before uploading, it checks Garmin for a matching ride. A match prevents the upload;
failure to fetch existing rides stops the attempt. After an unconfirmed upload response
or upload exception, it checks up to four times for a new activity with matching UTC
start time (within 2 seconds), timer duration (3 seconds), and distance (20 metres).
Ambiguous matches stay unconfirmed. This is metric-based verification, not a Garmin
upload-status endpoint. Multiple-session or incomplete FIT files cannot use this check.
The user can repeat the read-only check without repeating the upload.
Verification results are saved separately in `logs/verification-*.json`.
iGPSPORT list/detail response field names and types are saved without field values
to identify available metadata. This is not a full HTTP request trace.
