# Mesh — synthetic Gateway and VPN health contracts (development)

**Status:** Isolated transport-injected source contract fixtures; no deployment, networking, credentials, real remote transport, or production status claims. These fixtures extend the existing dependency-free Mesh owner-contract tests, without modifying active products.

## Current verified source-owned behavior — November 25, 2026

- **Gateway console**: The pinned current Go Gateway console health fixture now uses GET /api/health as exact console process liveness and does not assert Caddy ingress, TLS, ACME or reverse-proxy status.
- **First-party GoreeCloud VPN Go control plane**: Pinned repository commit a1087842ffc904eb20bbfc9c1e00fa6d02ffc49a and Git blob 1f9bc93c3994dc789b2062cb61cfbe6fd1a63b87 from internal/api/handler.go. GET /healthz emits newline-terminated JSON {"status":"ok"} with Content-Type application/json; charset=utf-8. This is **process liveness only**, never a WireGuard tunnel, packet authorization, DNS state, approved peer policy or encrypted backup recovery signal. The older Python management source was retired; its source pin and exact-reply fixture were removed from current-facing contract tests.

The authenticated Go GET /v1/info explicitly states tunnel_operational:false. It is tested separately in the owned disposable localhost process, never substituted for the unauthenticated Mesh health projection.

## Contract rules

`gateway-healthz.mjs` and `vpn-healthz.mjs` provide separate read-only adapters atop the existing `exact-health-fixture.mjs`. No `fetch`, socket, URL selector, bearer handling, credentials or network transport is included. The caller explicitly injects the respective fixed synthetic GET route (/api/health for Gateway and /healthz for VPN); Mesh's permission callback and the adapter's own callback must both authorize. Default owner authorization is deny. A successful exact-source reply is projected into only `{state:'ok', observed_at:caller_clock}`.

Tests assert exact source pins, route and JSON response shapes, no accidental claims about active tunnels or Gateway routing, dual permit denial, wrong HTTP status/content type, extra/duplicate fields, oversized/malformed replies, hostile accessors, abort and invalid clock. Unknown/altered source contracts fail closed rather than silently widening the accepted schema.

Run `npm test` with Node 24; no `npm install` is necessary because this fixture package declares no dependencies. A passing test proves only the synthetic transport-injection behavior.

## Release/operational boundaries

These unauthenticated service liveness routes cannot substitute for source-side authentication, trusted workload identity, tenant-scoped authorization through GoreeCloud Identity, GoreeShield privacy-purpose decisions, Wardveil security review, trusted transport and process ownership, revocation, bounded retries, live service recovery, or signed deployment approval.

Gateway's live Caddy ingress and production DNS/ACME state, VPN data plane, and external hosts are explicitly **out of scope**. This PR is development evidence only; re-review the owning source blobs on any upstream update before promotion.

## Immutable first-party Go VPN source acceptance (isolated, November 25, 2026)

The dedicated .github/workflows/vpn-real-go-contract.yml workflow checks out first-party GoreeCloud/VPN source at the immutable a1087842ffc904eb20bbfc9c1e00fa6d02ffc49a revision and verifies the exact API blob, module identity, absence of legacy Python source and absence of third-party NetBird deployment ownership. It uses official SHA-pinned checkout, Go and Node setup actions. Go race tests, vet and a local binary compilation are independent from Mesh synthetic fixture tests.

vpn-real-go.smoke.mjs starts that genuine Go vpnd binary only as a disposable numeric-loopback process with temporary randomized administrator credentials and owner-private state. Mesh-plus-owner permit checks deny before transport, and the exact newline-terminated JSON reply is projected to the minimum synthetic status; anonymous or incorrect-token management reads are denied. Process outage and controlled restart are tested, including stale metadata ownership locking. The test creates no tunnel, privileged interface, firewall, DNS, external endpoint, real user or VPS service. It must not run on ordinary hosts: the script requires the exact hosted GitHub CI environment and checked source.

A green workflow validates only this development-source contract. It does **not** establish encrypted transport, production identity, signed owner permission, device admission, GoreeShield/Wardveil policy or live Mesh connectivity.

