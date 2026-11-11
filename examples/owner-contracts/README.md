# Wardveil health contract — transport-injected acceptance fixture

**Maturity:** Local development acceptance fixture only. No HTTP client, daemon, listener, connected Wardveil process, token, endpoint configuration, production authorization or deployment.

## Verified source boundary (2026-11-09)

The current `GoreeCloud/wardveil` default-branch source `internal/httpapi/server.go` (Git blob `e4d8d68a9a1ed5c2fb28c6fc9c6956c2027c548a`) defines:

- `GET /healthz` with `200` and `{"status":"ok"}` when the event store is writable.
- `GET /healthz` with `503` and `{"error":"event ingestion unavailable"}` otherwise.
- The JSON content type `application/json; charset=utf-8` (the handler adds a newline).
- **No bearer authentication on this health endpoint**. The distinct `GET /v1/events` route requires the read token and can expose sensitive event data, so this fixture deliberately **does not call it**.

This source reference is **not** a negotiated stable Wardveil API version or an assertion that a Wardveil service is running. Recheck source and tests before any promotion.

## Contract exercise

`wardveil-healthz.mjs` exposes a fixed read-only adapter with an injected `transport({method:'GET', path:'/healthz', signal})` function. There is no `fetch`, URL selection, networking, event payload retrieval or credential storage in this module. The module returns only the projected `{state,observed_at}` synthetic status; `observed_at` is the **caller's observation time**, not a source-signed Wardveil timestamp.

A caller must separately supply an explicit permit callback. The default permit is deny. When used with the current Mesh synthetic harness, both `meshPermit` and the adapter's local permit must allow the read. **That callback does not prove real Wardveil owner-side authentication, GoreeCloud Identity authorization or GoreeShield privacy approval.**

The fixture accepts exact source-shaped 200/503 JSON, bounded to 256 UTF-8 bytes, with duplicate/unknown fields, wrong content type/status, accessor-backed data and throwing proxies rejected. Nonconforming responses are treated as unavailable; a real remote host or certificate is never configured by these tests.

## Acceptance and next gates

Run `npm test` (Node.js 24 in GitHub CI) to exercise the synthetic harness plus the new contract-specific tests. Real nonproduction integration still requires a trusted fixed origin/transport, TLS and host validation where applicable, source-owner approved versioned API contract, Identity and source authorization, GoreeShield purpose and minimization, Wardveil-owned security controls, cancellation, outage behavior, recoverability, protected secret management, and real server evidence. No deployment or Stable/Anchor release is implied.


## Explicit IPv4 loopback transport (development only)

`wardveil-loopback.mjs` provides a narrowly scoped Node.js HTTP transport that can be composed with the adapter. It requires an **explicit integer port (1024–65535)** and always connects to **127.0.0.1**, fixed `GET /healthz`. It cannot accept a hostname, URL, additional route, bearer token, payload, redirect destination, DNS target or proxy configuration. Its default end-to-end timeout is 500 ms (configurable 10–1000 ms); the response body is capped at 256 bytes. HTTP redirects are returned as unsuccessful status codes, **not followed**. Errors expose only a fixed unavailable message.

A disposable local HTTP server is started inside `wardveil-loopback.test.mjs` and exercises the contract over a real socket. This is **not** a Wardveil Go server test or permission to connect to an arbitrary local process. The exact target port must be deliberately provided, and the owning process must be verified before any user-directed local testing. This transport is not suitable for a remote production service: real deployment requires HTTPS, authenticated service identity, approved secrets, privacy enforcement and reviewed network boundaries.

Use only in a controlled test:

```js
import { createLoopbackWardveilHealthTransport } from './wardveil-loopback.mjs';
import { createWardveilHealthFixtureAdapter } from './wardveil-healthz.mjs';

// Supply the port of an explicitly authorized disposable local test server.
const transport = createLoopbackWardveilHealthTransport({ port: 8123 });
const adapter = createWardveilHealthFixtureAdapter({
  transport,
  permit: () => false, // remain denied until an authorized local test policy exists
});
```

`npm test` exercises both real-loopback happy and failure paths, still without contacting any physical VPS or household data source.

## Source-owned Go runtime acceptance (opt-in hosted CI)

