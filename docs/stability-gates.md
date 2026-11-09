# GoreeCloud Mesh — Stability and Release Gates

| Field | Value |
| --- | --- |
| Status | Verified local development baseline plus proposed real-integration acceptance gates; no production claim |
| Checked | 2026-11-09 (Mesh source and CI readback; Wardveil health contract inspected) |
| Scope | Mesh interactions with GoreeCloud Identity, GoreeShield, Wardveil, and GoreeCloud UI |

## Verified baseline

`main` contains the platform vision, a dependency-free, nonproduction synthetic Node.js discovery/status harness with two fictional adapters and tests, an opt-in bounded in-memory `mesh.synthetic-evidence.v1` outcome observer, native in-flight admission, a transport-injected Wardveil health acceptance fixture with disposable real-loopback HTTP tests, and GitHub Actions fixture and first-party Wardveil Go source-owned runtime workflows. There is no deployed Mesh integration fabric, production API, real connector, or authorized cross-system exchange. No downstream system should mark a Mesh integration delivered based on this document.

Related maturity varies: GoreeShield has Linux synthetic work in unmerged draft PRs; Wardveil has a development-only event service; GC UI has passing quality gates but incomplete consumer adoption. Their experimental surfaces are **not automatically stable Mesh dependencies**. Identity integration requires a separate trust decision.

## Verified source-owned Go development acceptance (2026-11-09)

