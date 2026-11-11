# Stateless MCP 2026-07-28 synthetic request fixture

**Development-only, no transport and no deployment.** This fixture extends [the existing synthetic Mesh tool bridge](mcp-synthetic-tool-bridge.md) with a restricted in-process JSON-RPC envelope. It is a **partial protocol implementation**, not a compliant external MCP server or a verified connector for ChatGPT, Grok, or another AI agent.

## Scope

- The createSyntheticStatelessMcpDispatcher(bridge, { isAuthenticated, maxConcurrentCalls, maxConcurrentPerActor?, callTimeoutMs }) function accepts only host-provided, previously authenticated trustedContext; model-provided _meta.clientInfo, tool names or arguments are never authentication.
- Supports server/discover, tools/list, and tools/call with the **2026-07-28** required per-request _meta fields (version and client capabilities; optional bounded client info), returning modern resultType: complete envelopes.
- Exposes only fixed synthetic status-read capabilities. All writes, unauthorized hosts, unexpected arguments, malformed envelopes, unsupported protocol versions and legacy initialize are rejected. Callers receive generic errors without upstream details. No real data, user tokens, filesystem, socket or remote service is accessed.
- Accepts only an empty clientCapabilities object, no pagination or extensions, and a single text result bounded by the fixture. These restrictions are deliberately narrower than the actual MCP specification.
- The authenticated host may configure a small positive bounded pool (default four concurrent owner calls, accepted range 1–16) and per-call wait deadline (default 2,000 ms, accepted range 1–30,000 ms). Excess calls fail closed. A timed-out caller **does not** release capacity until the underlying operation actually settles; there is no cancellation or worker restart capability.
- Authentication callback is mandatory and must return synchronously true only for a verified host principal. Accidentally asynchronous callbacks are denied and their eventual rejections consumed. Actual Identity-issued credentials, tenant binding, GoreeShield consent and Wardveil checks are **not** implemented. The underlying fixture still enforces independent Mesh and owner reads after admission.

## Local development

The root npm test automatically includes examples/synthetic/mcp-stateless-fixture.test.mjs and existing synthetic tests (Node.js 24 in CI). No dependency installation or network listener is necessary.

Tested scenarios include two trusted mock host contexts, stateless discovery/list/call, anonymous refusal before list or execution, denied owners, mutation arguments, injected actor claims, malformed requests, inaccessible/failed owners, getter/proxy input rejection, saturation denial, timeout admission retention and invalid limit rejection.

## Immutable synthetic host identity during admission

The host must supply an already authenticated, **flat, scalar-only** context for each dispatch. The synthetic dispatcher now snapshots and freezes up to 16 own-data fields (bounded string, boolean, safe integer or null) before invoking the trusted host authentication callback. The **same snapshot** is then passed to the deferred owner tool call. Unexpected getters, proxies that fail validation, nested objects, oversized claims, functions, symbols, and invalid property names are denied before authentication or owner execution. Mutating a caller's original `actor` or `authenticated` fields after admission cannot switch the principal observed by owner callbacks.

This is defense-in-depth for **local development fixtures**; it is not an authentication mechanism or a claim that flat arbitrary host fields are verified. Authentication still depends entirely on a correctly configured trusted host callback, and production Identity claims need their own signed credential validation, principal binding, consent, privacy policy, and Wardveil checks. Nested production identity data is intentionally out of this fixture's scope.

## Trusted-host registration integrity

The constructor snapshots exact own-data `listTools` and `callTool` methods and exact own-data authentication/concurrency settings, rejecting accessor-backed, proxy-failing, unexpected or incomplete registration objects. Later mutation of a host callback cannot substitute tool enumeration, owner invocation or the authentication function. The host remains responsible for supplying a trustworthy identity; this does **not** verify an Identity token. Synthetic catalogs also validate an inert, canonical array descriptor rather than reading a potentially hostile `length` property.

## Client-visible synthetic tool metadata boundary

