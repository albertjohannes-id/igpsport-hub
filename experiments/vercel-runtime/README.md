# Vercel runtime compatibility probe

This isolated project tests the exact Python dependency lock used by iGPSPORT Hub. It contains no provider credentials, saved sessions, upstream checkout, frontend or upload handler. Deploy this directory, not the repository root.

## Verified 2026-10-19

Deployment: https://igpsport-hub-runtime-test.vercel.app/api/probe

Vercel project: `allbadzs-projects/igpsport-hub-runtime-test`. Vercel authentication protection remains enabled. Its initial deployment uses the test project's production alias; this is not the app's production deployment and no custom domain is connected.

The deployed endpoint returned HTTP 200 on Linux / Python 3.12.14:

- Imports: garminconnect 0.3.19, garth 0.8.0, curl_cffi 0.16.3, requests 2.34.2, cryptography 50.0.2 and fitdecode 0.11.0.
- AES-GCM encryption/decryption round trip: passed.
- Native curl_cffi HTTPS request to example.com: passed.
- Temporary-file write/read: passed.

This establishes runtime compatibility for these operations, not provider authentication compatibility. Garmin/iGPSPORT login, MFA, refresh, activity listing and real transfers have not been tested on Vercel. No existing provider credentials were sent to the deployment.

## Reproduce

```sh
cd experiments/vercel-runtime
npx vercel@64.5.0 deploy --yes --scope allbadzs-projects --project igpsport-hub-runtime-test
npx vercel@64.5.0 curl https://igpsport-hub-runtime-test.vercel.app/api/probe --scope allbadzs-projects
```

Later deploys default to preview URLs; use the URL returned by the deployment command to test the new version. The stable alias above identifies the first tested deployment.

`requirements.txt` is an exact copy of the root `requirements-trial.lock.txt`. Keep them aligned when repeating the experiment. The endpoint returns only library versions, boolean checks and exception class names. It does not accept login data. Use a separate protected authentication harness for the next stage; do not expose the loopback API unchanged.
