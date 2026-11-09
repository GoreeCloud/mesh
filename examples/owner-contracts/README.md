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
  c9766edfce6149ce9ba63eeba5bc49bee601b9bf.
- Memos: GET /api/v1/health, HTTP 200, JSON status ok with service
  goreecloud-memos. Verified source: GoreeCloud/memos server/app.py Git blob
  86a711f87d2902ddcdeecda294e9fdb644894c36.

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
