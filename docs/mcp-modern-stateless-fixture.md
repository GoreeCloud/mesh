# Stateless MCP 2026-07-28 synthetic request fixture

**Development-only, no transport and no deployment.** This fixture extends [the existing synthetic Mesh tool bridge](mcp-synthetic-tool-bridge.md) with a restricted in-process JSON-RPC envelope. It is a **partial protocol implementation**, not a compliant external MCP server or a verified connector for ChatGPT, Grok, or another AI agent.

## Scope

- The createSyntheticStatelessMcpDispatcher(bridge, { isAuthenticated }) function accepts only host-provided, previously authenticated trustedContext; model-provided _meta.clientInfo, tool names or arguments are never authentication.
- Supports server/discover, tools/list, and tools/call with the **2026-07-28** required per-request _meta fields (version and client capabilities; optional bounded client info), returning modern resultType: complete envelopes.
- Exposes only fixed synthetic status-read capabilities. All writes, unauthorized hosts, unexpected arguments, malformed envelopes, unsupported protocol versions and legacy initialize are rejected. Callers receive generic errors without upstream details. No real data, user tokens, filesystem, socket or remote service is accessed.
- Accepts only an empty clientCapabilities object, no pagination or extensions, and a single text result bounded by the fixture. These restrictions are deliberately narrower than the actual MCP specification.
- Authentication callback is mandatory and must return synchronously true only for a verified host principal. Actual Identity-issued credentials, tenant binding, GoreeShield consent and Wardveil checks are **not** implemented. The underlying fixture still enforces independent Mesh and owner reads after admission.

## Local development

The root npm test automatically includes examples/synthetic/mcp-stateless-fixture.test.mjs and existing synthetic tests (Node.js 24 in CI). No dependency installation or network listener is necessary.

Tested scenarios include two trusted mock host contexts, stateless discovery/list/call, anonymous refusal before list or execution, denied owners, mutation arguments, injected actor claims, malformed requests, inaccessible/failed owners, and getter/proxy input rejection.

## Security and compatibility boundary

Do not expose this dispatcher to untrusted clients or deploy it behind HTTP/stdio. It has **no transport-level size limit**, content-type enforcement, OAuth bearer verification, workload identity, TLS, rate limiting, revocation, durable audit, per-tenant isolation, real-purpose/consent controls, cancellation propagation, official SDK compatibility, or external-client interoperability tests. The in-process trustedContext parameter is a **trusted host injection boundary**, not a value read from JSON-RPC or a model. The mock boolean host gate only exercises test behavior.

A production implementation must select a maintained MCP SDK, support client compatibility profiles, validate HTTP or stdio ingress and request sizes, authenticate Identity claims, independently enforce GoreeShield and Wardveil rules, perform actual owner-side authorization, handle deadlines/quotas/restarts, audit with redaction, and test real supported clients. A separate draft [PR #61](https://github.com/GoreeCloud/mesh/pull/61) contains an older 2025-06-18 handshake-oriented fixture; it must be reconciled intentionally rather than merged as a competing default.

Reference specification: [2026-07-28 stateless core](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/basic/index.mdx), [discovery](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/discover.mdx), and [tool results](https://github.com/modelcontextprotocol/modelcontextprotocol/blob/main/docs/specification/2026-07-28/server/tools.mdx).