## Current first-party Gateway Go console acceptance (November 21, 2026)

The isolated workflow pins the actual GoreeCloud/gateway Go/Caddy owner source commit 35f005ecd0c77843b912fd07b98d7885c756a1f4, main.go blob b21a37a37843825d700ea4abe0c484174993218f, internal/gateway/http.go blob c04fc3264959b447feaddc2775e9eecde26b3b46 and matching go.mod/go.sum blobs. The retired standalone cmd/console code is absent. Its current Go binary has a first-party root-module serve mode, embeds the built React console, requires a private GATEWAY_ADMIN_TOKEN environment variable and binds only loopback management IPs. The unauthenticated health route is GET /api/health with JSON {"ok":true} followed by LF; the authenticated read-only management route is GET /api/status.

CI checks out immutable owner source without persistent credentials, compiles the actual current web assets, verifies locked Go module downloads, runs selected real Go control-plane security tests and builds the genuine Caddy-based Gateway binary. The source-only smoke launches it on a disposable numeric-loopback port with its own private saved-state path, rejects unauthenticated and incorrect-token management reads, denied methods and forged Host headers, accepts a correct-token status request without exposing config, and tests explicit process outage/restart. There are no production credentials, public listeners, DNS modifications, WireGuard changes or deployment actions.

A correct GET /api/health response proves only console process availability. The authenticated /api/status response is **not** proof of externally reachable Caddy ingress, public TLS, ACME certificate renewal, active routes, backup restore, DNS state or approved GoreeCloud Identity permissions. The negative tests do NOT invent unsupported browser Fetch-Metadata enforcement. This remains development-only Mesh authorization-shape verification until separately accepted and deployed.

### Native inventory least-privilege source check

The pinned Go control plane now supports an independent read-only viewer token. The disposable Mesh source test starts the real Go binary with independent randomized admin/viewer credentials, checks access_role=admin and access_role=viewer introspection, validates read-only GET requests and rejects viewer POST/DELETE mutations with HTTP 403 before rechecking after restart. This remains an isolated test, not a production Identity integration, distributed credential mechanism or deployed Mesh connector.

### GoreeShield viewer response minimization (isolated CI)

The current immutable first-party Go source restricts its viewer peer projection to name, private /32 address and textual pending/approved/revoked status. The source integration test creates a synthetic peer using an ephemeral X25519 public key with the administrator credential in a disposable localhost control plane and verifies that the viewer response contains exactly those three keys while the administrator retains the full management record. It verifies viewer mutations remain denied and that the same minimal state survives a controlled daemon restart. Production Identity scoping and public network exposure remain prohibited and untested.


### Updated reviewed first-party VPN Go source pin — November 25, 2026

The Mesh Go-health job now checks out immutable GoreeCloud/VPN commit a1087842ffc904eb20bbfc9c1e00fa6d02ffc49a, including verified Android Material 3 Expressive and Qt Network viewer code, reviewed-source GoreeCloud UI tokens, offline signed firewall reviews and a PRIVATE local review-generation ledger. The current reviewed API handler blob is 1f9bc93c3994dc789b2062cb61cfbe6fd1a63b87, so the existing read-only inventory minimization and Go /healthz tests still apply. The Mesh job deliberately builds only the Go vpnd source. The new offline reviewer, UI and native capabilities are owned by VPN and are NOT considered deployed via Mesh; the ledger is not authoritative gateway apply state. Calendar and Identity source-contract checkouts remain independently blocked.


### November 25 — current first-party VPN source validation

The reviewed immutable VPN commit now adds a read-only `vpnctl verify-gateway-current` admin-and-ledger check that rejects signed stale peer snapshots after revocation. The current Go API handler blob differs from the prior immutable fixture because its peer-registration Content-Type validation now strictly parses exactly one application/json media type; its /healthz and role-projected GET behavior remain source-verified. The Go registry emits an explicit empty peer array. Mesh's disposable source contract still checks liveness and minimal viewer projection **only**; no live peer registration, gateway apply, revocation enforcement or production Mesh routing is claimed.
