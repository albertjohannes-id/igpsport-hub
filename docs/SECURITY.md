# Security model and OWASP-oriented baseline

Reviewed 2026-10-18. This is a scoped engineering baseline, **not an OWASP certification, penetration test, or claim of ASVS compliance**. Production cloud account functionality remains disabled.

## Threat model

Protected assets: provider passwords/tokens, private activity metadata and signed download URLs, transfer history, and the integrity of Garmin uploads. Main risks: malicious web origins reaching localhost, injected provider content, malformed requests, repeated login attempts, duplicate transfers, arbitrary outbound FIT URLs, leaking secrets through static serving/logs/caches, and deploying a single-user backend as a shared service.

Trust assumptions: the user's OS account, browser profile, Python/npm dependencies and provider TLS endpoints are trusted. This app does not defend against malware, a malicious local process running as the same user, browser extensions with broad permissions, stolen unlocked devices, or a compromised provider/storage host. The local API has no independent human authentication; its boundary is loopback plus browser request restrictions. It is not a multi-user server.

## Implemented controls

| Risk area                           | Implementation                                                                                                                                                                                                                | Evidence                                                                       |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Access control / browser CSRF       | Bind 127.0.0.1 only; exact Host/Origin validation, required non-simple custom header, reject cross-site Fetch Metadata; no CORS allow-origin; preflight/mutation methods outside GET/POST rejected                            | `tests/python/test_security.py` real HTTP tests                                |
| Injection / input validation        | Exact POST keys, string types/lengths, ASCII numeric activity IDs, JSON content type and bounded body, strict route segment count; no shell/SQL built from user input                                                         | Malformed JSON, unexpected fields, wrong types and ID tests                    |
| Script/content injection            | React escapes provider text; strict production CSP self-only scripts/styles/connect/images, no eval/inline script; no external runtime assets                                                                                 | Production response tests; source review                                       |
| Clickjacking / browser capabilities | CSP frame-ancestors none, X-Frame-Options DENY, nosniff, no-referrer, restrictive Permissions-Policy, same-origin resource/opener policies                                                                                    | Production and API header assertions                                           |
| Transport                           | Provider HTTPS with normal certificate verification, HSTS on Cloudflare HTTPS; localhost HTTP only for local operation                                                                                                        | Explicit URL validation and deployment policies                                |
| SSRF / unsafe provider URLs         | Exact observed FIT bucket hostname, HTTPS/443, no userinfo, no fragments, reject non-public DNS answers, no redirects, bounded download size/time                                                                             | Localhost, metadata IP, deceptive domain, other bucket and DNS rejection tests |
| Abuse / exhaustion                  | 120 API requests/minute per local process; 5 login attempts/provider/5 minutes; 8192-byte POST body; 16 active request threads; 10-second socket read timeout; 50 MiB FIT bound, per-read timeouts and overall download guard | Limiter-window and HTTP login throttle tests; constants in source              |
| Session persistence                 | Web: AES-GCM HttpOnly cookies, size/expiry checks, request isolation, browser-local history; CLI: owner-only files                                                                                                            | File permission/session/history tests                                          |
| Credential/log disclosure           | No password persistence; no raw credential-bearing headers/URLs in frontend response; redacted diagnostics; source/session/log folders excluded from static serving/build                                                     | Diagnostics redaction tests, Vite deny rules, build inspection                 |
| Cache disclosure                    | API Cache-Control no-store; service worker caches only generic offline HTML/CSS; no background sync or POST replay; browser memory holds activity responses                                                                   | Production cache enumeration and offline tests                                 |
| Integrity / repeat uploads          | Explicit confirmation, browser-local pending history before requests, candidate matching, uncertain states block resubmission; frontend disables pending actions                                                              | Upload, uncertainty, Enter duplicate-submission tests                          |
| Supply chain                        | Exact npm declarations and lockfile, Python lock, npm/OSV advisory review; no additional web runtime security/PWA dependencies                                                                                                | Audit results below                                                            |

The required custom header is a browser CSRF barrier, **not an API secret**. CLI clients can spoof it and the Origin header; same-user local processes are outside this boundary. Rate limits are process-local and reset on restart. They are inappropriate as distributed cloud protection.

## Important limits and remaining work

