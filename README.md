# iGPSPORT Hub

Source: [albertjohannes-id/igpsport-hub](https://github.com/albertjohannes-id/igpsport-hub).

A lightweight local app for browsing iGPSPORT and Garmin activities and explicitly transferring selected iGPSPORT FIT files to Garmin. No iGPSPORT Hub signup, automatic syncing, or background uploads.

## Origin and credits

iGPSPORT Hub builds on the iGPSPORT client from **[hmqgg/iGPSport2Garmin](https://github.com/hmqgg/iGPSport2Garmin)**, pinned to commit `5a5f635491468cc63943a44db52d2d62a53b2054`. The local backend imports its `IGPSportClient` from the isolated `upstream-trial/` checkout. Garmin operations use the separate [python-garminconnect](https://github.com/cyberjunky/python-garminconnect) library.

This is a separate app built around that client, with our own web UI, local API, browser sessions, explicit transfer flow and result verification. The upstream automatic-sync entry point is not run. This workspace is not currently a formal Git/GitHub fork.

The pinned iGPSPORT source has no license file and reuse permission remains unresolved. See [project provenance](docs/PROVENANCE.md) for the exact reuse boundary, differences, attribution status and reproducible checkout instructions.

## Run

Double-click **Start Web.command**, or run `npm start`, then open http://127.0.0.1:5173. This builds the production frontend, starts the loopback Python API, and serves the installable PWA. Keep the terminal running; Ctrl+C stops both processes. Provider connections are remembered in this browser using encrypted HttpOnly cookies. Reconnect once after upgrading from shared local-file sessions.

For frontend development with hot reload, use `npm run dev:all`. Service workers are registered only in production builds.

A fresh checkout needs Node/npm, Python 3.12+, `npm ci`, a `.venv` with `pip install -r requirements-trial.lock.txt`, and the isolated upstream integration dependency described in [setup](docs/DEVELOPMENT.md).

## Current scope

- Local: provider sessions, login/MFA UI, normalized lists/details, explicit transfer confirmation, duplicate matching and delayed-result verification.
- PWA: manifest, install icons, standalone display, safe offline notice. The service worker never caches API responses or queues uploads. Recent transfer history is stored in browser localStorage.
- Cloudflare: deployable interface preview, restrictive security headers, disabled account operations. **Cloud provider integration is not implemented. V1 uses client-held encrypted sessions and browser-local history; no D1 is needed.**
- Direction: iGPSPORT → Garmin only. Garmin → iGPSPORT is not supported.

See [browser storage and testing](docs/BROWSER-STORAGE.md) for persistence limits and the local test steps.

## Project layout

| Folder              | Purpose                                                       |
| ------------------- | ------------------------------------------------------------- |
| `src/`              | React/TypeScript frontend and CSS                             |
| `backend/`          | Python provider adapters, local HTTP API, CLI and diagnostics |
| `worker/`           | Cloudflare preview and response security headers              |
| `public/`           | PWA manifest, service worker, offline page and local icons    |
| `scripts/`          | Launch, test and reproducible icon-generation helpers         |
| `tests/python/`     | Backend unit and HTTP-boundary tests                          |
| `tests/ui/`         | Mocked frontend journeys and responsive checks                |
| `tests/production/` | Real built Worker/PWA/header/offline checks                   |
| `docs/`             | Architecture, contracts, security, operation and handover     |

Runtime folders `.local-auth/`, `logs/`, `.venv/`, `node_modules/`, `.wrangler/`, `dist/`, `test-results/` and `upstream-trial/` are private/generated/ignored, not distributable source. The three `.command` launchers stay at the root for convenient macOS use.

## Public source and local data

This repository contains application source, documentation and tests. Credentials, local sessions, diagnostic logs, activity exports, dependencies, generated output and the isolated upstream checkout are excluded by `.gitignore`. Public response examples use synthetic activity/upload IDs and omit personal ride measurements.

Publishing this source does not resolve the upstream client's outstanding reuse permission or make the Cloudflare preview a working hosted integration. The app is an independent project and is not presented as an official iGPSPORT or Garmin product.

## Checks

```sh
npm run test:python
npm run test:ui
npm run test:production
npm run cf:check
npm run format:check
npm audit
```

Browser tests need `npx playwright install chromium` once. `PW_CHANNEL=chrome npm run test:ui` can use installed Chrome instead. Tests do not upload real activities.

## Documentation

Start with the [documentation index](docs/README.md), [security model](docs/SECURITY.md), and [AI/developer handover](docs/AI-HANDOVER.md). The [old trial README](docs/archive/TRIAL-README.md) is historical and does not describe current launch paths or security behavior.
