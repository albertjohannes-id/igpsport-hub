# Development and conventions

[Project provenance](PROVENANCE.md) records the upstream source, exact reuse boundary, license status and dependency checkout instructions.

## Setup

1. Install Node/npm and Python 3.12 or newer. Run commands from the repository root.
2. `npm ci` installs locked frontend/build/test tools.
3. `python3 -m venv .venv`, then `.venv/bin/pip install -r requirements-trial.lock.txt`.
4. The local iGPSPORT adapter imports `sync_igpsport_to_garmin` from the isolated `upstream-trial/` checkout, evaluated from `hmqgg/iGPSport2Garmin` commit `5a5f635491468cc63943a44db52d2d62a53b2054`. Do not run its automatic-sync entry point. A reusable license has not been confirmed; resolve permission or replace this adapter before distribution. Do not silently fetch a different revision.
5. `npx playwright install chromium` installs the test browser.
6. `npm run dev:all` runs the local API and hot-reload frontend. `npm start` builds and serves the production/PWA version at the same origin.

No Cloudflare account is needed for local work or `npm run cf:check`. `npm run preview` starts the Worker preview, which deliberately cannot access local sessions. Deployment requires a separate explicit decision and Cloudflare credentials.

## Conventions

The product name is **iGPSPORT Hub** (formerly Apex Pulse). The repository folder is `igpsport-hub`; the Cloudflare Worker identifier remains `apex-pulse`. Existing `apex-*` browser storage keys, cookies, cache namespace, session lock, internal Python module names, and `X-Apex-Client` header remain stable for compatibility; do not rename them as a cosmetic branding change.

- TypeScript is strict. React components are PascalCase; utility modules are lower camel case; Python files/functions use snake_case.
- Browser/API DTO fields use camelCase. Python internal names use snake_case. Never expose raw provider payloads as a frontend contract.
- Metric names include canonical units (`distanceMeters`, `averageSpeedMps`, `averageHeartRateBpm`). Missing values are null, not invented zeroes. Duration meanings remain distinct.
- Relative imports stay within the owning layer. Python scripts run from `backend/`, making sibling imports explicit; the test runner adds that directory to sys.path. Do not import Python modules from the repository root.
- `.editorconfig` sets LF, UTF-8, 2-space web files and 4-space Python. Prettier is a development-only formatter; `npm run format` and `npm run format:check` enforce supported source/docs. Python is not formatted by Prettier.
- Use `AsyncButton` for network actions with a pending label; keep native form submission and duplicate-submit protection. Retain keyboard/focus behavior and touch targets when changing density.
- No direct HTML injection, external runtime scripts or credential-bearing URLs. Use React text rendering and typed data.
- Do not add a dependency for a trivial browser/standard-library capability. Runtime web dependencies remain React and React DOM. Prettier and Playwright are development tools only; there is no PWA plugin, UI component framework, state library or security middleware dependency.
- Keep changes focused; tests should cover behavior and security boundaries, not snapshot implementation details.

## Tests

- `npm run test:python`: isolated unit tests plus a real loopback HTTP handler with mocked providers. The runner is `scripts/test-python.py`.
- `npm run test:ui`: intercepted API fixtures; starts/reuses a dev frontend. Covers normal/error/uncertain flows, Enter submission, duplicate protection and responsive themes.
- `npm run test:production`: builds, starts a temporary Worker on port 4173, checks real headers/manifest/icons/service worker/offline recovery, then stops it. No live provider calls.
- `npm run cf:check`: strict type checks, Vite build and Wrangler dry run, no publishing.
- `npm run audit:python`: OSV query of pinned Python package metadata only; exits nonzero for findings or an incomplete check.
- `npm audit`: npm advisory lookup. Python dependency advisory checks should use the locked requirements (OSV or pip-audit) without sharing local session files. Absence of advisories is not a security guarantee.
- `npm run cf:types`: regenerate the generated Env types after bindings/configuration change; do not edit `worker-configuration.d.ts` manually.

Tests never need real passwords, tokens, uploads or activity deletion. Real transfer tests are a separate user-confirmed workflow. Keep all diagnostic samples sanitized.

## Folder migration (2026-10-18)

Python source moved from root to `backend/`; Python tests moved to `tests/python/`. The root `.command` launchers were updated. `.local-auth`, logs and the upstream checkout did not move. Replace older `.venv/bin/python web_api.py` with `.venv/bin/python backend/web_api.py`; replace old unittest commands with `npm run test:python`. Archived docs retain historical paths.

## Dependency and asset maintenance

Commit package.json and package-lock.json together after reviewing an update. Exact package versions are declared; use `npm ci` for repeatability. Keep the Python requirements lock intact unless intentionally updating it. Review install scripts before enabling them.

Provider favicon provenance is in ASSETS.md. The PWA icon is a simple iGPSPORT Hub IH monogram in `public/icons/icon.svg`; PNG sizes are generated by `node scripts/generate-icons.mjs` using the existing test browser. No image-generation service is used. Changes to cache content require incrementing the service-worker cache version.