- Web provider tokens now use authenticated encrypted cookies; the local key is an owner-only file. Legacy CLI tokens remain unencrypted files and are not imported into web sessions. See BROWSER-STORAGE.md for cookie expiry, limits, and the lack of server-side revocation for copied cookies.
- The exact FIT bucket allowlist is intentionally narrow. A new legitimate region/host will fail closed until its ownership and API provenance are checked and the allowlist/tests updated. DNS is checked before requests resolves again; this is not IP-pinned transport. Exact trusted hostname plus TLS reduces the DNS-rebinding surface, but does not protect against takeover of that trusted provider infrastructure.
- Authentication/ownership is delegated to providers locally. Public cloud sessions need real per-user authorization on every read/mutation; the current Worker cannot serve account data.
- Python's HTTP server and in-memory limiter are for local use. Do not bind to 0.0.0.0, add wildcard CORS, expose it through a tunnel, or serve it publicly.
- Vite development CSP deliberately permits its inline development runtime/styles and local HMR WebSocket. **Only production builds use the strict policy.** Never publish a dev server.
- Login/MFA attempts are not an official provider integration contract. Provider changes, CAPTCHA, rate limits or unsupported MFA can still require manual recovery. Never bypass provider access controls.
- Legacy terminal trials are diagnostic tools. They do not have the web HTTP boundary or login limiter. The documented web baseline is not a blanket claim about every upstream helper.
- Logs and legacy CLI history can grow on disk. Web history is browser-local and bounded to 200 records/1 MB. Clearing or evicting it loses recovery records; provider duplicate matching remains necessary.
- The upstream iGPSPORT repository has no confirmed reusable license; resolve this before redistribution.

## Cloud release gates

Before enabling a cloud login or transfer endpoint:

1. Port and validate login, MFA, refresh, FIT download/upload and uncertain verification in Workers; resolve upstream licensing.
2. Port the client-held encrypted provider cookies to HTTPS/Secure/HttpOnly/SameSite deployment, with expiry, size/round-trip checks and CSRF protection. No plaintext provider token in JavaScript-accessible storage.
3. No D1 for v1. Retain bounded browser-local history and account-bound receipts. Verify duplicate matching and concurrent-transfer limitations across tabs/devices; do not claim exactly-once delivery.
4. Use managed Worker secrets for cookie encryption and define key rotation, expiry, logout and incident recovery. Do not log passwords, tokens, signed URLs or health payloads.
5. Add shared rate limiting, body/file limits, outbound-host policy and resource-budget behavior tested on the chosen free plan.
6. Test account isolation, expired sessions, concurrent tabs/users, ambiguous uploads, offline/reload/update behavior, security headers and operational recovery.
7. Perform a scoped independent security review. Publish clear unofficial-integration/privacy information and verify real device installation/accessibility.

## Verification record

- npm dependency audit (production and development): zero reported advisories on 2026-10-18. This is a point-in-time advisory result, not proof of safety.
- OSV batch query of 40 pinned Python requirements: zero reported advisories on 2026-10-18. Unlicensed upstream source is not covered by this advisory scan.
- Automated security cases are in `tests/python/test_security.py`; deployment/PWA boundaries in `tests/production/pwa.spec.ts`. Run the commands in DEVELOPMENT.md for current results.
- No real uploads, token revocations, password changes or account deletion are part of automated verification.

### Local release check — 2026-10-18

- Passed 40 Python tests, 11 frontend tests and 2 production Worker/PWA tests.
- Production build, formatting check and Cloudflare deployment dry run passed. No deployment was performed.
- Both existing provider sessions remained connected after moving Python code into `backend/`.
- Live local responses confirmed strict CSP without inline scripts and API `Cache-Control: no-store`.
- Requests for private session, backend source and log paths returned the SPA HTML fallback, not private file contents. A 200 fallback is not evidence that those files are served.
- Production browser tests verified the offline fallback and a cache containing only its generic HTML/CSS; provider API data is not cached.
- Physical-device installation, public cloud account isolation, an independent penetration test remain unverified/unimplemented as described above.

## Browser persistence update — 2026-10-18

The web storage model has changed since the local release check above. See [BROWSER-STORAGE.md](BROWSER-STORAGE.md) for the implemented cookie/localStorage design, migration/test steps, measured payload sizes and remaining cloud work. No D1 database was added.

## Reporting and incident response

Do not paste credentials or full provider responses into an issue/chat. Provide the affected version, sanitized operation/error code, reproduction steps and expected behavior. If a token is exposed, revoke it through the provider and disconnect locally; deleting a file alone does not revoke it. Stop the local server during investigation. Preserve only sanitized diagnostics, then follow the provider's recovery process. There is no dedicated public security contact because the app has not been released publicly.

## References

- [OWASP REST Security](https://cheatsheetseries.owasp.org/cheatsheets/REST_Security_Cheat_Sheet.html)
- [OWASP Input Validation](https://cheatsheetseries.owasp.org/cheatsheets/Input_Validation_Cheat_Sheet.html)
- [OWASP HTTP Headers](https://cheatsheetseries.owasp.org/cheatsheets/HTTP_Headers_Cheat_Sheet.html)
- [Cloudflare Workers best practices](https://developers.cloudflare.com/workers/best-practices/workers-best-practices/)
