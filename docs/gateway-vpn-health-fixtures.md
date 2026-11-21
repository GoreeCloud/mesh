# Mesh — synthetic Gateway and VPN health contracts (development)

**Status:** Isolated transport-injected source contract fixtures; no deployment, networking, credentials, real remote transport, or production status claims. These fixtures extend the existing dependency-free Mesh owner-contract tests, without modifying active products.

## Current verified source-owned behavior — November 21, 2026

- **Gateway console**: The existing pinned development Gateway console health fixture remains unchanged. GET /healthz is limited to console process liveness and does not assert Caddy ingress, TLS, ACME or reverse-proxy status.
- **First-party GoreeCloud VPN Go control plane**: Pinned repository commit 09eb75dca0dadabcf0df1898c64e3877e5802dee and Git blob d502a8e7e859c78a038ad92874eed7e224bf83b6 from internal/api/handler.go. GET /healthz emits newline-terminated JSON {"status":"ok"} with Content-Type application/json; charset=utf-8. This is **process liveness only**, never a WireGuard tunnel, packet authorization, DNS state, approved peer policy or encrypted backup recovery signal. The older Python management source was retired; its source pin and exact-reply fixture were removed from current-facing contract tests.

The authenticated Go GET /v1/info explicitly states tunnel_operational:false. It is tested separately in the owned disposable localhost process, never substituted for the unauthenticated Mesh health projection.

## Contract rules

`gateway-healthz.mjs` and `vpn-healthz.mjs` provide separate read-only adapters atop the existing `exact-health-fixture.mjs`. No `fetch`, socket, URL selector, bearer handling, credentials or network transport is included. The caller explicitly injects a synthetic `transport({method:'GET', path:'/healthz', signal})`; Mesh's permission callback and the adapter's own callback must both authorize. Default owner authorization is deny. A successful exact-source reply is projected into only `{state:'ok', observed_at:caller_clock}`.

Tests assert exact source pins, route and JSON response shapes, no accidental claims about active tunnels or Gateway routing, dual permit denial, wrong HTTP status/content type, extra/duplicate fields, oversized/malformed replies, hostile accessors, abort and invalid clock. Unknown/altered source contracts fail closed rather than silently widening the accepted schema.

Run `npm test` with Node 24; no `npm install` is necessary because this fixture package declares no dependencies. A passing test proves only the synthetic transport-injection behavior.

## Release/operational boundaries

These unauthenticated service liveness routes cannot substitute for source-side authentication, trusted workload identity, tenant-scoped authorization through GoreeCloud Identity, GoreeShield privacy-purpose decisions, Wardveil security review, trusted transport and process ownership, revocation, bounded retries, live service recovery, or signed deployment approval.

Gateway's live Caddy ingress and production DNS/ACME state, VPN data plane, and external hosts are explicitly **out of scope**. This PR is development evidence only; re-review the owning source blobs on any upstream update before promotion.

## Immutable first-party Go VPN source acceptance (isolated, November 21, 2026)

The dedicated .github/workflows/vpn-real-go-contract.yml workflow checks out first-party GoreeCloud/VPN source at the immutable 09eb75dca0dadabcf0df1898c64e3877e5802dee revision and verifies the exact API blob, module identity, absence of legacy Python source and absence of third-party NetBird deployment ownership. It uses official SHA-pinned checkout, Go and Node setup actions. Go race tests, vet and a local binary compilation are independent from Mesh synthetic fixture tests.

vpn-real-go.smoke.mjs starts that genuine Go vpnd binary only as a disposable numeric-loopback process with temporary randomized administrator credentials and owner-private state. Mesh-plus-owner permit checks deny before transport, and the exact newline-terminated JSON reply is projected to the minimum synthetic status; anonymous or incorrect-token management reads are denied. Process outage and controlled restart are tested, including stale metadata ownership locking. The test creates no tunnel, privileged interface, firewall, DNS, external endpoint, real user or VPS service. It must not run on ordinary hosts: the script requires the exact hosted GitHub CI environment and checked source.

A green workflow validates only this development-source contract. It does **not** establish encrypted transport, production identity, signed owner permission, device admission, GoreeShield/Wardveil policy or live Mesh connectivity.

## Pinned real Gateway Go console acceptance (November 10, 2026)

The separate GitHub-hosted `.github/workflows/gateway-real-go-contract.yml` checks out the reviewed GoreeCloud Gateway **development source commit** `5f976a38c688c0d366d8d82adf5464a36720729f`, verifies the exact Go console/OIDC sources and `go.mod`/`go.sum` blob identities, builds `cmd/console`, then runs `gateway-real-go.smoke.mjs` against one disposable numeric-loopback **console process** with a generated ephemeral bearer token. All source checkout and build steps are confined to the GitHub CI runner; no deployment credentials are used.

The smoke exercises the exact `/healthz` Go response through the existing transport-injected Mesh fixture; default deny, source-owner deny-before-I/O, anonymous and incorrect-token overview rejection, read-only method rejection, forged cross-site rejection, correct-token console API acceptance, clean process outage and restart. It creates no public listener, DNS record, TLS certificate, WireGuard interface, trusted Caddy admin endpoint or production route.

The endpoint `/healthz` proves only that the **console process** can answer. Even a correct-token `/api/v1/overview` response proves neither actual Gateway ingress health nor public TLS, DNS, route parity, certificate renewal, backup recovery or tenant-scoped Identity permission. Until exact-head CI and reviewed source ownership succeed, this addition is **proposed development acceptance**, not a shipped connector. Passing does not authorize production deployment.

The reviewed Gateway source commit also contains an authenticated `/api/v1/readiness` endpoint. This source-owned Mesh integration intentionally probes **only** `/healthz`: neither its contract nor the loopback test treats console liveness as administrative readiness or ingress route/TLS health.

### Native inventory least-privilege source check

The pinned Go control plane now supports an independent read-only viewer token. The disposable Mesh source test starts the real Go binary with independent randomized admin/viewer credentials, checks access_role=admin and access_role=viewer introspection, validates read-only GET requests and rejects viewer POST/DELETE mutations with HTTP 403 before rechecking after restart. This remains an isolated test, not a production Identity integration, distributed credential mechanism or deployed Mesh connector.
