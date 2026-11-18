# Changelog

Dates are UTC. Each entry matches a git tag (`v0.4.3` etc.) and a GitHub release.

## 0.4.4 — 2026-11-18

- New "What's new" menu: the version line in the Home footer and a link inside the how-to guide open a dialog listing every version's changes, read directly from `CHANGELOG.md` at build time.
- Versioning is now consistent with GitHub: every version has a git tag and a GitHub release, backfilled through 0.1.0.

## 0.4.3 — 2026-11-13

- Removed the temporary HR-zone debug scaffolding: the FIT download button in the detail dialog, the `/api/igpsport/fit` and `/detaildebug` routes, and the extra development origin.
- The Host/Origin check is back to the standard development port only.

## 0.4.2 — 2026-11-13

- Already synced rides can be selected and sent again. The confirm dialog warns in place that re-sending creates a second copy in Garmin, and the upload only proceeds after confirmation.
- Rides with an uncertain previous transfer still require a status check first; the warning cannot override that.

## 0.4.1 — 2026-11-12

- New opt-in "Shift HR-zone times for Garmin" checkbox in the transfer confirmation. It restores the missing Zone 1 in Garmin's Time in Zones chart by moving the FIT file's embedded zone times up one slot before upload.
- Verified against a real transfer: Garmin now shows Zone 1 = 30:28 (73%) and Zone 2 = 7:39 (18%) for the test ride that previously showed Zone 1 = 7:39 only.
- The shift never modifies the original file and bails out unchanged on any unexpected FIT layout.

## 0.4.0 — 2026-11-11

- Compare pairs can be tagged as already synced after the metrics are verified against the Garmin activity — no upload, no duplicate.
- Compare reads up to 10 pages per side.
- The Home check button is now the shorter "↻ Connections".

## 0.3.3 — 2026-11-11

- The dark background now covers short pages, and the connection status pill sits inline with the provider name.

## 0.3.2 — 2026-11-11

- Simpler Home heading and toolbar copy; the unsynced-only filter and bulk-select action were removed in favor of manual selection.

## 0.3.1 — 2026-10-29

- GitHub link with an icon in the header.

## 0.3.0 — 2026-10-22

- New Compare tab: two-sided suggestions for iGPSPORT rides that never went through the Hub.

## 0.2.0 — 2026-10-22

- Unsynced filter and bulk selection, inline status check, mobile version, toolbar wrap fix.

## 0.1.0 — 2026-10-22

- Initial release: selected rides transfer from iGPSPORT to Garmin as original FIT files, with saved sessions, result verification and local-only storage.
