# Mesh synthetic discovery fixture (nonproduction)

This is a local, dependency-free contract experiment implementing the first narrow slice of [Mesh stability gates](../../docs/stability-gates.md). It does **not** implement a network server, real MCP endpoint, webhook, connector, credentials, privacy enforcement, security product, or any cross-system control. The manifest names fictional fixture owners only. Node.js 24 or later is used for the reference harness; it is **not** a decision on Mesh's production runtime.

Run `npm test` for contract tests or `npm run demo` for an inert example. The demo prints a catalog and one expressly synthetic result. There are no installs, sockets, environment secrets, persistence, or external calls.

Contract rules:

- `mesh.capabilities.v1` declares only `synthetic-local-only` records with a bounded, unique capability ID and `status.read` operation. Manifest and capability fields are snapshotted from exact own data descriptors; hostile getters, sparse/accessor array entries, symbols, undeclared properties and throwing proxy traps are rejected without executing getter bodies. A discovered record stays `prototype` and carries **zero implicit authority**.
- Mesh policy and the simulated owning adapter must each approve an actor. All absent/throwing/false decisions are denied. The *outer* constructor options are also snapshotted from own data descriptors before access: getters, inherited/hidden fields and throwing proxies cannot execute at initialization. Adapter registration and method lookup require plain own data descriptors; getters, inherited methods and throwing proxy traps cannot trigger owner work. No write operation is supported.
- Outcomes are typed `unsupported`, `denied`, `unavailable`, `timed_out`, or `invalid_response`. Reads have a maximum one-second configurable execution budget and a 4 KiB maximum output ceiling; fixture defaults are 100 ms and 1 KiB. The base harness also limits in-flight reads to eight by default (`maxConcurrentReads`, range 1–32), refusing excess work as `unavailable` **before** invoking Mesh policy or owner callbacks; a slot is released **only when the underlying policy/owner action settles**, even if its caller has already timed out.
- Accepted result data is limited to a strictly shaped synthetic status, never arbitrary logs or user payload. No central request/payload logging exists.
- The timeout abort signal can stop cooperative fixture reads. An uncooperative promise may continue in memory after its caller times out; its admission slot deliberately remains reserved so repeated timed-out callers cannot create unbounded overlapping owner work. **An owner that never settles can exhaust all slots indefinitely and block further reads until the fixture process is reset.** That is fail-closed behavior, not reliable production cancellation. Production adapters require process/network-level hard deadlines, forcibly recoverable worker isolation, backpressure and protection against late side effects.

No part of this harness should be promoted as an operational Mesh integration until independently reviewed owner-side contracts, authorization, resilience and deployment evidence satisfy the release gates.


## Opt-in correlation evidence and concurrency admission

`evidence.mjs` adds a **nonproduction**, in-memory wrapper for the same synthetic `read()` interface. It never opens a socket, exports telemetry, performs a retry, changes the owner's response, grants a permission, or writes durable state. Opting into the wrapper creates a bounded ring of `mesh.synthetic-evidence.v1` terminal records containing **only** `schema_version`, a random local `correlation_id`, the enumerated `outcome`, and `observed_at`. No actor, request, capability name, response data, error text, credential, or raw payload is retained.

```js
import { createFixtureHarness } from './fixtures.mjs';
import { createSyntheticReadObserver } from './evidence.mjs';

const observer = createSyntheticReadObserver(createFixtureHarness(), {
  capacity: 32, maxInFlight: 8,
});
const { correlation_id, response } = await observer.read({
  actor: 'fixture.reader',
  capabilityId: 'fixture.alpha.status',
  operation: 'status.read',
});
const privateEvidence = observer.records();
observer.clear(); // explicit in-memory retention control
```

The wrapper records completion order, not invocation order. It refuses an excess concurrent read **before** calling the owner, returning the existing typed `unavailable` outcome. Calls already running are governed by the underlying synthetic harness's timeout and cancellation limits; the observer cannot stop an owner that ignores cancellation. It passes through the original result object or thrown exception, without writing either into evidence. Invalid configuration/accessors/proxies are rejected before invoking untrusted getters. Correlation IDs are local diagnostics, not signed attestations, durable audit IDs, service health proofs, authorization tokens or permission to share evidence externally.

Validation: `npm test` includes `evidence.test.mjs` alongside the existing synthetic contract tests. Live Identity, GoreeShield, Wardveil, production telemetry, durable delivery and real adapters remain unimplemented.
