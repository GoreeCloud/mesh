# Mesh synthetic discovery fixture (nonproduction)

This is a local, dependency-free contract experiment implementing the first narrow slice of [Mesh stability gates](../../docs/stability-gates.md). It does **not** implement a network server, real MCP endpoint, webhook, connector, credentials, privacy enforcement, security product, or any cross-system control. The manifest names fictional fixture owners only. Node.js 24 or later is used for the reference harness; it is **not** a decision on Mesh's production runtime.

Run `npm test` for contract tests or `npm run demo` for an inert example. The demo prints a catalog and one expressly synthetic result. There are no installs, sockets, environment secrets, persistence, or external calls.

Contract rules:

- `mesh.capabilities.v1` declares only `synthetic-local-only` records with a bounded, unique capability ID and `status.read` operation. A discovered record stays `prototype` and carries **zero implicit authority**.
- Mesh policy and the simulated owning adapter must each approve an actor. All absent/throwing/false decisions are denied. No write operation is supported.
- Outcomes are typed `unsupported`, `denied`, `unavailable`, `timed_out`, or `invalid_response`. Reads have a maximum one-second configurable execution budget and a 4 KiB maximum output ceiling; fixture defaults are 100 ms and 1 KiB.
- Accepted result data is limited to a strictly shaped synthetic status, never arbitrary logs or user payload. No central request/payload logging exists.
- The timeout abort signal can stop cooperative fixture reads. An uncooperative promise may continue in memory after its caller times out; this is **not** a production isolation boundary. Production adapters require process/network-level cancellation and protection against side effects.

No part of this harness should be promoted as an operational Mesh integration until independently reviewed owner-side contracts, authorization, resilience and deployment evidence satisfy the release gates.
