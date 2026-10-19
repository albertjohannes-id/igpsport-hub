# iGPSPORT Hub unofficial integration notes

Last updated: 2026-10-17. These are observations from the local trial and installed
client code, not vendor guarantees. No developer account or official OAuth access
was used. Cloudflare compatibility remains untested.

Latest live evidence and negative cases: [TEST-JOURNEY.md](TEST-JOURNEY.md).
That run confirmed HTTP 202 followed by delayed activity availability, recent
Garmin listing, both login retries, and empirical distance/time/speed units.
It supersedes the earlier pending-validation notes below for those items.

[Project provenance](PROVENANCE.md) records the upstream source, exact reuse boundary, license status and dependency checkout instructions.

Public JSON examples use synthetic activity/upload identifiers. Original diagnostic logs and personal ride measurements are excluded.

## Sources and reproducibility

- iGPSPORT reference: `hmqgg/iGPSport2Garmin`, commit
  `5a5f635491468cc63943a44db52d2d62a53b2054`. No license file was present;
  reuse permission remains unresolved. The checkout is isolated in `upstream-trial/`.
- Garmin implementation: installed `garminconnect==0.3.19` (MIT).
- Exact Python dependency versions: `requirements-trial.lock.txt`.
- FIT metrics: `fitdecode`, one session required for matching.

## Flow and operations

| Stage                      | Request / client operation                                                   | Status                                                     |
| -------------------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------- |
| iGPSPORT login             | POST `/service/auth/account/login`                                           | Live success observed                                      |
| List rides                 | GET `/service/web-gateway/web-analyze/activity/queryMyActivity`              | Live success observed                                      |
| Ride details               | GET `/service/web-gateway/web-analyze/activity/queryActivityDetail/{rideId}` | Live success observed                                      |
| FIT retrieval              | GET HTTPS `fitUrl` with no iGPSPORT bearer header                            | Live success observed                                      |
| Garmin login               | `Garmin.login()` incl. library SSO/MFA strategies                            | Live success observed; exact winning strategy not captured |
| Recent Garmin rides        | `get_activities(0, 5)`                                                       | Newly added; live trial pending                            |
| Date-filtered Garmin rides | `get_activities_by_date(startdate, enddate)`                                 | Live verification succeeded                                |
| Garmin summary/details     | `get_activity(id)`, `get_activity_details(id)`                               | Available in installed client; not called by this trial    |
| Garmin upload              | `upload_activity(path)`                                                      | File imported; response alone did not confirm creation     |

iGPSPORT international base: `https://prod.en.igpsport.com`.
Login request fields are `username`, `password`, `appId` (`igpsport-web`).
Success uses response `code: 0`, `data.access_token`. Never persist the token or
request body in logs. Listing query: `pageNo`, `pageSize`, `reqType: 0`, `sort: 1`.
The upstream login client collapses errors into `False`; HTTP observations allow
some classification, but an HTTP-200 application rejection remains ambiguous.
Do not claim a wrong password unless supported by the response.

## Observed iGPSPORT response mapping

List payload has `pageNo`, `pageSize`, `totalPage`, `totalRows`, and `rows`.

| Row field         | Display meaning                 | Confidence                                            |
| ----------------- | ------------------------------- | ----------------------------------------------------- |
| `rideId`          | Source activity identifier      | Observed                                              |
| `title`           | Activity name                   | Observed; corrected old `rideName`/`name` fallback    |
| `startTime`       | Display date, e.g. `YYYY.MM.DD` | Observed; not suitable for precise matching           |
| `rideDistance`    | Distance                        | Field observed; unit pending validation               |
| `totalMovingTime` | Moving time                     | Field observed; unit pending validation               |
| `avgSpeed`        | Average speed                   | Field observed; unit pending validation               |
| `totalAscent`     | Ascent, metres                  | List/detail 57 matched FIT session 57 m on 2026-10-18 |
| `productName`     | Device name                     | Field observed                                        |

Detail payload additionally includes `totalTime`, `movingTime`, `endTime`,
`avgMovingSpeed`, `maxSpeed`, heart-rate fields (`minHrm`, `avgHrm`, `maxHrm`),
cadence (`avgCad`, `maxCad`), altitude, calories, temperature, zone arrays and
`fitUrl`. Field presence does not establish meaningful data: absent sensors may
produce nulls or sentinel values. Do not interpret zero as missing without evidence.
List and detail numeric types differ; do not assume identical scaling.

## Actual sanitized upload response example

This is a selected subset of an observed response with a synthetic upload ID. Empty result arrays are preserved:

```json
{
  "detailedImportResult": {
    "uploadId": 1001,
    "fileSize": 6819,
    "processingTime": 77,
    "successes": [],
    "failures": []
  }
}
```

Additional observed fields: `uploadUuid.uuid` (string), `owner` (integer),
`creationDate` (string), `ipAddress` (string), `fileName` (string), `report` (null).
Their values were not retained. `processingTime` units are not established.
The library returns a decoded dict, so the old upload-result log has no HTTP
status. New transport instrumentation records statuses when available.

An upload ID identifies an upload; it is not a Garmin activity ID. Empty success
and failure arrays are inconclusive. Asynchronous processing is a hypothesis,
not a proven contract. No upload-status endpoint has been validated.

## Confirming creation

Read the FIT session's UTC `start_time`, `total_timer_time` (seconds), and
`total_distance` (metres). Fetch Garmin candidates for the ride day plus adjacent
days to cover the date filter's local timezone. Save the pre-upload IDs in memory.

