# Operations and recovery

## Start and stop

- Daily/local PWA use: `npm start` or Start Web.command; open http://127.0.0.1:5173.
- Developer hot reload: `npm run dev:all`; same origin, no new service-worker registration.
- Combined terminal flow: Start Trial.command or Session Test.command. Both run `backend/apex_local.py`.
- Stop with Ctrl+C in the launcher terminal. The launcher terminates only its own API/frontend children. If a child fails, it stops its sibling. Do not kill unrelated processes to reclaim ports.
- Port 5173 is the frontend; 8788 is the API. If occupied, close the prior iGPSPORT Hub launcher first. Production Worker tests reserve 4173.

## Normal user flow

Home validates saved sessions through activity reads. Open a provider, refresh/search/page activities, open details. Select iGPSPORT activities, connect Garmin when needed, then confirm. Transfer success requires a real activity ID or unique matching verification. An unchanged list does not mean expiry: inspect the updated timestamp and session state.

## Troubleshooting

| Symptom                              | Action                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------- |
| Session rejected / reconnect         | Sign in to that provider; don't infer expiry from elapsed minutes alone                                          |
| Unable to check / timeout            | Retry after connectivity recovers; the session file is preserved                                                 |
| Too many attempts                    | Wait five minutes; do not bypass provider limits by repeated restarts                                            |
| Unconfirmed upload / tab interrupted | Check Garmin/status before another upload; history blocks automatic repeats                                      |
| FIT host not approved                | Record only the hostname; verify provider ownership before updating security policy, never allow arbitrary HTTPS |
| MFA expired                          | Restart login; pending codes expire after five minutes                                                           |
| Local activity service unavailable   | Confirm the launcher is running and both ports are available                                                     |
| PWA offline screen                   | Restore connectivity/server, then Try again                                                                      |
| Old installed interface after update | Finish transfers, close all app windows, reopen; avoid forced worker activation mid-transfer                     |
| Corrupt history file                 | Stop the server, preserve a private backup and investigate; do not silently erase duplicate-protection history   |

## Data and logs

`.local-auth/` contains provider sessions, identity markers and web-history.json. Tokens are not encrypted by iGPSPORT Hub; do not share or commit this directory. Disconnect removes the local provider file but does not revoke a token at the provider. Do not move the directory while the server is running.

`logs/` contains sanitized JSONL operations and historical diagnostic reports. It is excluded from builds and Git. Do not add raw HTTP headers/bodies, passwords, cookies, auth codes, signed file URLs or FIT contents to logs. See API-NOTES.md and diagnostics tests before changing the redaction policy. Historical logs are not a universal API capture.

Back up local private files only to a trusted protected destination. Restoring old history can hide newer transfers; confirm destination activities before retrying. There is no automatic retention/deletion job.

## Release and rollback

1. Run Python, UI, production/PWA, build/dry-run and formatting checks.
2. Review dependency advisories, static output and the security/PWA policies. Confirm no private directories or source maps are shipped.
3. Do not deploy active provider endpoints until SECURITY.md cloud gates are satisfied. The existing Worker is interface-only.
4. For an approved interface deployment, use `npm run deploy` with separately configured Cloudflare account authorization. Never put credentials in wrangler.jsonc or docs.
5. Keep the previous build/source/lockfiles for rollback. Roll back all matching assets and worker code together. Close installed PWA windows to let its lifecycle settle. Do not restore old provider tokens as an asset rollback strategy.

No actual Cloudflare deployment or D1 creation has been performed by this security/PWA update.
