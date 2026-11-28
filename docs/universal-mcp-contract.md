# Universal MCP integration contract — development proposal

Status: proposed, nonproduction. Owner: GoreeCloud Mesh. Date: 2026-11-11.

## Decision
Mesh is the shared integration fabric for GoreeCloud applications and the common MCP-facing boundary for compatible AI clients, including ChatGPT and Grok where their supported client features permit. MCP is one protocol within Mesh, not a replacement for native APIs, events, or service ownership.

## Capability envelope (version 1)
Every registered capability declares: stable namespaced identifier, semantic version, owning service, kind (tool/resource/prompt), JSON input/output schemas where applicable, read/write classification, required scopes, tenant boundary, consent classification, timeout and output limits, and availability state. Unknown fields, unsupported versions, duplicate identifiers, or unregistered capabilities are rejected. No dynamic code evaluation.

## Invocation invariants
1. Deny by default. Identity verifies actor, audience, tenant, scope and expiry; Mesh independently authorizes the capability; the owning service independently enforces its own permissions.
2. GoreeShield decides permitted disclosure, consent, minimization and retention; Wardveil supplies threat controls, anomaly detection and abuse response. Neither substitutes for Identity.
3. External AI agents never receive upstream service credentials. Credentials are scoped, isolated, rotated and redacted.
4. Separate discovery from invocation. Discovery only returns capabilities authorized for the actor and tenant; authorization is checked again at execution.
5. Treat tool names, descriptions, arguments, outputs and remote MCP servers as untrusted. Validate schemas, cap payloads and concurrency, prohibit unrestricted network egress, and block prompt-injection-driven privilege escalation.
6. Mutating/destructive operations require explicit action-specific authorization and, where policy demands, human approval. Idempotency keys and audit correlation are required for retriable writes.
7. Use protocol-conformant MCP transports and version negotiation; never assume all clients support the same transport, auth, prompts or resources.
8. Record privacy-minimized structured outcomes without secrets, raw tokens or sensitive arguments. Bound timeouts and cancellation, prevent unbounded retries, and fail closed on policy or owner outages.
9. Keep each owning service authoritative for its data and operations. Mesh must not become a universal superuser or mandatory hop for unrelated internal traffic.

## Reference acceptance criteria
- Anonymous, expired, wrong-tenant, wrong-audience and missing-scope calls are denied.
- Enumeration never reveals unauthorized tools, resources or prompts.
- Invalid schema, oversized input/output, duplicate IDs and unsupported protocol versions fail safely.
- Client disconnect, owner timeout, token rotation, policy outage and service restart have bounded outcomes.
- Read-only tools cannot mutate owner state; write operations require policy and approvals.
- Cross-client compatibility is demonstrated separately for each actual client and supported transport.
- Tests exercise a real protocol boundary with disposable credentials and isolated fixtures; synthetic tests alone do not establish production readiness.

## Rollout
Inventory existing Mesh, Identity, Wardveil and GoreeShield contracts; implement registry and policy checks behind a disabled-by-default feature flag; add one read-only owner adapter; test MCP clients; expand only after signed release, privacy and network isolation gates. No deployment is authorized by this document.
