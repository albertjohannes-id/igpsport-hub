# Project origin and upstream dependencies

Verified against the local source and upstream checkout on 2026-10-19.

## Where iGPSPORT Hub comes from

iGPSPORT Hub, previously named Apex Pulse, builds on the iGPSPORT integration from **[hmqgg/iGPSport2Garmin](https://github.com/hmqgg/iGPSport2Garmin)**. Credit for that client belongs to its upstream contributors.

The evaluated revision is [`5a5f635491468cc63943a44db52d2d62a53b2054`](https://github.com/hmqgg/iGPSport2Garmin/tree/5a5f635491468cc63943a44db52d2d62a53b2054). Its checkout lives in `upstream-trial/`, with origin `https://github.com/hmqgg/iGPSport2Garmin.git`. At verification, tracked upstream files had no local modifications; only generated `__pycache__/` files were untracked.

[iGPSPORT Hub](https://github.com/albertjohannes-id/igpsport-hub) is a separate application using an upstream client dependency. The application is maintained separately from the upstream checkout; it has no GitHub fork relationship to that project. Describe it as “built on the iGPSPORT client from hmqgg/iGPSport2Garmin” rather than claiming it is a fork of the upstream repository.

## What is reused

The source is [`sync_igpsport_to_garmin.py` at the pinned revision](https://github.com/hmqgg/iGPSport2Garmin/blob/5a5f635491468cc63943a44db52d2d62a53b2054/sync_igpsport_to_garmin.py), specifically its `IGPSportClient` class.

- `backend/session_trial.py` and `backend/trial.py` add `upstream-trial/` to the Python import path and import `IGPSportClient`.
- `backend/connections.py` obtains that class through `session_trial.py`. The local web backend uses these connection helpers.
- The integration uses the client for iGPSPORT authentication, activity listing and activity details. Hub adds session restoration, request instrumentation, timeouts, normalization and web-specific handling around the client.
- Hub downloads selected FIT files through its own validation and transfer flow. It does not invoke upstream's automatic-sync entry point.
- Garmin access uses `Garmin` from the separately installed `garminconnect` package, rather than the upstream script's Garmin wrapper. The evaluated version is `0.3.19`; exact Python dependencies are in `requirements-trial.lock.txt`. Its source project is [cyberjunky/python-garminconnect](https://github.com/cyberjunky/python-garminconnect).

The upstream checkout is therefore still a runtime requirement for the local provider integration. It is not merely research material, and installing Python packages alone does not supply it.

## How this application differs

The upstream project describes an automatic iGPSPORT-to-Garmin synchronization script with a scheduled GitHub Actions workflow. Hub changes the interaction to a local app where the user chooses and confirms transfers.

| Area                | iGPSPORT Hub implementation                                                                                             |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| User interface      | React/TypeScript app with Home, iGPSPORT and Garmin views, searchable paginated activities, details and theme selection |
| Transfers           | Explicit selection and confirmation; sequential batches stop on uncertainty; no scheduled or background syncing         |
| Result verification | FIT-session parsing, duplicate matching, before/after Garmin candidates and read-only checking of uncertain outcomes    |
| Web sessions        | Separate encrypted HttpOnly provider cookies, transient MFA state and browser-local transfer history                    |
| Local API           | Loopback Python HTTP boundary, input validation, request-origin checks, rate limiting and restricted FIT downloads      |
| Diagnostics         | Redacted local traces and separate terminal diagnostic flows                                                            |
| PWA                 | Install metadata and icons, standalone display and a public offline notice; uploads are never queued offline            |
| Cloudflare          | Static/interface preview and security headers; live provider operations remain disabled                                 |
| Validation          | Backend tests, mocked browser journeys and built Worker/PWA checks                                                      |

These application layers live outside `upstream-trial/`. Their responsibilities and transfer state are detailed in [Architecture](ARCHITECTURE.md). Provider behavior is unofficial and based on observed responses; see [API notes](API-NOTES.md) and [test evidence](TEST-JOURNEY.md).

## License and attribution status

No license file is present in the pinned upstream tree. The existing project record has no confirmed reuse permission. Attribution records the source; it does not resolve the project's outstanding permission question. Before distributing the upstream implementation with Hub, resolve permission or replace that dependency, as already required by the [security release gates](SECURITY.md).

The installed `garminconnect` dependency is recorded as MIT-licensed in the integration notes. Its license is separate from the iGPSPORT source and does not determine the license of that source or the whole application. This document is a provenance record, not a complete third-party license inventory or a new license grant.

Provider names and favicons identify the connected services. The iGPSPORT Hub name does not establish vendor ownership or endorsement. Provider artwork and the project's IH install icon are documented in [Assets](ASSETS.md).

## Reproducing and updating the dependency

For an existing checkout, inspect it without running any sync operation:

```sh
git -C upstream-trial remote -v
git -C upstream-trial rev-parse HEAD
git -C upstream-trial status --short
git -C upstream-trial diff HEAD -- sync_igpsport_to_garmin.py
```

For a fresh local evaluation, when `upstream-trial/` does not already exist:

```sh
git clone https://github.com/hmqgg/iGPSport2Garmin.git upstream-trial
git -C upstream-trial checkout --detach 5a5f635491468cc63943a44db52d2d62a53b2054
```

Continue with [Development setup](DEVELOPMENT.md). Do not run the upstream script or enable its scheduled workflow as part of Hub setup. Its automatic-transfer behavior is outside Hub's explicit-confirmation flow.

Keep `upstream-trial/` ignored and isolated. Do not silently follow the upstream default branch. For an intentional update, review the source and license changes, record the new commit here and in the setup/API notes, and run the relevant backend and browser checks. Mocked tests cannot establish live provider compatibility; any live upload must remain an explicitly selected and confirmed action.
