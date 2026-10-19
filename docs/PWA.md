# PWA behavior

## What is provided

Native web manifest, 192/512px PNG icons, 180px Apple touch icon, standalone display and theme colors, and a small hand-written service worker. No Workbox, PWA plugin, push SDK or runtime dependency. Registration happens only in compiled production builds.

Run `npm start` or **Start Web.command**. In supporting browsers, use the browser's Install/Add to Home Screen action. Safari on iOS uses Share → Add to Home Screen. Install UI and criteria vary by browser; the app does not force an install prompt or claim installation has occurred. Localhost is a development secure-context exception. Public hosting requires HTTPS. An installed local app still needs the local server running for real activity access.

## Offline policy

The service worker caches exactly `/offline.html` and `/offline.css`. It does not cache the application shell, API responses, credentials, signed FIT URLs or files. Same-origin GET navigations use the network first and show a generic offline notice on network failure. `/api/*`, cross-origin requests, and non-GET requests are left untouched. No background sync, upload retry queue or push notification subscription exists.

This is intentional: activities require a live provider/session check. The app does not present cached health data as current. Existing in-memory content may remain visible when connectivity drops until the next request; it is not persisted by the service worker. Trying an operation offline cannot queue it for later. If connection drops after the server accepted an upload, check status on recovery instead of uploading again.

Cloudflare canonicalizes `.html` routes; the worker's offline response reconstructs a Response to remove redirect metadata. Production tests cover this behavior, rather than assuming a development server's behavior matches hosting.

## Updates and cache lifecycle

- `sw.js` and the manifest use no-cache headers; registration uses updateViaCache none.
- No skipWaiting or forced reload. A new worker waits for old app windows to close, so it cannot replace the app during an active transfer.
- Close all iGPSPORT Hub windows after completing/checking transfers, then reopen to activate an available update.
- When offline-page content changes, bump `apex-offline-v2` in `public/sw.js`. Activation deletes only older app offline caches, never unrelated origin caches.
- For developer recovery, unregister the worker and clear only `apex-offline-` cache entries using browser developer tools. Do not clear the local token directory to fix an asset cache problem.

## Files and verification

Manifest: `public/manifest.webmanifest`. Registration: `src/pwa.ts`. Worker: `public/sw.js`. Offline view: `public/offline.html` and CSS. Icon source/generator: `public/icons/icon.svg`, `scripts/generate-icons.mjs`.

`npm run test:production` checks actual built Cloudflare responses, strict CSP, valid manifest/icon responses, worker control, exactly two cached public resources, offline navigation and online recovery. It also asserts cloud mutations are disabled and API responses are no-store. Manual browser installation and physical iOS/Android testing are still device checks; automated readiness is not a claim of testing every browser.

References: [MDN installability](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable), [MDN service workers](https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API/Using_Service_Workers).
