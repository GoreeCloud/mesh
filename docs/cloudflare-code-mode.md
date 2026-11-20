# Cloudflare Code Mode in GoreeCloud Mesh — opt-in prototype

**Status:** Reviewable, nonproduction source implementation, **not** a deployed or production-authorized Mesh service. No Cloudflare account change, API key enrollment, external provider read, live DNS/Gateway/VPN administration, or automation is included.

## Ownership and intent

GoreeCloud Mesh owns the reusable AI tool orchestration interface. GoreeCloud Identity owns authentication and delegated authorization; GoreeShield owns privacy, consent, minimization and retention; Wardveil owns cybersecurity enforcement and incident response; GoreeCloud UI owns any future user-facing controls. A Code Mode sandbox does not replace any of these authorities.

Cloudflare's open-source [Code Mode SDK](https://github.com/cloudflare/agents/tree/main/packages/codemode) runs AI-authored JavaScript in an isolated Dynamic Worker. The MCP facade uses [Cloudflare's documented OpenAPI search/execute implementation](https://developers.cloudflare.com/agents/model-context-protocol/guides/build-codemode-mcp-server/). Generated code can discover a small embedded OpenAPI catalog and make host-mediated requests; it is not given an API credential, filesystem mounts, or mutable owner operations. `DynamicWorkerExecutor` uses `globalOutbound: null` so direct sandbox `fetch()` and `connect()` are blocked; deployed runtime behavior still needs acceptance testing.

## Implemented source boundaries

- `code-mode/src/worker.mjs`: `/mcp` entrypoint; rejects requests if the Worker Loader binding or secret is missing, validates a bearer before constructing the MCP service, invokes `openApiMcpServer` and `DynamicWorkerExecutor`, disables caching and suppresses error internals.
- `code-mode/src/spec.mjs`: explicit OpenAPI 3 read-only synthetic operations; exposes no model-supplied target URLs or live APIs.
- `code-mode/src/policy.mjs`: host-owned, exact GET/path allowlist; rejects writes, query parameters, arbitrary payloads, unknown names, hostile getters and off-scope paths. Limits each MCP execution to eight host operations. Outputs fixed bounded synthetic records; it never reports unmeasured services as healthy.
- The only capability descriptors come from Mesh's existing `examples/synthetic/manifest.v1.json`; they are tagged `prototype` and `synthetic-local-only`.
- Node unit tests and the opt-in Worker dry-run CI verify source policy and packaging. Disposable GitHub Actions local `wrangler dev --local` integration checks exercise the authentic MCP handshake, tool listing, `search`, `execute`, write refusal and limited synthetic reads without exposing a public server. Miniflare is not hardened and the test uses only reviewed, fixed JavaScript strings.
- `code-mode/src/admission.mjs` rejects browser origins, unknown methods, unbounded request bodies and malformed JSON; limits local concurrent requests (per isolate) and sandbox execution to 15 seconds. These are **not** global rate limits, distributed admission, or output-stream quotas.
- `workers_dev=false` and no configured routes avoid an accidental public ingress. The code does not require or create a Cloudflare account.

This **is a Code Mode MCP application implementation**, not a fully integrated external-client compatibility certificate. Source code does not establish a usable deployed endpoint. The static bearer only protects the fixture; it is not tenant-aware GoreeCloud Identity, OAuth, revocation, or durable per-operation human approval. Repeated separate MCP invocations do not share a global quota. Cloudflare's loader isolation still requires platform verification and threat modeling.

## How to validate without deployment

```sh
node --test code-mode/test/*.test.mjs
cd code-mode
npm ci --ignore-scripts --no-audit --no-fund
npm run build
node test/local-smoke.mjs # runs only reviewed synthetic code in local workerd
```

The audited `code-mode/package-lock.json` was generated in isolated GitHub CI (281 package records, npm-registry downloads with integrity hashes). CI uses `npm ci --ignore-scripts` and runs `npm audit --omit=dev --audit-level=high`; its first audited build reported zero production vulnerabilities. Audits are point-in-time observations, not guarantees. The build dry-run does not authenticate to or deploy on Cloudflare. Local smoke starts only a disposable loopback `workerd` with a random `.dev.vars` fixture credential and removes it afterward.

## Controlled staging (requires separate security acceptance)

1. Re-review the SDK, pinned package integrity, transitive dependency tree and licenses, advisories, build output, Cloudflare Worker Loader availability, and protocol compatibility at promotion; keep the committed lockfile current and install via `npm ci`.
2. Configure an isolated Cloudflare test account and a Worker route **only after** reviewing exposure and allowable data transfers. Keep `workers_dev=false` unless an explicitly approved private staging URL and access policy are in place.
3. Store a random 32–128 character base64url-style token as `MESH_CODEMODE_BEARER` using Wrangler secrets. Never put it in source, example configuration, query strings, logs or model context.
4. Make a controlled `/mcp` connection with `Authorization: Bearer <token>`; reverify `search` and `execute`, network egress denial, wrong-token/expired-client rejection, budget exhaustion, closed paths and writes, protocol negotiation, cancellation and streaming behavior in hosted staging. Local workerd tests are evidence for local behavior, **not** equivalent to remote Cloudflare Worker Loader or independent client acceptance.
5. Before any **real** connector, require source-owned owner API authorization, Identity audience/tenant/scope checks and revocation, applicable GoreeShield decisions, Wardveil network/worker containment review, HTTPS/workload attestation, quotas beyond one request, independent recovery and explicit release approval. Never copy an owner's bearer into code-visible spec or outputs.
6. Keep the existing Mesh source-pinned CI/branch-protection gates intact. Do not merge through failing required DNS, VPN, Identity, Calendar or other checks.

## Explicitly unsupported

Production traffic; live Cloudflare/DNS/Gateway/VPN edits; arbitrary host-side `fetch`; personal data retrieval; generic arbitrary-URL calls; durable approval workflow; service-to-service authentication; revocation; rate-limiting across requests; live device deployment; vendor independence of the **execution** backend; portable self-hosted sandbox parity.

Cloudflare Code Mode is an optional adapter behind Mesh, not an ecosystem-wide runtime mandate. The Node synthetic integration harness and owner service contracts remain intact. Reassess an independent sandboxed executor only after evaluating isolation, licensing, operations and portability.
