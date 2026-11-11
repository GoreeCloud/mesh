# Universal MCP development fixtures

**Maturity:** isolated, nonproduction reference code only. The Mesh MCP dispatcher is an in-process JSON-RPC fixture and **not** a standards-certified or externally reachable MCP server. No sockets, credentials, production users, deployments, network transport, official client compatibility, persistent registry, signed token verification, GoreeShield consent engine or Wardveil threat-policy service are included.

## Scope
- `capability-registry.mjs`: versioned, immutable internal capability records; strict descriptor-based registration; deny-by-default scope/policy discovery and per-request actor snapshots.
- `mcp-dispatcher.mjs`: `2025-06-18` initialization and initialized notification; read-only `tools/list` and zero-argument `tools/call`; per-call reauthorization; bounded output, timeout, cancellation signal and in-flight admission. A noncooperative underlying promise retains its slot until settlement.
- `wardveil-health-mcp.mjs`: explicit injected transport to source-checked `/healthz` health response adapter; Mesh policy and independent local owner permit. The underlying development health endpoint is unauthenticated and **must not** be exposed to external agents as a production connector.
- `*.test.mjs`: negative security tests, protocol lifecycle, owner denials, failure containment and synthetic Wardveil source-shaped response acceptance.

Run the isolated tests with `node --test docs/*.test.mjs examples/mcp/*.test.mjs` from the repository root. They are included in the root `npm test` suite.

## Security and protocol gaps

Authorization callbacks and actor attributes are test fixtures, **not** production GoreeCloud Identity attestations. Synchronous policy functions can block the event loop, and uncooperative owners may hold capacity indefinitely despite timeout; safe production isolation must terminate abandoned workers. The demonstration does not implement the full MCP specification (resources, prompts, pagination, multi-version negotiation, official SDK, streamable HTTP, OAuth, SSE, sessions, progress and client compatibility). It does not implement input/output schema validation for arbitrary tools or enforce a signed tenant and audience claim. Do not enable external access or classify as Stable until the independent privacy, security, ownership, protocol and release gates pass.

Wardveil, GoreeShield, Identity, and GoreeCloud UI retain distinct platform responsibilities. Mesh must not acquire implicit administrator authority.
