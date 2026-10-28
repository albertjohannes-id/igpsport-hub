# UI delivery review, 27 October 2026 — app-shell revamp

Complements `UI-REVIEW.md` (18 October 2026). Scope unchanged: local working frontend;
production cloud auth, D1 and real Garmin login/upload remain outside this validation.
Fixtures never contact providers.

Direction: Albert requested a first-user-friendly, app-like UI with "true mobile taste
everywhere", a refined teal, a full component restructure, and hash routing.
Dials: ENERGY 2 / RHYTHM 2 / MOTION 2 (raised from 1/2/1 only where evidence supports it:
larger type rhythm, softer color surface steps, one page-rise transition).

## Structure delivered

- 520px single-task app column on every viewport; desktop intentionally keeps the phone
  column (true mobile taste, per user's explicit choice).
- Floating rounded bottom navigation (Home, both provider tabs with real provider logos,
  Compare) reachable by thumb at all widths; replaces the old pill tab bar.
- Hash routing `#/home|#igpsport|#garmin|#compare`: reload, back and deep links restore
  the tab; deep-linking `#/compare` auto-runs the comparison once connected.
- All five dialogs render as phone bottom-sheets 640px and below, centered cards above.
- Activity rows are the same card-list on all widths; the desktop table was removed.
- Multi-select uses a fixed floating selection bar above the bottom nav.
- State ownership moved to `App.tsx`; pages are presentational via `AppContext`/`useApp`
  (`src/app-context.ts`). Shared pieces: `src/icons.tsx` (custom inline SVG glyphs),
  `src/format.ts`, `src/compare.ts`, `src/pages/*`, `src/Modals.tsx`.

## Gate evidence (delta from 18 October record)

- R-01/R-07/R-13 PASS: no gradients, glow, grids or patterns; revamp kept the flat
  surface system with refined teal only.
- R-03 PASS: automated overflow checks at 320/390/768/1280px in both themes; 320px
  `.page-head` wrap fix verified in `responsive-states.spec.ts`.
- R-04 PASS: all glyphs are hand-authored inline SVG in `src/icons.tsx` (home, swap,
  moon, sun, search, chevron, external); provider tabs use real iGPSPORT/Garmin logo
  images, not fabricated marks (consistent with R-23).
- R-08 PASS: chevrons mark detail navigation; external arrows mark Garmin links.
- R-11 PASS: corner sizes distinct; the floating nav and selection bar are rounded
  containers, not pills (comparable to the previous "not pill-shaped" ruling: the nav is
  a navigation surface, not a button; its active segment is a tinted rounded state).
- R-12 PASS: elevation confined to the bottom nav, the selection bar and dialogs.
- R-19 PASS: motion = page-rise on tab change (MOTION 2), loading spinner, control
  feedback. No entrance animation on load, no loops beyond the spinner; reduced-motion
  support retained.
- R-25 PASS: contrast re-checked on the new tokens — muted text on canvas, accent on
  canvas and on its tint; nav labels use muted text (not light-on-dark) at rest and
  accent when active. Boundary 3:1 maintained on nav outline and dialogs.
- R-26 PASS: nav tabs, both theme paths, refresh, search, select/clear, send/confirm,
  check, disconnect, compare toggle and deep-link compare all wired to handlers in
  `App.tsx`; verified by the journey suite.
- R-31 PASS: purposes — the 520px column frames one task; the bottom nav serves one-hand
  reach; provider logos make tabs concrete; page-rise signals a location change; ride
  metrics stay plain text with the honest dash for missing measurements.
- R-32 PASS: native buttons/forms/dialogs kept; bottom-sheet dialogs move `role="dialog"`
  to the sheet container and keep Escape/focus flows; nav buttons are real buttons with
  `aria-current`; skip link retained.
- R-34 PASS: both themes verified in screenshots at phone and desktop widths
  (`/tmp/igps-ui/01…09`), and by `responsive-states.spec.ts` assertions.
- R-35 PASS: `tsc --noEmit` clean; 25/25 Playwright tests pass after a fresh dev-server
  restart (two earlier single-run failures were `page.goto` timeouts on a stale dev
  server — server stalls, not app code; each test passes standalone and both runs pass
  after restart). Browser console sweep across `#/`, `#/igpsport`, `#/garmin`,
  `#/compare`: only one expected network log — `GET /api/status` → 502 because the dev
  environment does not proxy the mock backend; the app handles it and renders the
  disconnected state (no uncaught errors or warnings from app code).
- R-37 PASS: user decisions recorded before work — structure, routing, dial values.
- R-38 PASS: screenshots captured from the live dev app showing real fixture flows
  (disconnected, list, selection bar, detail sheet, dark list, compare results, desktop).

## Recorded interaction results (test contract, unchanged names)

`iGPSPORT connected`, `↻ Refresh`, `View details`, `.compare-pair`, `.history-list`,
`.result`, `.row-action` preserved in markup so `journey.spec.ts` stays behavioral.

- Transfer journey: list → select → Confirm transfer → banner → history after reload
  (hash restores provider tab without resetting the view).
- History isolation: `account-pair-one/two` localStorage scopes still separate.
- Lost-response → pending record → Check status after reload.
- Login failure/retry/Enter-submits-once with pending spinner, unchanged.
- Responsive states at 320/390px including overflow and both themes — 25/25 pass.

## Known honest markings

- Row "Ascent — m" dash remains the intentional missing-measurement marker.
- Deep-link `#/compare` auto-run is gated on both accounts being connected; otherwise it
  shows the connected-steps prompt.

## Follow-up validation (not claimed)

Real-device thumb reach/keyboard tests, live Garmin MFA flows, and iOS safe-area review
of the floating nav remain device/integration work.
