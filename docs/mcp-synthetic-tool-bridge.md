# Mesh synthetic MCP-shaped tool bridge — development fixture

**Status:** In-process read-only experimental adapter, **not** a full MCP server, not deployed, and not verified with ChatGPT, Grok, or any real external MCP client.

This bridge is an intentionally small, dependency-free precursor to the founder-directed universal MCP architecture. It exposes only two status.read **synthetic-local-only** fixtures already owned by Mesh's createSyntheticHarness through MCP-shaped listTools() and callTool() methods. It does not expose network endpoints, stdio transport, resources, prompts, subscription streams, live identities or production GoreeCloud application data.

## Contract

Import createSyntheticMcpToolBridge from examples/synthetic/mcp-tool-bridge.mjs, create an existing fixture harness, and provide a trusted host-side **synchronous** resolveActor(context) callback. The trusted host must authenticate and bind context independently. **Never** use a model argument, unverified agent claim or provider display name as that binding.

listTools() produces deterministic, read-only, namespaced tool descriptors with closed empty input schemas. callTool(toolName, {}, trustedContext) resolves a host-authenticated actor and delegates to existing Mesh policy **and** owner authorization. A missing or invalid actor, extra model arguments, unknown tool, policy refusal or upstream failure produces a generic isError result. Only already validated and bounded synthetic statuses can return a success result that explicitly carries evidence_status: prototype and environment: synthetic-local-only.

## Version and compatibility boundary

The latest published MCP revision examined during design was **2026-07-28**. It introduced a stateless protocol core and server/discover in place of the old initialize exchange. This fixture deliberately does **not** implement that JSON-RPC envelope, transports, negotiated version profiles, authorizations or discovery handshake. Therefore its MCP-shaped tool listing and call results are **not** protocol conformance.

Before a genuine endpoint, add a supported audited MCP SDK or equivalent verified transport, per-request authenticated principal binding, strict protocol/version handling, Identity-backed issuer/tenant/scope checks, consent/approval under GoreeShield, Wardveil controls, quotas, cancellation and deadline coverage, audit minimization, fault injection and end-to-end external client tests. Do not change existing non-MCP Mesh interactions or promote the fixture as production-ready.

## Host registration integrity (synthetic fixture only)

The bridge accepts a bounded own-data snapshot of source `discover` and `read`
callbacks, host `resolveActor`, and the synthetic capability catalog. Accessor-backed,
unexpected, sparse, or malformed registration data is refused without invoking
property getters. Owner read and actor-resolution callbacks are captured once, so
subsequent mutation of the caller's registration objects cannot silently replace
them. Proxy/owner exceptions fail closed. The identity and permission source
remains the trusted host; this is neither a production sandbox nor external MCP
authentication, authorization, or client certification.

## Synchronous synthetic actor resolution

A trusted host must supply a synchronous resolver returning a string actor. If the callback accidentally returns a Promise or thenable, the bridge denies the read without running the owner and consumes eventual rejection so the fixture process is not interrupted by an unhandled rejection. This is a fail-closed local fixture behavior, not authentication or a production identity lifecycle.

## Capability-bound owner result projection

Direct synthetic bridge calls now accept success only when the owner response has exactly the expected inert own-data fields, including the same `capabilityId` requested by Mesh and a canonical UTC ISO observation timestamp. Nested status objects must contain only the bounded `state` and `observed_at` properties; accessor-backed values, proxies that fail inspection, extra fields, mismatched identities, malformed timestamps and oversized status strings fail closed with the fixed generic error. The trusted source harness already produces this exact output shape. This prevents accidental projection of hostile fixture owner objects; it does **not** implement a production transport, authenticated Identity principal, GoreeShield consent, Wardveil deployment control or verified client interoperability.
