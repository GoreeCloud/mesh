# GoreeCloud Mesh — Stability and Release Gates

| Field | Value |
| --- | --- |
| Status | Proposed engineering acceptance gates, not an implementation claim |
| Checked | 2026-11-06 (targeted privacy/security boundary review) |
| Scope | Mesh interactions with GoreeCloud Identity, GoreeShield, Wardveil, and GoreeCloud UI |

## Verified baseline

`main` contains a platform vision, not a running integration fabric. There is no Mesh runtime, API, connector, or CI implementation in this repository as of this checkpoint. No downstream system should mark a Mesh integration delivered based on this document.

Related maturity varies: GoreeShield has Linux synthetic work in unmerged draft PRs; Wardveil has a development-only event service; GC UI has passing quality gates but incomplete consumer adoption. Their experimental surfaces are **not automatically stable Mesh dependencies**. Identity integration requires a separate trust decision.

## First implementation slice (proposed)

Build one opt-in, **local, read-only** discovery path using two synthetic first-party adapters and a versioned capability manifest. It must require no production accounts, secrets, third-party connections, public listener, or cross-system mutation. A demonstration does not establish a live product integration.

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

1. Approve the discovery manifest and synthetic fixtures, without binding to a production service.
2. Implement the minimal denied/unavailable-state test harness.
3. Validate one real owner contract in nonproduction **after** owner readiness gates pass.
4. Consider write orchestration only after scoped authorization, idempotency, approval, rollback and source-observed outcomes are tested.

This is an engineering safety baseline, not a substitute for authoritative MIPS governance or permission to release.