- [PR #21](https://github.com/GoreeCloud/mesh/pull/21) added a separate hosted Linux CI job that checks out the inspected `GoreeCloud/wardveil` Go source at immutable commit `41ff4766719e87a3f5399359d0e721cce5df9493`, validates selected Git blobs and absence of third-party Go modules, then builds it with offline module access. Official GitHub setup/checkout actions are SHA-pinned; no persisted checkout credentials.
- That job launches the **actual Go service** with random disposable credentials, a private temporary journal and a restricted `127.0.0.1` port. It validates health through the Mesh read-only fixture, deny-before-I/O, local revocation, unauthenticated direct event-list refusal, stop/unavailable and graceful restart. Separately, Wardveil's genuine Go handler test checks the **503** path after simulated journal failure; a process-level 503 test is **not** claimed.
- [PR #22](https://github.com/GoreeCloud/mesh/pull/22) hardened loopback response metadata: duplicate `Content-Type` and headers over 2 KiB now fail closed.
- [PR #23](https://github.com/GoreeCloud/mesh/pull/23) verified the opt-in diagnostic observer against the real Go process: strict success/denial/outage/recovery outcomes, bounded two-record retention, erasure, and no test tokens or actor identifiers in stored evidence.
- At merged `main` `a4e3ffb33a79bc526d420c38b3c96877f7c9834b`, **all three post-merge CI checks passed** (Node 24 fixture, Wardveil Go contract, nonblocking editorial). This is stronger *nonproduction source compatibility evidence*, **not** production authorization, consent, uptime, a deployed connector, TLS, a signed health attestation, or a stable owner API contract.

Unimplemented: owner-approved semantic API version, secure process/port identity, independently authenticated source-owned read authorization, tenant claims and real revocation through Identity, GoreeShield purpose/retention, Wardveil threat-policy governance, tested crash recovery and durability under fault, secure secret lifecycle, and operating/deployment controls.

## Opt-in Wardveil source-authenticated status v1 milestone (2026-11-09)

- **Wardveil source:** [PR #26](https://github.com/GoreeCloud/wardveil/pull/26) merged at `a79624bbe0846ca37192fc3dd9386901a9e57088`; Go static analysis, formatter, race-tested unit suite and post-merge checks succeeded. Only with a third, distinct 32–1024-byte development token configured, the Go service registers **GET /v1/status**. Versioned status response includes exactly `schema_version`, journal `state` and source-observed UTC `observed_at`. Existing event-read/ingest bearers are rejected; the status bearer cannot read or ingest events. Status route absent/404 by default.
- **Mesh consumer:** [PR #26](https://github.com/GoreeCloud/mesh/pull/26) merged at `eabb9412f7941559f10ece8f1ed482bc905b7113`. The pinned isolated Go CI checks source blobs, offline dependency-free build, true Go HTTP authorization refusals, Mesh strict response shape and freshness, token scope, source-side old-token refusal after restart, outage/recovery and no-event read. It retains legacy /healthz and synthetic outcome checks. **All three post-merge Mesh checks passed** (Node24 fixtures, genuine Wardveil Go status contract, editorial). No external host, VPS, user data, production secret, DNS, proxy or physical device was touched.
- **Security boundary:** The new source credential is a distinct static **development token**, not trusted GoreeCloud Identity subject/tenant attribution, tenant-scoped policy, live revocation, short-lived credential issuance, mTLS, TLS server identity or a signed status assertion. Local Mesh/adapter permit callbacks are additional fixture gates and do not substitute for source-owned permission enforcement. A 200/503 status reflects only journal writability; it is not evidence of full cybersecurity posture.

Unverified promotion gates remain: process/port identity and race-free destination ownership, secure network boundaries and workload identity, privacy-purpose/consent/minimization and retention decisions from GoreeShield where applicable, Wardveil security review, independently authorized source/tenant scopes through Identity, live revocation/key lifecycle, continuous authorization, outage/disaster recovery and audit integrity, documented compatibility upgrades, backup/rollback and explicit owner release approval. Do not use the event-read token for status access.

## Verified Identity authorization and subprocess development gates (2026-11-09)

- **Actual Identity source verifier:** [Mesh PR #36](https://github.com/GoreeCloud/mesh/pull/36) merged at `07748c22ebb3c038762badd8948577f541f22c9b`. A separate, pinned, read-only CI workflow tests GoreeCloud Identity's original Python `ResourceAuthorizer` at immutable commit `703cb1b55f29e849d90f3281bb582cf33ee78804`, after checking the key source blobs and declared PyJWT requirement. Disposable RSA access tokens prove that wrong signed tenant, issuer, audience, OAuth client, scope, role, expiration and token type are denied before the synthetic Mesh owner read. An explicit Identity allow cannot override independent Mesh/owner policy denial. Four exact-head and post-merge jobs passed. The fixture supplies its own test JWKS and does **not** authenticate a real Wardveil Go user's request, implement session revocation, securely pin a production issuer, or establish an authorized tenant-owned status API.
- **Native in-process backpressure:** [PR #31](https://github.com/GoreeCloud/mesh/pull/31) now retains a synthetic owner admission slot until the actual owner promise settles, even after the caller's timeout, preventing unbounded repeated work. An owner that never settles can still saturate the coordinator indefinitely.
- **Source status hardening and process recovery:** [PR #32](https://github.com/GoreeCloud/mesh/pull/32) requires Wardveil's uncacheable/nosniff response metadata and bounded bearer length. [PR #33](https://github.com/GoreeCloud/mesh/pull/33) verifies the *disposable*, source-pinned Wardveil Go child reopens a private empty journal after abrupt termination, not preservation of events, crash consistency, backup/restore or production disaster recovery.
- **Hard-kill fixture only:** [PR #38](https://github.com/GoreeCloud/mesh/pull/38) adds a fixed-code, sanitized-environment Node subprocess read, 1–4 worker admission, exact size-limited status output, 20–1000 ms hard deadlines, SIGKILL and leases retained until child close. It tests never-resolving, late, crashed and overlarge-output children without connecting any actual owner. **Not a secure sandbox**: the child retains the CI runner's OS account, filesystem and networking rights. [Issue #34](https://github.com/GoreeCloud/mesh/issues/34) remains open for secure per-owner isolation, hardened OS/network permissions, verified worker restart budgets and operations.
- **Cross-product release status:** Passing source-authentication and child-kill fixtures are *nonproduction contract evidence*. Production still requires Keycloak/Identity trusted issuer and tenant/resource ownership, real Wardveil user authorization independent of the static development status bearer, GoreeShield privacy classification and retention, workload/TLS trust and host ownership, live revocation, secrets lifecycle and comprehensive failure/rollback tests.

## First implementation slice (reference fixture; not production)

The existing reference fixture provides a **local, read-only** discovery path using two fictional adapters and a versioned capability manifest. It uses no production accounts, secrets, third-party connections, public listener, or cross-system mutation. A demonstration does not establish a live product integration. The descriptor, proxy, denial, native-concurrency, response-shape and redacted-outcome negative regressions are implemented and exercised in the fixture CI. This does not promote any real service.

Acceptance tests for the first slice must cover:

1. Capability discovery with declared owner, version, operation, sensitivity class and evidence status.
2. Default-deny authorization at Mesh **and** the owning system. Discovery is never permission.
3. Bounded timeout, response size, cancellation and retry budgets; no unbounded fan-out.
4. Typed `unsupported`, `denied`, `unavailable`, `timed_out` and `invalid_response` errors; no error-to-success conversion.
5. Correlation IDs with redacted operational evidence; no raw personal payload in central logs by default.
6. Stale manifests, duplicate deliveries, unreachable owners, malicious responses and denied-action regressions.

No live data export, automatic writes, production MCP tools, webhook ingress or SSH control is authorized by this proposed slice.

## Ownership and promotion matrix

| Boundary | Owner remains authoritative for | Required Mesh evidence |
| --- | --- | --- |
| Identity | Authentication, subjects, delegated grants and revocation | Verified identities and scoped authorization; fixtures cannot authorize real actions |
| GoreeShield | Consent, privacy purpose and source-observed handling | Accepted versioned contract and fail-closed withdrawal tests |
| Wardveil | Security events, scan verdicts and response policy | Authenticated provenance, bounded events and explicit response approval |
| GoreeCloud UI | Design, accessible components and user surfaces | Actual packaged consumption and device/accessibility acceptance |
| Mesh | Routing, inventory, execution and diagnostics | Denial, isolation, replay, outage, recovery and upgrade tests |

The owning service must independently enforce protected actions. A capability becoming *discoverable* does not make it *authorized* or *healthy*. Distinguish `planned`, `prototype`, `verified`, `blocked`, and `retired`; only evidence-backed capabilities may report `verified`.

## Cross-pillar privacy and cybersecurity acceptance cases (proposed)

GoreeShield governs **privacy** decisions and personal-data handling; Wardveil governs **cybersecurity** detection, defense and response. Mesh is the integration transport/coordinator, not a substitute consent authority, security enforcement engine, or universal policy override. These are **proposed tests for future real connectors**; the current synthetic discovery harness has no live privacy integration.

For a Mesh flow that requires a privacy choice, consent, or other applicable GoreeShield decision, acceptance evidence must show that:

1. A missing, withdrawn, expired, invalid, wrong-subject, wrong-purpose, or unsupported-version privacy decision never authorizes that optional processing or disclosure. A response timeout or unavailable GoreeShield interface does not silently become an approval.
2. Required decisions are evaluated against the actual data subject, purpose, recipient and relevant processing action, using an approved contract. A synthetic fixture or cached success cannot be treated as live authorization.
3. Both Mesh and the **owning source service** deny an inapplicable or unauthorized data transfer. No personal payload crosses a boundary before the owner confirms applicable policy. Replays, retries and asynchronous callbacks cannot resurrect revoked choices.
4. Privacy denial is not logged as a security threat by default. Wardveil may receive only authorized, minimized security-relevant telemetry; routine consent, private content or identity data is not automatically shared with it.
5. Evidence records distinguish an attempted request, a locally allowed decision, a source-observed outcome and a confirmed completed action. A transport acknowledgment or connector success never proves an external deletion, withdrawal or data-rights fulfillment.
6. Essential functions that do **not** require optional consent are not indiscriminately disabled: document the lawful/authorized processing basis and the scoped policy boundary for each operation. Do not fabricate a consent requirement or treat transient GoreeShield outages as permission to export data.

Before promotion, validate these cases with negative tests, contract version checks, outage/recovery tests, purpose-bound state changes, and minimal audit evidence. No implementation or end-to-end result is asserted here.

## Release gates

Each actual integration requires dated evidence and a five-MIPS applicability disposition:

- **Contract:** exact source commit, owner, consumer, version, schemas, operation, error semantics and trust boundary.
- **Permission:** negative authorization tests, scoped identity, privacy choice where required, revocation and secret lifecycle.
- **Resilience:** outage, duplicate, loop, retry, restart and bounded recovery tests.
- **Privacy/security:** minimized data, no unapproved export, no unreviewed unsafe action and owner-side enforcement.
- **Operations:** truthful health, diagnostics, rollback, alert ownership and incident escalation.
- **UI:** GC UI adoption and accessibility tests when a user-facing control exists.
- **Release:** owner decision with linked artifacts. Failure or unknown blocks promotion; unrelated green CI does not waive it.

## Ordered follow-up

1. **Development-only verified:** #8, #11, #15–#18 established the synthetic baseline; #21 verified the actual inspected Wardveil Go service on disposable loopback; #22 hardened HTTP response metadata; #23 verified redacted evidence against the real Go runtime. Three post-merge checks passed at the documented current head. A working Go development service is not a production source-authorization grant, identity integration or signed Stable release.
2. Define and review the separate **real integration** correlation-ID, privacy classification, retention, trace propagation and audit-evidence contract with owning systems. Require source-observed outcomes and ensure optional consent and sensitive payloads never enter Mesh logs by default.
3. **Development status-only contract verified:** Wardveil and Mesh #26 now exercise an opt-in versioned source-owned static bearer scope in isolated CI. Next establish production-grade **Identity-bound, source-owned and tenant-scoped** authorization, cryptographic/host trust, GoreeShield purpose/consent/retention and Wardveil security boundaries; validate revocation, rollout/rollback and disaster recovery before any non-test endpoint. Neither the new static token nor local permit callbacks constitute production access control.
4. Consider write orchestration only after scoped authorization, idempotency, approval, rollback and source-observed outcomes are tested.

This is an engineering safety baseline, not a substitute for authoritative MIPS governance or permission to release.