The separate workflow [Wardveil source-owned Go/Mesh health contract](../../.github/workflows/wardveil-real-go-contract.yml) builds the **actual Wardveil Go development service** at a reviewed full source commit inside a temporary GitHub-hosted Linux runner. It uses SHA-pinned official GitHub checkout, Go setup and Node setup actions, a read-only GitHub token, no persisted checkout credentials, and no external Go module downloads. Before building it verifies the source commit, actual HTTP handler/main/store source Git blobs, and that the Go module has no third-party dependencies. This workflow is independent of the fast local-only Node fixture suite.

The one-shot [Wardveil Go smoke](wardveil-real-go.smoke.mjs) runs the compiled executable against an ephemeral private journal and distinct random tokens. It selects an unprivileged IPv4 loopback port, then verifies that the Mesh harness and restricted transport can: deny unapproved requests without any transport attempt, accept the genuine Go service's healthy response, recheck denial after local revocation, report unavailable when the Go process exits, and recover a healthy read after a graceful restart. It also checks the Go endpoint's denial of a direct, unauthenticated event-list request; the **Mesh adapter itself never requests events**.

Separately, the source-owned Wardveil Go handler test named TestUncertainJournalReturnsUnavailable exercises a journal append fault and expects genuine HTTP 503 degradation. A passing handler test is **not** an end-to-end server-process degradation test. The Go service's healthy response indicates only journal writability, not full Wardveil readiness, uptime, tenant enforcement, remote dependency health or any deployed service.

**Current source pin (re-review before updating):** Wardveil commit 41ff4766719e87a3f5399359d0e721cce5df9493; HTTP handler Git blob e4d8d68a9a1ed5c2fb28c6fc9c6956c2027c548a. Any source upgrade requires manual inspection of imports, ownership, main entrypoint, storage code, module dependencies and behavior, a new explicit SHA, and review of the relevant authorization/privacy/security requirements. No workflow automatically follows future Wardveil main changes.

The real Go service is a **development-only** loopback process. GitHub CI must pass before this evidence can be claimed. Production Identity/tenant scoping, GoreeShield retention/consent, Wardveil security policy, API compatibility ownership, deliberate port selection, actual remote TLS, secrets lifecycle, incident recovery and security review are *not* solved by this smoke.

The same pinned Go runtime smoke also wraps the live-response Mesh harness in its **optional in-memory diagnostic observer**. It checks locally generated correlation IDs, fixed diagnostic schema, exact classified outcomes on success/denial/outage/recovery, a two-record retention ring, explicit erasure, and the absence of test identity, tokens or journal paths in evidence records. This is an ephemeral CI regression, not an exported audit trail, production log or privacy certification.

## Additional Tasks and Memos health contracts (November 9, 2026)

Two source-verified, strictly local-development APIs have distinct unauthenticated
health responses:

- Tasks: GET /healthz, HTTP 200, JSON status ok with mode loopback-development.
  Verified source: GoreeCloud/tasks server/api.py Git blob
  e19fa407a0a8811ed0bc105c9d3cdba3157bf071.
- Memos: GET /api/v1/health, HTTP 200, JSON status ok with service
  goreecloud-memos. Verified source: GoreeCloud/memos server/app.py Git blob
  4a607701787a7ef6791d5a5dbf600938ecb3a4ed.

The new tasks-healthz.mjs, memos-health.mjs and exact-health-fixture.mjs
provide **transport-injected synthetic-only** projections from these exact
source-shaped responses to a small status and caller-observed timestamp.
The separate Mesh permit and local owner permit must both allow a read in the
synthetic harness. The default owner permit denies; source bodies are never
returned. Invalid or oversized results, extra/duplicate JSON fields,
dangerous property getters, aborts and invalid clock values fail closed.

No transport implementation, listener, URL selector, credential, task/memo
content retrieval, synchronization or deployment is created by these modules.
The tests exercise synthetic transport callbacks only. A passing health
contract is neither proof of a live healthy product nor of a production-safe
Identity, GoreeShield, Wardveil or Mesh integration. A future real connector
requires owner authorization, release approval, explicit network policy,
TLS/service authentication where appropriate and privacy review. Source pins
must be rechecked when the two owner services change.

**Source refresh, November 9, 2026:** Tasks development main
1c678126c6bd0b7b96ab19b7d09f2afa3e721a0e and Memos development
main 5f05c36f4b5a173d9e6043a695ff2030261754cc were re-read
after their HTTP-header, Memos localhost-only bind, and strict JSON depth
hardening merges. Their two unauthenticated health
handler paths and response objects are unchanged; the pins above identify
the newer reviewed source blobs. This does not make either prototype a
real authenticated service connector.

