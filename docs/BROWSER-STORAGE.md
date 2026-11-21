# Browser storage trial (v1)

The web app has no iGPSPORT Hub account and no D1 dependency. This implementation runs through the local Python adapter; the Cloudflare Worker is still an interface preview with provider operations disabled.

| Data                   | Location                                                            | Retention                                                                      |
| ---------------------- | ------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Provider sessions      | Separate `apex-garmin` / `apex-igpsport` encrypted HttpOnly cookies | 30 days from issuance/refresh, or earlier provider expiry/revocation           |
| Recent transfers       | `localStorage`, key `apex-transfer-history-v1`                      | Up to 200 records across account pairs, at most 1 MB of serialized text        |
| Matching evidence      | Encrypted receipt inside each local history record                  | Receipt valid for 30 days; visible history remains until removed/evicted       |
| In-progress Garmin MFA | Process memory, addressed by an unguessable HttpOnly cookie         | 5 minutes; lost on API restart                                                 |
| Encryption key         | `.local-auth/browser-cookie.key`, owner-only                        | Until deliberately replaced; replacement invalidates existing cookies/receipts |
| Theme                  | `localStorage`, key `apex-theme`                                    | Until browser data is cleared                                                  |

Passwords are transient login inputs. Provider tokens are decrypted only while processing requests and are never returned in JSON or placed in JavaScript storage. The server necessarily sees tokens to call providers; client persistence does not mean direct browser-to-provider API calls. AES-256-GCM encrypts and authenticates each cookie, with independent random nonces and provider-specific associated data. History receipts bind to the connected account pair and cannot authorize another pair's requests.

Cookies use HttpOnly, SameSite=Strict, Path=/api and no Domain attribute. Secure is deliberately off only for the loopback HTTP trial. Public deployment must use HTTPS, Secure cookies, the appropriate host cookie prefix/path policy and a managed server encryption secret; never expose this Python server. Existing custom-header/Origin/Fetch-Metadata checks remain in force. No D1 or central provider-token database is added.

Measured on the existing local sessions without printing tokens: full Set-Cookie strings including the Secure attribute were **3,177 bytes for Garmin and 2,096 bytes for iGPSPORT**. Each write is rejected above 3,800 bytes, leaving room under common 4 KB cookie limits. These are sample sizes, not a guarantee about future provider payloads. Successful login is followed by a cookie round-trip check so blocked cookies do not silently appear saved. Refresh also goes through the size guard.

History is filtered by a server-derived account-pair identifier, stable across token refresh and reconnecting the same login. It is display/recovery data, not an authorization database. Different browser profiles have separate cookies and history. Different accounts in the same profile have separate visible histories, but anyone with access to the profile can inspect localStorage. Clearing cookies requires reconnecting; clearing all site data also deletes history. Browser eviction/private browsing may remove data. History does not sync between phones or browsers.

Before transfer, the frontend persists a pending record and verifies storage works. If the response is lost, that record offers Check status after reload. Checks never upload; without a receipt they fetch source FIT metadata and match Garmin candidates. Multiple matches stay unconfirmed. Normal transfers also match existing Garmin rides before uploading. Web Locks serialize API operations across tabs where supported; older browsers serialize only within each tab. This is not a distributed exactly-once guarantee across separate browsers/devices.

Disconnect deletes that browser's provider cookie and any pending MFA. It does not revoke the provider token or erase historical records. Stateless cookies have no immediate server revocation list: a previously copied cookie remains usable until expiry/provider revocation/key rotation. Do not treat a stolen cookie as harmless merely because its contents are encrypted.

## Try it locally

1. Restart **Start Web.command** (or `npm start`) and consistently use `http://127.0.0.1:5173`; `localhost` is a different browser storage origin.
2. Connect both providers once. The web app intentionally does not import shared `.local-auth/garmin.json`, `igpsport.json` or `web-history.json` files. Legacy CLI tools still use those untouched files.
3. Reload or close/reopen the browser. Connections should remain. Make a user-selected test transfer; reload to check Recent transfers.
4. Open a different browser/profile: connections and history must be empty. Reconnecting the same accounts in that second profile does not copy the first profile's history.
5. Disconnect a provider in the first browser and reload: that connection should be removed there. Clearing all site data removes both connections and local history.

Tests use synthetic tokens and mocked providers, never real uploads. Install the UI test browsers with `npx playwright install chromium webkit`. Run `npm run test:python`, `npm run test:ui`, and `npm run build`. Physical iPhone/Android testing and a Workers-compatible provider implementation remain follow-up work; localhost on a phone refers to the phone, not this Mac.

References: [authenticated encryption API](https://cryptography.io/en/latest/hazmat/primitives/aead/), [cookie attributes](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Set-Cookie).

## Recent login accounts

The email/username field offers separate recent-account lists for iGPSPORT and Garmin. Clicking or focusing the field opens suggestions, typing filters them, and a new account can always be entered. Selecting a suggestion fills the email/username field on mouse, touch and keyboard input. The remember-account checkbox sits beside its label; retention details remain in this documentation. Use Tab to reach suggestion and removal buttons; Escape closes the suggestions before closing the dialog.

With **Remember account on this device** checked (the default), a successful login saves the identifier and last-successful-login timestamp in `localStorage` under `apex-recent-accounts`. Garmin is saved only after MFA succeeds. Each provider keeps at most five accounts, newest first. Passwords, MFA codes and session tokens are never included. Failed attempts do not save or refresh an entry. Unchecking the option removes that identifier after a successful connection.

Entries expire 90 days after their last successful login. Expired entries are filtered and removed when the app starts or accesses the list; a closed app cannot run a timed deletion. Disconnecting or session expiry leaves these suggestions intact and does not extend their retention. Removing a suggestion or choosing **Clear recent accounts** affects only that provider's suggestions, not its connection or transfer history.

This list is local to the site origin and browser profile; it does not sync. Clearing site data, browser eviction or closing private browsing can remove it sooner. Anyone using that browser profile can see the saved identifiers. Browser/password-manager autofill is independent and may still suggest a removed account. If browser storage is unavailable, login still works but remembering accounts may not.
