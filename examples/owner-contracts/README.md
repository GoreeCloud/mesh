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