## Wardveil opt-in source-authenticated status v1 (development only)

Wardveil [PR #26](https://github.com/GoreeCloud/wardveil/pull/26) merged a dedicated, **disabled-by-default** status-only source API. The reviewed Go source is pinned in [the real Go CI workflow](../../.github/workflows/wardveil-real-go-contract.yml) at commit a79624bbe0846ca37192fc3dd9386901a9e57088. Enabling the development route requires a **third, distinct** WARDVEIL_STATUS_TOKEN (32–1024 bytes) in the local Wardveil process. This is not a substitute for GoreeCloud Identity, short-lived service identity, secure secrets lifecycle, TLS or production revocation.

The only endpoint used by the new Mesh [Wardveil status v1 adapter](wardveil-status-v1.mjs) is authenticated **GET /v1/status**. The source-owned v1 response contains only schema_version, state (ok or degraded) and the server-observed UTC millisecond timestamp. The adapter requires the exact Go JSON wire form, cross-validates HTTP 200/503, rejects unknown/duplicate fields and stale/future observations more than 30 seconds from a trusted local clock. It preserves the source timestamp; it never exposes events or actor data in outcome evidence.

[Scoped loopback transport](wardveil-status-loopback.mjs) is an **explicitly opted-in, token-bearing, IPv4 127.0.0.1-only** transport. It accepts only a reviewed port and status credential, fixes the request method/path, caps responses at 256 bytes, limits HTTP headers to 2 KiB, requires unique Content-Type plus exactly one source-set Cache-Control: no-store and X-Content-Type-Options: nosniff, enforces an absolute 32–1024-character ASCII token length and a 10–1000 ms deadline, and never follows redirects, contacts external hosts or exports tokens. Token syntax is validated, but this is not a cryptographic entropy guarantee. No arbitrary hostname, URL, event route, request payload or outbound destination is accepted.

The fast npm test suite covers synthetic local adapter and HTTP negative cases without real credentials. The separate **pinned actual-Wardveil-Go CI smoke** exercises three independent credentials, source-side 401/403 cross-scope refusals, local Mesh+owner permit denial, status-only source timestamp projection, outage/unavailable and credential rotation by controlled restart. It separately kills only the **disposable GitHub-hosted Go child** with SIGKILL and verifies the same synthetic private journal reopens, the scoped status read becomes available again, and the previously rotated-out credential remains denied. There are no event writes in this abrupt-stop step: this is **process recovery of journal writability**, not a torn-write, crash-consistency, data-integrity, backup-restore or production disaster-recovery test. A successful fixture is not proof of full source-controlled actor permissions, production audit integrity, signed source attestations or operating readiness.

**Default remains OFF:** Without the extra status environment secret, Go registers no /v1/status route (404). Existing unauthenticated /healthz and event APIs are not exposed or expanded by Mesh. Do not connect a non-test endpoint or deploy this service on a VPS based on this smoke.

**Wire-boundary regression:** The scoped transport now refuses missing, duplicated or cacheable source response metadata and fails closed on credentials exceeding the Go source's maximum byte length or containing trailing newlines. These are additional checks of the *local development* route, not transport authentication, protection against an attacker who controls the selected loopback port or authorization to reach a VPS. The caller still must verify target process ownership in any future real connector.

## Workspace Teams source-pinned synthetic health fixture (November 10, 2026)

The separate development Workspace Teams source commit
32429a0ae1d15dfc79864c75ee9afcf7932c58eb was directly inspected at
src/server.mjs (Git blob e6d80f401454ee9bd78b4ab9ae9066cc66d3ae27).
The current GET /api/health route returns exactly HTTP 200 with
{"status":"ok"}, the UTF-8 JSON content type and Cache-Control: no-store
through the shared send helper. It is a public *liveness* response, **not**
a sign that first-owner registration is protected, SQLite/attachments are
healthy, the app is ready for public traffic or any user is authorized.

The workspace-teams-health.mjs module reuses only the existing bounded,
exact-body transport-injected fixture. The synthetic Mesh permit and owner
permit independently default deny; any result body differing from the
reviewed status shape, including account or private space fields, is
unavailable. The fixture does not open sockets or read accounts, messages,
tasks, notes, files, attachment scan state, first-owner setup or session
cookies. It does not configure a real Workspace Teams connector or enable
synchronization. The source pin is deliberately distinct from unrelated
Wardveil, Tasks, Memos, Gateway and VPN status source pins.

Live integration requires a separately authorized source-owner service
identity, Identity tenant-scoped policy, GoreeShield privacy minimization,
Wardveil security enforcement, TLS/host trust, a verified fixed target
process, monitoring and source/version/release approval. The current
source is development-only and may change; an exact status fixture is not
production integration acceptance.

**Memos source refresh, November 10, 2026:** Memos development main
f8e7795b5a2d6dd5494617d32df5db87a67fcb7d, following PR #69,
was re-read and the exact server/app.py Git blob re-pinned above.
PR #69 changes the lifetime of per-operation SQLite connections,
not the unauthenticated GET /api/v1/health handler or its status
response. This is only source-evidence reconciliation; it adds no
user-data transport, Identity decision, production endpoint,
monitoring daemon or release.

## DAV / Contacts experimental health fixture (November 10, 2026)

The **unmerged, undeployed** [GoreeCloud DAV PR #1](https://github.com/GoreeCloud/DAV/pull/1)
contains `public/index.php` at reviewed Git blob
`6a270d95c406def94482a9a4c6e9006c016a1e51`.
Its unauthenticated `GET /healthz` handler sends HTTP 200,
`Content-Type: application/json` (without an added charset parameter in
the PHP handler) and the exact JSON
`{"service":"goreecloud-dav","status":"up"}`.

`dav-healthz.mjs` applies the same default-deny and transport-injected
synthetic-only policy as the other owner fixtures. The common adapter now
supports two *exact*, allowlisted source content types instead of silently
assuming the DAV response includes a charset parameter. Its checks reject
cross-product body swaps, unexpected headers, malformed responses, timeouts
and missing permits. Only a minimized, caller-observed status is returned.

This says nothing about real CardDAV contact synchronization, VTODO task
synchronization, TLS or credential storage, DAV account authorization,
per-principal readiness, actual availability, or production integration.
It does not fetch user contacts, task data or DAV paths, open sockets, or
deploy a listener. Recheck the source and versioned trust boundary if DAV PR
#1 is changed or merged; a future authenticated readiness API requires
its own scope, consent, privacy and security review.

## Tasks owner-source refresh (November 10, 2026)

The Tasks development API `server/api.py` on the verified main commit
`9db568bfe5236ecd4282a1e88f6f09ee26702dbf` has Git blob
`12dc998bdc303e6efab7e896f384041563115977`. The original
unauthenticated, loopback-only `GET /healthz` response remains exactly
`{"status":"ok","mode":"loopback-development"}` with JSON UTF-8
content type. The owner service now also guards parent symlink paths for its
local SQLite stores and marks bounded `GET /v1/tasks` listings with
`hasMore`, but those data operations are **not** reachable via this Mesh
health fixture. Its source pin and strict regression now reject a synthetic
private task-list response on the fixed health path without exposing its
content. This is source readback and synthetic CI, **not** a live authenticated
Tasks connector, CardDAV/VTODO sync, a per-tenant readiness API, or production
Identity/GoreeShield/Wardveil acceptance.

## Tasks checkpoint-paging source refresh (November 10, 2026)

The Tasks local-only development API on main commit
`1afcc89276e6bb9ecaef1ad45976110f4ffb24da` now exposes a new
**authenticated, opt-in** bounded `GET /v1/bootstrap-page` initial-snapshot
contract, with UUID keyset pagination and a transactional change-log checkpoint.
The verified `server/api.py` source is Git blob
`d3b0b1a554608f53afcd50ae5641295d17b564e0`. A client must discard
collected pages and restart upon HTTP 409 when concurrent task mutations change
the checkpoint. This is compatible with the existing development-only
unauthenticated `GET /healthz` response, which remains exactly
`{"status":"ok","mode":"loopback-development"}`.

**Mesh does not query, transport, cache, proxy, log, or share task snapshots.**
Its same private, synthetic-only Tasks health fixture now pins the current
verified owner blob and adds an explicit test that even a syntactically valid
private bootstrap page response is rejected and redacted on the fixed health
route. This is contract compatibility and data-boundary testing, not a released
Identity tenant-scope integration, GoreeShield consent grant, Wardveil security
signoff, native-client synchronization, or live service deployment.

## GoreeCloud DNS client health — source-owned synthetic contract (November 10, 2026)

The `dns-health.mjs` adapter exercises a **synthetic, transport-injected** form of the first-party Technitium-derived GoreeCloud DNS `GET /api/dnsClient/healthCheck` endpoint. Source boundaries: `GoreeCloud/DNS/DnsServerCore/WebServiceApi.cs` blob `333b11d0c32b9cd57bcb561fb2d94fa4e8e4ea40` runs `DirectQueryAsync` for an A query of `localhost` when no domain is supplied; `APIDOCS.md` blob `fb1e769a04fc00e384189cee9f417532a4c75a22` documents `DnsClient: View`, the fixed path, and a response containing `server` and `status:ok`. The web service returns `application/json; charset=utf-8`. The source also permits local calls without a user session; **do not expose or rely on that exemption as a real Mesh authorization path**.

The fixture has **no socket, URL, token, credential, production transport, DNS query or user data**. A trusted caller supplies a transport, and both a separate Mesh-level and adapter-level explicit permit must grant before invocation (default deny). Only an exact bounded two-field response from that transport, an unambiguous ASCII DNS server name and `status:ok` yield the minimal `{state:'ok',observed_at}` synthetic projection. Server name, raw body and transport errors are never passed to Mesh. Tests reject duplicate/unknown fields, Unicode escape aliases, response accessor traps, wrong content type/status, malformed timestamps and aborts.

This check is **internal DNS client query liveness only**. It does **not** verify upstream recursive DNS availability, DoH/DoT/DoQ certificate/protocol behavior, DNSSEC, published listener routing, encrypted DNS migration, GoreeShield privacy consent, Wardveil cybersecurity enforcement, or production readiness. A future real connector must independently prove scoped Identity authorization, transport TLS, owner-side `DnsClient: View` semantics, consent and network isolation before using any actual service. Both source-owned and Mesh tests must remain green after source changes.

A separate regression also routes this fixture through the current Mesh synthetic 2026-07-28 MCP-shaped request dispatcher (`server/discover`, `tools/list`, `tools/call`). This establishes local contract interoperability between the DNS fixture and the common read-only Mesh tool interface, **not** real DNS connectivity, a published MCP server or external AI client compatibility.


## GoreeCloud Calendar liveness and database readiness — development source contract (November 11, 2026)

The source-pinned, transport-injected fixtures exercise only two separate first-party GoreeCloud Calendar *draft* HTTP handler contracts: GET /healthz reports handler liveness as exactly status:ok; GET /readyz reports SQLite schema readiness as exactly status:ready. Both are pinned to source commit bea6665b31b81fc9bf4310c3fc071b3c2ed519e6 and calendar_app/core.py Git blob ac6be2c5d9c1a61b42a90ed77af7f86cf165cd65. The Calendar repo PR #1 remains **draft, unmerged, undeployed**; do not use these tests to infer Calendar main has this contract.

Each adapter uses a caller-injected transport (no sockets in the module), an independent explicit owner permit, and the existing Mesh harness's separate permit. Missing, revoked, or throwing authorization fails closed. Success returns only a synthetic state and ISO timestamp. It never returns calendar names, events, participants, free/busy windows, account credentials, or task content. A healthy HTTP handler can coexist with an unavailable database, so liveness **must not** be represented as readiness. Tests include malformed responses, unauthorized requests, error redaction, fail-closed aborts, and separate readiness failure.

The source-pinned CI workflow creates only a temporary SQLite database and binds the reviewed draft's Python HTTP server on 127.0.0.1 with port zero, exercises actual Python handlers through an isolated Node test, simulates temporary storage unavailability, and closes the server. This is **not** a publicly reachable service, a live Calendar deployment or an authorized customer data probe. It does not assert CalDAV support, real-device sync, recovered backups, access to personal calendars, production Identity tokens, GoreeShield privacy consent, Wardveil security acceptance, or real MCP client compatibility. A separate synthetic test verifies two mock Calendar status tools can be listed/read through the existing modern in-process Mesh MCP fixture; denied agents cannot reach transport.

Revalidate pinned source hashes and authorization/response assumptions if Calendar draft #1 changes or becomes merged. Do not interpret source readiness or local CI as production availability.
