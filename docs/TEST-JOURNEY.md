# Observed negative-login and delayed-upload journey

Tested locally on 2026-10-17. Original diagnostic logs remain private. The public
fixture `response-examples/negative-login-and-delayed-import.json` preserves the
event sequence with synthetic IDs and omits timestamps and personal ride measurements.

| Step                    | Observation                                                | Journey behavior                                   |
| ----------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| Wrong iGPSPORT password | HTTP 403, application code 1002; login false; ~0.8 seconds | Show credential rejection and allow re-entry       |
| Correct iGPSPORT login  | HTTP 200, code 0; login true; ~0.7 seconds                 | Continue without restarting                        |
| Activity list           | Two rides, title and metrics returned                      | Show name, distance, moving time, speed and device |
| Select ride             | Details fetched, FIT download HTTP 200, 6,819 bytes        | Preserve selected ride during Garmin retries       |
| Wrong Garmin password   | `GarminConnectAuthenticationError`; ~23 seconds            | Show waiting message, then retry prompt            |
| Correct Garmin login    | Login returns without exception; ~11 seconds               | Continue to recent activities                      |
| Recent activities       | Five activities returned                                   | Show newest five with names, distance and duration |
| Before upload           | Four candidates in the date window                         | Retain their IDs to distinguish new imports        |
| Upload                  | HTTP 202, an upload receipt; empty success/failure arrays  | Upload accepted; checking Garmin                   |
| First follow-up         | Four candidates, no new matching ride                      | Continue checking; do not upload again             |
| Second follow-up        | Five candidates; a new matching activity                   | Confirm and show activity link                     |

This run supplies direct evidence of delayed availability after HTTP 202. It does
not prove that every Garmin upload follows the same timing or response contract.
The newly created activity was confirmed through start time, duration and distance.

## Login interpretation

HTTP 403 alone is not a wrong-password signal. The combination of 403 + code 1002
was observed during a deliberate wrong-password attempt and is now mapped to
credential rejection. We do not distinguish unknown username from wrong password.
Other 403 responses remain access-denied/verification/connection-block possibilities.
Garmin exposes only an authentication exception for the failed login here; the raw
SSO response/status was not captured, so do not invent a Garmin error payload.
Neither provider's human-readable error text was retained.

## Metric units supported by this run

Comparing iGPSPORT list values with the downloaded FIT session and Garmin's
imported activity supported metres for distance, seconds for moving time and
metres/second for speed. Personal measurements are omitted from this public record.
The display converts these values to kilometres, minutes and km/h. This is empirical
evidence for the international API, not an official unit specification.
Detail distance can lose precision relative to list distance; use original FIT
metrics for matching. Ascent was unverified during this run and validated in the
later comparison documented in [API notes](API-NOTES.md).

## Still untested live

- Wrong MFA code, expired/revoked sessions and rate limiting.
- Network failure, unavailable FIT file, empty account and malformed responses.
- Existing-ride prevention, ambiguous matches and long processing delays.
- Cloudflare runtime and network compatibility.

Do not intentionally trigger rate limiting or repeated account failures just for
coverage. Simulated tests cover retry boundaries; live tests should be purposeful.
