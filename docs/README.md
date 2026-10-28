# Documentation index

Start with [Project origin and upstream dependencies](PROVENANCE.md) for source attribution, the pinned revision, what is reused, and how Hub differs.

Read in this order when taking over the project:

1. [AI/developer handover](AI-HANDOVER.md): current scope, invariants, verification and next work.
2. [Architecture](ARCHITECTURE.md): components, trust boundaries and data flow.
3. [Development](DEVELOPMENT.md): setup, conventions, tests, migration and dependency policy.
4. [Security](SECURITY.md): OWASP-oriented controls, evidence, limits and deployment gates.
5. [PWA](PWA.md): install, cache policy, update behavior and offline testing.
6. [Operations](OPERATIONS.md): start/stop, recovery, logs, failures and release process.
7. [Frontend contract](FRONTEND.md): API routes and user journey.
8. [Provider API notes](API-NOTES.md): observed fields, units and response semantics.
9. [Sessions](LOCAL-SESSIONS.md): local token experiments and refresh observations.
10. [UI review](UI-REVIEW.md), [revamp review](UI-REVIEW-2026-10-27-REVAMP.md), [test journey](TEST-JOURNEY.md), [asset provenance](ASSETS.md).

`response-examples/` contains sanitized observed provider schemas and examples. It must never contain credentials, signed URLs, raw headers or account profile data. `archive/` is historical context; current documents take precedence for paths and operation. Historical provider observations are evidence, not a promise that undocumented endpoints will remain unchanged.
