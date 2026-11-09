# Mesh — synthetic Gateway and VPN health contracts (development)

**Status:** Isolated transport-injected source contract fixtures; no deployment, networking, credentials, real remote transport, or production status claims. These fixtures extend the existing dependency-free Mesh owner-contract tests, without modifying active products.

## Verified source-owned behavior — November 9, 2026

- **Gateway console**: `GoreeCloud/gateway`, `cmd/console/main.go` Git blob `e17003e921f8ff9dfe1a7216151e6cb11f12c73c`. `GET /healthz` emits JSON `{"ok":true}` with a trailing newline under Go `json.Encoder.Encode`, and `Content-Type: application/json; charset=utf-8`. This is console HTTP handler liveness only, not an authenticated read of Caddy admin state, TLS, proxy routes, ACME or certificate renewal. The actual console is loopback-only and requires separate secure setup; Mesh does not publish or query it.
- **VPN management**: `GoreeCloud/VPN`, `src/goreecloud_vpn/server.py` Git blob `d43c64e12c750205adc567e1cb4ba8ab4923685c`. `GET /healthz` emits compact JSON `{"status":"ok","maturity":"alpha","component":"management"}` with the same JSON content type, after strict local Host/origin/request framing checks. This is process liveness only; it never asserts active WireGuard, routing, private DNS, data-plane authorization or nftables enforcement.

A separately proposed VPN `GET /api/v1/readiness` route is **not** consumed by these untrusted source fixtures. Its authenticated development-branch behavior must not be conflated with the currently verified default-branch `/healthz` body or a stable, negotiated integration API.

## Contract rules

`gateway-healthz.mjs` and `vpn-healthz.mjs` provide separate read-only adapters atop the existing `exact-health-fixture.mjs`. No `fetch`, socket, URL selector, bearer handling, credentials or network transport is included. The caller explicitly injects a synthetic `transport({method:'GET', path:'/healthz', signal})`; Mesh's permission callback and the adapter's own callback must both authorize. Default owner authorization is deny. A successful exact-source reply is projected into only `{state:'ok', observed_at:caller_clock}`.

Tests assert exact source pins, route and JSON response shapes, no accidental claims about active tunnels or Gateway routing, dual permit denial, wrong HTTP status/content type, extra/duplicate fields, oversized/malformed replies, hostile accessors, abort and invalid clock. Unknown/altered source contracts fail closed rather than silently widening the accepted schema.

Run `npm test` with Node 24; no `npm install` is necessary because this fixture package declares no dependencies. A passing test proves only the synthetic transport-injection behavior.

## Release/operational boundaries

These unauthenticated service liveness routes cannot substitute for source-side authentication, trusted workload identity, tenant-scoped authorization through GoreeCloud Identity, GoreeShield privacy-purpose decisions, Wardveil security review, trusted transport and process ownership, revocation, bounded retries, live service recovery, or signed deployment approval.

Gateway's live Caddy ingress and production DNS/ACME state, VPN data plane, and external hosts are explicitly **out of scope**. This PR is development evidence only; re-review the owning source blobs on any upstream update before promotion.
