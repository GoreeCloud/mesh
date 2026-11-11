# Calendar VTODO importability — source-pinned Mesh response contract

**Status:** Development-only synthetic response fixture, November 11, 2026. No deployed connector, real credentials, task records, consent transfer or synchronization.

Source: GoreeCloud/calendar draft PR #7 at commit `49ba88b9fc81bc73ea42033bcd11a37df2bab629`, stacked on the title-redaction and foundation draft branches. Reviewed `calendar_app/core.py` blob `f421b8eeae7eb731aba48a4091a81b952903a384` and `calendar_app/vtodo.py` blob `bc56faf45dea5184b25e71eab72406e4b5677b0f`.

Exact authenticated, owner/edit path: `POST /api/v1/import-tasks.ics?dry_run=1&redact_titles=1&preflight=1`. A declined source import returns HTTP 200 and only a boolean `importable:false` plus enumerated reason codes. A parser-accepted input returns `importable:true`, an empty reason list, and integer-only `total`, `would_import`, `would_skip`. The source explicitly never writes during this preflight.

The Mesh parser in `calendar-vtodo-preflight.mjs` has no transport, actor or permission grant. It accepts only the exact source-owned serialized JSON shapes, content type and status; refuses duplicate or unknown fields, malformed counts, unrecognized reason codes, getters, proxies and unexpected payloads. Titles, UIDs, private notes and raw ICS cannot enter its output. The isolated CI test uses a source-pinned Calendar checkout and a disposable loopback HTTP server with two synthetic accounts, verifies 401/404, rejected VTODO semantics, successful numeric preview and zero task changes.

`importable` means accepted by the current strict Calendar parser; it does not promise lossless conversion, preserved task revisions or classifications, compatibility with third-party clients, or live sync. The Tasks→Calendar data-model mismatch remains open in GoreeCloud/tasks issue #25. Production Mesh connectivity would require Identity, GoreeShield consent, Wardveil controls, vetted TLS transport, quotas, revocation and release acceptance.
