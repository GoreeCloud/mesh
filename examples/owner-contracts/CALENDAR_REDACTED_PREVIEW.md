# Calendar title-redacted import preview — synthetic Mesh source contract

**Status:** Nonproduction, transport-injected integration fixture only, November 11, 2026. No production connection, credentials, user-data access, ICS transfer, synchronization, consent grant, or deployment.

## Verified source ownership

The owner is GoreeCloud/calendar [draft PR #5](https://github.com/GoreeCloud/calendar/pull/5), stacked on the separately unmerged Calendar foundation PR #1.

- Reviewed source commit: cae388d173853d7aefaba41b4460564a28673662
- Source handler: calendar_app/core.py; Git blob 9fc93fd255c7c45bf11d82a86480523509a846fb
- Authorized event preview: POST /api/v1/import.ics?dry_run=1&redact_titles=1
- Authorized task preview: POST /api/v1/import-tasks.ics?dry_run=1&redact_titles=1
- Body supplied to the source (never to Mesh): calendar_id and ICS
- Exact 200 response: JSON fields total, would_import, would_skip (all nonnegative integers no greater than 100, whose import/skip counts sum to total)
- Calendar enforces authentication and owner/edit access; anonymous callers get 401 and other accounts' inaccessible calendars are hidden with 404. A dry run never writes records or reserves transfers.

The existing default interactive preview returns sample_titles. The title-minimized form is an explicit opt-in and is not a production-approved API.

## Mesh fixture semantics

The synthetic module calendar-redacted-preview.mjs fixes these two reviewed paths and requires an injected transport; it does not handle or retain URLs, credentials, raw ICS, calendar IDs, or source-specific payloads. Construction requires the explicit local-test environment flag GC_MESH_CALENDAR_PREVIEW_FIXTURE=1.

Every synthetic call must pass **three independent callbacks returning exactly true**: Mesh policy, source-owner policy, and a distinct user-consent decision. These are test callbacks, NOT evidence of real GoreeCloud Identity claims, consent records or GoreeShield enforcement.

Unexpected response fields, including titles, notes and UIDs; duplicate keys; wrong content type or status; malformed counters; accessor objects; and oversized bodies fail closed without reflecting source content. Return values contain only the three counts or fixed denied/unavailable/invalid_response codes. The strict wire form is tied to the pinned source blob and must be reviewed when Calendar changes its serialization.

## Acceptance and remaining gates

- The ordinary synthetic Node suite checks invalid actors/routes, missing permissions or consent, untrusted getters and proxies, aborts, source faults and data leakage.
- The [source-pinned workflow](../../.github/workflows/calendar-redacted-preview-contract.yml) checks out the exact Calendar commit, verifies the handler Git blob, tests the actual owner-side endpoint, launches a real Calendar Python server with two synthetic local accounts and private temporary SQLite storage on loopback, checks count-only previews and source-side 401/404, ensures no events or tasks were imported, and destroys the disposable service.
- This does not create a production Mesh API, general content-fetch ability, real authorization or consent system, remote transport, timeout/backpressure guarantee, multi-device sync, or lossless Tasks VTODO import. Tasks→Calendar date-only due, revision, privacy-class, priority and timestamp blockers remain in [Tasks issue #25](https://github.com/GoreeCloud/tasks/issues/25).

Real integration requires versioned source APIs, fixed verified TLS transport, GoreeCloud Identity, GoreeShield consent and retention decisions, Wardveil controls, worker isolation and bounded execution, restore/rollback validation and independent release approval. No user records are used in this fixture.
