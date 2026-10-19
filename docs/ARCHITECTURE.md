# Architecture

[Project provenance](PROVENANCE.md) records the upstream source, exact reuse boundary, license status and dependency checkout instructions.

## Two execution modes

**Working local app:** browser → same-origin frontend on 127.0.0.1:5173 → `/api` proxy → Python on 127.0.0.1:8788 → provider APIs and approved FIT storage. The backend remains loopback-only; each web request restores only that browser’s encrypted credentials. `.local-auth` and `logs` remain at the repository root after the folder migration.

**Cloudflare preview:** browser → Workers static assets; `/api/*` → `worker/index.ts`. This Worker reports unavailable connections and rejects account mutations. It has no credentials, D1 database, bridge to localhost or live provider integration. Static responses use `public/_headers`; Worker responses use `worker/security.ts`. Keep these policies aligned and verify them with production tests.

## Source responsibilities

- `src/App.tsx`: Home/provider navigation, activity selection, native dialogs, login/MFA, explicit transfer confirmation and result state.
- `src/api.ts`: typed boundary, same-origin requests, custom request header and normalized errors; no credential persistence.
- `src/components.tsx`: shared async button/spinner and provider logo.
- `src/pwa.ts`, `public/sw.js`: production-only registration and public offline fallback.
- `backend/web_api.py`: local HTTP boundary and orchestration. `Service` handles provider operations per request; `BrowserRuntime` isolates MFA and `browser_storage.py` manages client-held encrypted sessions.
- `backend/security.py`: exact FIT-host policy, public DNS checks, typed request validation and rate limiting.
- `backend/activities.py`: provider-neutral data and explicit SI units. Presentation converts metres to km and m/s to km/h.
- `backend/connections.py`, `backend/login_flow.py`, `backend/session_trial.py`: session/CLI authentication helpers and private atomic local persistence.
- `backend/verification.py`: FIT-session parsing, before/after Garmin candidates and strict metric matching.
- `backend/upload_result.py`, `backend/diagnostics.py`: conservative success classification and redacted diagnostics.
- `backend/apex_local.py`: combined terminal app. `trial.py` and `session_trial.py` preserve experimental/manual diagnostic flows.

## Transfer state

1. Load connected source and destination sessions.
2. Fetch the selected iGPSPORT detail, validate the returned HTTPS FIT host, download within bounds and parse the FIT session.
3. Read Garmin candidates. A matching existing ride avoids an upload.
4. The browser persists a `received` record before sending the transfer request. Private matching data is returned as an encrypted receipt with the result.
5. Upload one original FIT file. An upload receipt is not necessarily an activity ID.
6. Use an explicit successful activity ID or verify a unique new Garmin activity against start time, duration and distance. Save `confirmed` or `unconfirmed`.
7. Refresh the visible list. Unconfirmed records only allow read-only checking, never automatic resubmission.

Matching is heuristic, not an official Garmin upload-status endpoint. Ambiguity stays unconfirmed. Client-selected batches run sequentially and stop on uncertainty. A tab close does not cancel a backend operation already accepted; restart/check before attempting anything else.

## Persistence and isolation

Passwords are transient login inputs. The web app stores provider tokens in separate encrypted HttpOnly cookies, and recent history plus encrypted matching receipts in browser localStorage. Cookies last at most 30 days unless refreshed, with a 3,800-byte per-cookie guard. History is scoped to the connected provider account pair and capped at 200 entries/1 MB. The backend keeps only the encryption key on disk and transient MFA state in memory. Old CLI session/history files are not imported or deleted. See BROWSER-STORAGE.md for exact behavior and limitations.

The browser holds activity data in memory and stores the theme and bounded transfer history in localStorage. The service worker stores only the generic offline HTML/CSS, never app/API responses. No analytics, external fonts, runtime CDN or PWA library is added.

## Deployment direction

Replace the Python adapter with verified Workers-compatible provider code before enabling cloud login. Keep v1 free of D1: port the encrypted provider cookies with HTTPS/Secure attributes and a Worker secret, retain browser-local history, and add production CSRF defense and shared/distributed rate limiting. Do not expose the single-user Python server, a public Vite server or a localhost tunnel as a production shortcut. See SECURITY.md for release gates.
