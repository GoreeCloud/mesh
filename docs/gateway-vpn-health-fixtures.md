# Mesh — synthetic Gateway and VPN health contracts (development)

**Status:** Isolated transport-injected source contract fixtures; no deployment, networking, credentials, real remote transport, or production status claims. These fixtures extend the existing dependency-free Mesh owner-contract tests, without modifying active products.

## Verified source-owned behavior — November 9, 2026

- **Gateway console**: `GoreeCloud/gateway`, `cmd/console/main.go` Git blob `45b7104824efcbf0019f93334546070a6ca0c561`. `GET /healthz` emits JSON `{"ok":true}` with a trailing newline under Go `json.Encoder.Encode`, and `Content-Type: application/json; charset=utf-8`. This is console HTTP handler liveness only, not an authenticated read of Caddy admin state, TLS, proxy routes, ACME or certificate renewal. The actual console is loopback-only and requires separate secure setup; Mesh does not publish or query it.
- **VPN management**: `GoreeCloud/VPN`, `src/goreecloud_vpn/server.py` Git blob `d43c64e12c750205adc567e1cb4ba8ab4923685c`. `GET /healthz` emits compact JSON `{"status":"ok","maturity":"alpha","component":"management"}` with the same JSON content type, after strict local Host/origin/request framing checks. This is process liveness only; it never asserts active WireGuard, routing, private DNS, data-plane authorization or nftables enforcement.

A separately proposed VPN `GET /api/v1/readiness` route is **not** consumed by these untrusted source fixtures. Its authenticated development-branch behavior must not be conflated with the currently verified default-branch `/healthz` body or a stable, negotiated integration API.

## Contract rules

`gateway-healthz.mjs` and `vpn-healthz.mjs` provide separate read-only adapters atop the existing `exact-health-fixture.mjs`. No `fetch`, socket, URL selector, bearer handling, credentials or network transport is included. The caller explicitly injects a synthetic `transport({method:'GET', path:'/healthz', signal})`; Mesh's permission callback and the adapter's own callback must both authorize. Default owner authorization is deny. A successful exact-source reply is projected into only `{state:'ok', observed_at:caller_clock}`.

Tests assert exact source pins, route and JSON response shapes, no accidental claims about active tunnels or Gateway routing, dual permit denial, wrong HTTP status/content type, extra/duplicate fields, oversized/malformed replies, hostile accessors, abort and invalid clock. Unknown/altered source contracts fail closed rather than silently widening the accepted schema.

Run `npm test` with Node 24; no `npm install` is necessary because this fixture package declares no dependencies. A passing test proves only the synthetic transport-injection behavior.

## Release/operational boundaries

These unauthenticated service liveness routes cannot substitute for source-side authentication, trusted workload identity, tenant-scoped authorization through GoreeCloud Identity, GoreeShield privacy-purpose decisions, Wardveil security review, trusted transport and process ownership, revocation, bounded retries, live service recovery, or signed deployment approval.

Gateway's live Caddy ingress and production DNS/ACME state, VPN data plane, and external hosts are explicitly **out of scope**. This PR is development evidence only; re-review the owning source blobs on any upstream update before promotion.

## Pinned real Python source acceptance (isolated, November 9, 2026)

The separate GitHub-hosted workflow `.github/workflows/vpn-real-python-contract.yml` now checks out GoreeCloud/VPN at immutable development commit `13973c531d9c9147cdd353c06656e7ae4a796cf8`, verifies actual Git blobs for the management server, store, plans, diagnostics and package metadata, and rejects dependency drift before importing source. No packages are installed. This is **one inspected management-alpha code revision**, not a floating latest VPN implementation.

`vpn-real-python.smoke.mjs` starts the *genuine* pinned Python management server only as a disposable `127.0.0.1` child with a strong random temporary token and private temporary SQLite store. It verifies Mesh-plus-owner permit denial *before transport*, exact response projection with the real source handler, unauthenticated and incorrect-token management rejection, browser-origin refusal, local owner-policy revocation, outage and restart/recovery. The test uses a narrow GET-only transport; it never registers a peer, changes an allow policy, creates a tunnel, binds a real DNS port, runs privileged nftables commands, or contacts an external host.

The guarded script refuses normal execution without its exact GitHub CI environment flag and the source checkout path. A separately authorized Linux development-laptop run of this script returned its success marker after the four lifecycle checkpoints, including private store cleanup; exact-head hosted CI remains its own required gate. Passing source-contract acceptance **does not** establish a working VPN data plane, packet enforcement, source identity outside the disposable process, tenant-bound Identity access, GoreeShield purpose approval, Wardveil production security, durable storage, remote TLS, service availability, or permission to enable Mesh in production.

## Pinned real Gateway Go console acceptance (November 10, 2026)

The separate GitHub-hosted `.github/workflows/gateway-real-go-contract.yml` checks out the reviewed GoreeCloud Gateway **development source commit** `5f976a38c688c0d366d8d82adf5464a36720729f`, verifies the exact Go console/OIDC sources and `go.mod`/`go.sum` blob identities, builds `cmd/console`, then runs `gateway-real-go.smoke.mjs` against one disposable numeric-loopback **console process** with a generated ephemeral bearer token. All source checkout and build steps are confined to the GitHub CI runner; no deployment credentials are used.

The smoke exercises the exact `/healthz` Go response through the existing transport-injected Mesh fixture; default deny, source-owner deny-before-I/O, anonymous and incorrect-token overview rejection, read-only method rejection, forged cross-site rejection, correct-token console API acceptance, clean process outage and restart. It creates no public listener, DNS record, TLS certificate, WireGuard interface, trusted Caddy admin endpoint or production route.

The endpoint `/healthz` proves only that the **console process** can answer. Even a correct-token `/api/v1/overview` response proves neither actual Gateway ingress health nor public TLS, DNS, route parity, certificate renewal, backup recovery or tenant-scoped Identity permission. Until exact-head CI and reviewed source ownership succeed, this addition is **proposed development acceptance**, not a shipped connector. Passing does not authorize production deployment.

The reviewed Gateway source commit also contains an authenticated `/api/v1/readiness` endpoint. This source-owned Mesh integration intentionally probes **only** `/healthz`: neither its contract nor the loopback test treats console liveness as administrative readiness or ingress route/TLS health.