After upload, fetch up to four times with five-second pauses. A confirmation
requires exactly one new ID matching `startTimeGMT` within 2 seconds, `duration`
within 3 seconds, and `distance` within 20 metres. More than one match stays
unconfirmed. A pre-existing match prevents upload. Missing FIT metrics disable
automatic verification. This is metric matching, not cryptographic identity;
concurrent identical imports could still be ambiguous.

Observed verification result (synthetic activity ID):

```json
{ "verification": "confirmed", "activityId": "1002" }
```

The user confirmed the resulting activity link worked. Read-only checking can
repeat without uploading. No automated re-upload occurs on an uncertain outcome.

## Diagnostics and privacy

`logs/run-*.jsonl` correlates operations in one trial via sequence and UTC time.
It records operation name, elapsed time, status when exposed, exception class,
sanitized response subset and response field/type structure.

Coverage: public login/list/detail/upload operations, iGPSPORT HTTP requests,
Garmin API transport calls, FIT download response/completion, and all verification
list calls. Garmin login is one high-level event: its internal SSO, MFA and token
refresh requests are not individually instrumented. API transport retries and
redirects may be aggregated. FIT response timing is time to response headers;
the completion event records downloaded size. This is not a full network capture.

Request arguments, headers, credential values, cookies, token values, URLs with
signatures, free-text response values, raw exception messages, GPS samples and FIT
contents are never intentionally logged. Allowed numeric metrics and activity IDs
are retained. Unknown fields retain structure only; bounded schema samples do not
represent every list item. Auth token subtrees are redacted. Log files are local,
owner-only, and excluded from Git. They still contain activity identifiers/metrics.

Existing `upload-*.json`, `verification-*.json` and `igpsport-*.json` files remain
useful, but older ones are not correlated to a run ID. Read timestamps carefully.
Examples/schema snapshots in this folder are sanitized; never copy raw credentials
or signed URLs into documentation. Keep future observations separate from assumptions.

## Remaining validation

- Confirm newly added recent-activity display and tracing in a live trial.
- Compare iGPSPORT raw numeric values with FIT metrics to establish units.
- Test wrong-password, MFA rejection, expiry, rate limiting, duplicates and delayed imports.
- Validate Workers Free authentication/runtime compatibility separately.

## Authentication lifetime (checked 2026-10-17)

The current trial keeps authentication in process memory only and does not supply
a Garmin tokenstore. Exiting the trial discards our copy, but does not revoke the
provider-issued tokens. Every new trial currently asks for credentials again.

iGPSPORT's observed login response includes `access_token`, `refresh_token`, and
`expires_in`. The old sanitizer kept only the `expires_in` type, so its numeric
value is not recoverable from our existing logs. The reference client uses only
the access token and has no refresh implementation. Access lifetime, refresh
endpoint, rotation behavior and refresh-token lifetime remain unvalidated.

The Garmin client documentation describes automatic DI token refresh while the
refresh token remains valid; credentials/MFA are needed again after expiry or
revocation. It does not promise a fixed maximum connected duration:
https://github.com/cyberjunky/python-garminconnect#-authentication

Installed garminconnect 0.3.19 reads the access token's JWT `exp` and attempts refresh
when less than 900 seconds remain, before API requests. That 15-minute window is a
refresh threshold, not token lifetime. Refresh can rotate the refresh token. An
unverified decoded expiry is only a scheduling hint, not proof of authentication.
Our successful short trials have not exercised expiry or refresh.

Proposed web behavior: retain encrypted provider tokens server-side, keep a separate
opaque browser session, refresh when needed, and request reconnect only for the
affected provider when refresh fails. App-session retention is our policy and must
not be presented as a guaranteed provider-token lifetime. Not implemented yet.

## Expanded frontend metrics (2026-10-18)

Read-only comparison of iGPSPORT detail and its original FIT session validated speed in m/s, heart rate in bpm, cadence in rpm, energy in kcal, ascent in metres and elapsed time in seconds. Personal measurements are omitted from this public record. Absent metrics remain null; zero heart rate/cadence is treated as unavailable sensor data. Garmin mappings use maxSpeed, averageHR, maxHR, averageBikingCadenceInRevPerMinute, maxBikingCadenceInRevPerMinute and calories where supplied. Garmin fields remain optional. No new login or upload was performed during this comparison.

Lists add average speed and ascent, plus heart rate/calories when included by the list endpoint. Opening detail fetches the richer record, including max speed, heart rate, cadence, calories and elapsed time. No extra detail call is made for every list row.

## Browser storage trial (2026-10-18)

The local web entry point now creates a request-scoped Service from encrypted provider cookies. It does not reuse CLI credential or history files. `/status` includes `historyScope` (null until both accounts are connected); its history array is empty and the frontend supplies browser-local history for that scope. Legacy/mocked responses without `historyScope` retain the old response interpretation.

Successful login returns `storage: "browser"`. GET `/api/storage` reports provider names and keyed opaque proofs of the saved sessions. The frontend compares the proof with `storageProof` from login to verify that the newly issued session (rather than a stale cookie) persisted, without revealing credentials. Disconnect expires the provider cookie. Refresh returns a replacement Set-Cookie header. All responses remain no-store.

Transfer/check accept an optional opaque `receipt` (max 6,000 characters), authenticated and bound to the connected account pair and activity. Results include a new receipt holding private matching metadata. No raw tokens or matching metadata enter JSON. Check without a receipt performs read-only source/Garmin matching to recover after an interrupted request and never uploads. History is display/recovery state, not server authorization.
