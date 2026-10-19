# Local session and normalization trial

Update 2026-10-18: both command launchers now open the combined `apex_local.py` menu.
Existing sessions are validated and reused automatically when choosing a provider.
Reconnect offers to save a new session; disconnect removes it from memory and disk.
The menu remains open after browsing, transfer, validation and refresh. The original
standalone experiment described below is retained for reference; its separate-tool
limitation no longer applies to the combined app. iGPSPORT refresh is still unvalidated.

Run `Session Test.command` in Terminal. This is a separate read-only test, not the
web app, and does not upload or delete any activity.

1. Choose iGPSPORT or Garmin, then **Connect and save**. Log in and fetch five rides.
2. Close the tool. Reopen, choose the same provider and **Reuse saved session**.
   This loads saved tokens without asking for credentials and verifies activity access.
3. For Garmin, reopen and choose **Refresh saved Garmin session**. This requests
   refresh early, persists any rotated tokens, and verifies access with a list request.
4. Reopen with Reuse to verify persisted refreshed state.
5. **Forget local session** removes only the local token file, not provider access.

Tokens live in `.local-auth/` (Git ignored, directory 0700, files 0600). They are
not encrypted at rest in this local prototype. No passwords are stored. Logs remain
separate and sanitized. The normal upload trial still asks for credentials; it does
not consume these saved sessions yet.

Garmin refresh uses the installed client's private `_refresh_di_token` method for
this diagnostic experiment; pin the library version and do not treat it as a stable
public API. A non-DI login is not saved as a reusable session. Token rotation is
persisted immediately even if the subsequent activity read fails. Successful reuse
can include automatic refresh, so inspect `garmin.refresh` events to distinguish it.
Manual refresh does not establish natural lifetime. Actual expiry and refresh have
not yet been tested live with this tool.

iGPSPORT retains the observed `expires_in` value and receipt timestamp. Its lifetime
units and refresh endpoint are not yet independently validated; do not turn this
number into a hard promise. Reuse verifies the access token with an actual request.
Refresh is explicitly unavailable instead of guessing an endpoint.

`activities.py` provides a shared schema for both lists, using metres, seconds and
metres/second. Moving, timer and elapsed durations remain distinct. Unknown values
are null. iGPSPORT date-only values do not become invented UTC timestamps. Ascent
normalization for iGPSPORT remains null until its units are validated.

## Proposed simple web journey (not implemented)

- Home: two provider connections and recent transfer results, no analytics dashboard.
- iGPSPORT / Garmin tabs: matching Date, Activity, Distance, Time, Status tables.
  Display the duration type so moving time is not confused with elapsed time.
- Connection labels: Checking, Connected (green), Not connected, Reconnect needed,
  Unable to check. A saved token alone does not establish Connected. Include text
  alongside color and record the last successful check.
- Tap a row: detail panel; keep the list position when closing it.
- iGPSPORT detail: Send to Garmin. If Garmin needs login, preserve the selected ride.
- Transfer: Uploading, Received/checking, Confirmed, or Unconfirmed/check again.
  Show the activity link only when known. Keep raw response data in diagnostics.
- After confirmation: mark the source ride synced, refresh the destination list,
  and refresh the visible list without discarding its position or selection.
- Garmin detail initially supports viewing. The current reference has no iGPSPORT
  upload implementation, so there is no reverse-transfer action until validated.

Future visual implementation will need the antislop usage-mode choice before UI
work starts. This document records interaction requirements, not a completed design.
