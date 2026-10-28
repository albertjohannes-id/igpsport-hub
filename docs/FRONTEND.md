# iGPSPORT Hub web app

This guide is complemented by SECURITY.md and PWA.md, which define the current hardening and offline behavior. Python source now lives in `backend/`.

## Run locally

Double-click `Start Web.command`, or run `npm start` from the project folder. Open http://127.0.0.1:5173 and leave the terminal running. Ctrl+C stops both services. Requires the existing `.venv`, upstream trial code and `npm install` dependencies.

The browser talks to a loopback Python API through the local production preview server. It reuses the same `.local-auth` sessions as the combined terminal app. No iGPSPORT Hub account is required. Provider passwords are submitted for login and are not written to disk. Tokens and local transfer history have owner-only file permissions, but are not encrypted. Disconnect removes the local session, not the account or provider activities.

## Flow

Navigation uses hash routes (`#/home`, `#/igpsport`, `#/garmin`, `#/compare`); the route survives reload, back navigation and deep links. Deep-linking `#/compare` auto-runs a comparison once both accounts are connected.

1. Home checks each saved session by requesting activities. Green means the latest API check succeeded, not a guaranteed future expiry date.
2. Open iGPSPORT or Garmin Connect. Search loaded activities, load older pages, refresh, and open details. Metrics use km, km/h and labeled moving/timer/elapsed durations. Unknown values remain missing.
3. Select an iGPSPORT ride or up to ten rides. Connect Garmin if needed, then explicitly confirm the transfer.
4. The API checks for an existing matching Garmin activity, transfers the original FIT file, and checks for a confirmed activity ID. An upload receipt alone is not treated as confirmation.
5. Confirmed transfers show a Garmin activity link and update the current list. Uncertain results offer a status check; they cannot be uploaded again through this app while unresolved.

Garmin activity browsing and details are supported. Garmin → iGPSPORT transfer is not implemented because a working upload route has not been established. The UI states this in Garmin details.

Refresh shows an updated timestamp even when the provider returns the same rides. An unchanged list is not an expiry signal. Authentication rejection clears the visible list/selection and offers reconnect; a timeout or other transient failure changes the indicator to Unable to check and offers Retry connection without deleting tokens. No arbitrary 15-minute expiry assumption is used.

## Frontend API contract

Every request uses `X-Apex-Client: local-web`. Only loopback hosts and the local frontend origin are allowed. API responses use `Cache-Control: no-store`. Do not expose this API using a tunnel or public bind address.

| Method | Route                               | Purpose                                                      |
| ------ | ----------------------------------- | ------------------------------------------------------------ |
| GET    | `/api/status`                       | Verify saved sessions, capabilities, public transfer history |
| POST   | `/api/{provider}/login`             | Username/password or Garmin verification code                |
| POST   | `/api/{provider}/disconnect`        | Remove saved session                                         |
| GET    | `/api/{provider}/activities?page=1` | 20 normalized activities and `hasMore`                       |
| GET    | `/api/{provider}/detail/{id}`       | Normalized activity detail                                   |
| POST   | `/api/igpsport/transfer`            | Explicit transfer for `{ "id": "..." }`                      |
| POST   | `/api/igpsport/check`               | Verify a previous uncertain transfer without uploading       |

Errors have `{error, code?}` with HTTP status. Tokens, raw provider responses and FIT bytes are never sent to the frontend. Trace records live in `logs/`; API responses only expose necessary activity fields. Transfer history is isolated by the connected account pair and survives automatic token refresh. Sessions imported from terminal tests receive a local identity marker; reconnecting for the first time through the web may start a new history scope. Pre-upload matching still checks Garmin.

## Cloudflare status

`npm run cf:check` type-checks and builds the frontend and Worker, then runs Wrangler deployment validation without publishing. The output uses Workers static assets; no paid service is required by this configuration. `npm run preview` runs the built Worker locally.

**Only the interface is Cloudflare-ready today.** The Worker deliberately returns `cloud-preview` with login/transfer disabled. Python integrations do not become Workers-compatible simply by deploying the UI. No D1 database, account, secret, or production deployment has been created.

To complete Cloudflare hosting, port and test provider authentication, MFA, token refresh, FIT download and Garmin upload/verification in the Workers runtime. Then add a random browser session cookie, encrypted provider tokens, D1 transfer history, per-session isolation, CSRF protection and request limits. Validate outbound provider access and free-plan resource limits with real accounts before enabling cloud login. Keep tokens on the server and do not reuse the local API as a public backend.

The upstream trial dependency has no confirmed reusable license and remains isolated in `upstream-trial/`; resolve licensing or replace it before distributing its implementation.

## Validation

Run `npm run test:python`, `npm run test:ui`, and `npm run cf:check`. UI tests intercept all API calls with explicit fixtures, including login and transfers. They never authenticate to or upload to the real providers. Live read-only verification covers saved iGPSPORT reuse, listing and activity detail. A real browser login and user-confirmed upload still need Albert's next test; the UI tests do not establish live Garmin authentication or MFA compatibility.