After host authentication, `tools/list` now validates and snapshots a fixed maximum of 32 read-only status descriptors from the injected bridge. Only bounded name/title/description fields and empty-input schema with explicit `readOnlyHint: true`, `destructiveHint: false`, and `openWorldHint: false` are accepted. Duplicate tool names, unknown fields, accessor-backed data, sparse/oversized arrays, mutation-capable declarations and malformed catalog objects fail closed with a generic error. Returned descriptors are detached copies, not references into a host registry. This is **defense-in-depth for synthetic metadata**, not permission-aware production discovery; per-user tool visibility, durable audit, identity and consent enforcement are still missing.

## Strict owner result projection

After an admitted synthetic `tools/call`, the dispatcher also snapshots an exact own-data owner result with one plain-text content item and an optional boolean `isError`. Accessor fields, unexpected keys, noncanonical/sparse arrays, exotic content types and oversized text fail closed with a generic error. Tool result bodies are copied before returning to the client, so post-response owner mutation does not modify the captured reply. The owner remains responsible for its own redaction and authorization; this check cannot prove a returned string is non-sensitive.

## Security and compatibility boundary

Do not expose this dispatcher to untrusted clients or deploy it behind HTTP/stdio. It has **no transport-level size limit**, content-type enforcement, OAuth bearer verification, workload identity, TLS, per-principal rate limiting, durable queuing, revocation, durable audit, per-tenant isolation, real-purpose/consent controls, noncooperative-owner termination or isolation, cancellation propagation, official SDK compatibility, or external-client interoperability tests. The in-process trustedContext parameter is a **trusted host injection boundary**, not a value read from JSON-RPC or a model. The mock boolean host gate only exercises test behavior.

A production implementation must select a maintained MCP SDK, support client compatibility profiles, validate HTTP or stdio ingress and request sizes, authenticate Identity claims, independently enforce GoreeShield and Wardveil rules, perform actual owner-side authorization, handle deadlines/quotas/restarts, audit with redaction, and test real supported clients. A separate draft [PR #61](https://github.com/GoreeCloud/mesh/pull/61) contains an older 2025-06-18 handshake-oriented fixture; it must be reconciled intentionally rather than merged as a competing default.

Reference specification: [2026-07-28 stateless core](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/index.mdx), [discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx), and [tool results](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx).

## Synthetic output byte-budget boundary

The single client-visible text result is limited to **4,096 encoded UTF-8 bytes**, not 4,096 JavaScript code units. Multibyte BMP and supplementary-plane text above that byte cap is rejected with the existing generic `Capability unavailable` result rather than partially returned. This is a response-projection bound for the in-process fixture, not a transport, network, OS isolation, full output-token quota, or production MCP security guarantee.

## Optional actor-scoped concurrency fairness (synthetic only)

An in-process host may configure `maxConcurrentPerActor` (1 through the global `maxConcurrentCalls`) to cap simultaneous status reads for each **verified host-supplied** `trustedContext.actor`. Actor keys must be bounded ASCII identifiers, and missing or invalid keys are rejected when this limit is enabled. Each request still passes the independent synchronous host `isAuthenticated` check and the underlying Mesh and owner checks. Client-provided `_meta.clientInfo`, tool names, arguments, or agent labels never choose the actor quota identity. Capacity is charged before the owner starts and remains charged after timeout until the underlying owner promise actually settles; idle actors are removed from the in-memory map. The existing global default is unchanged when this option is omitted. This is bounded, local **concurrency fairness**, not a per-user rate limiter, tenant isolation, verified Identity integration, revocation, policy engine or deployable MCP server.

## Optional fixed-window call quota (synthetic only)

The trusted in-process host can configure `maxCallsPerActorWindow` (1–64 accepted owner reads) and `actorWindowMs` (100–60,000 milliseconds; default 1,000 when quota is enabled). Calls are counted against the already-authenticated, bounded `trustedContext.actor` only when both the global and optional per-actor concurrency caps admit them. Rapid sequential reads over the fixed quota are denied with the existing generic response; a different host-authenticated actor retains an independent allowance. The in-memory ledger prunes expired entries and admits at most 128 distinct actor keys within unexpired windows; an additional new actor is denied until an entry expires, bounding local memory. Timeout, owner failure, and cancellation do not refund a charged request; caller/client-supplied metadata never defines the quota key. This is **fixture-only local abuse-resilience**, not a durable multi-process rate limiter, verified production identity, GoreeShield policy, Wardveil threat detection, transport or tenant isolation.
