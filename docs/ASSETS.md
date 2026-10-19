# Provider favicons

Retrieved 2026-10-18 from icon links in the user-specified provider pages.

- iGPSPORT https://app.igpsport.com/user/home → https://app.igpsport.com/favicon.ico
- Garmin SSO https://sso.garmin.com/portal/sso/en-US/sign-in → https://static.garmin.com/favicons/favicon-32x32.png

Original provider artwork used for provider identification at the user’s request. Ownership remains with each provider. Served locally to avoid third-party image requests during app use.

## Install icon

The iGPSPORT Hub PWA uses an IH monogram, authored as SVG for this project. Source: `public/icons/icon.svg`. PNG exports: `node scripts/generate-icons.mjs`. No external image library or runtime image request.
