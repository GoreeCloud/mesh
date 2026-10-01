# Mesh Platform Registry

The Mesh Platform Registry is the normalized read model for GoreeCloud platform declarations and computed conformance evidence. It is an aggregation layer, not a replacement authority.

## Source contract

Each component owns `goreecloud.platform.yaml` in its canonical repository. Repository CI validates that declaration against a pinned immutable revision of the canonical Platform Contract in `GoreeCloud/GoreeCloud` and computes a revision-bound conformance result.

Mesh records a minimized normalized representation using `contracts/mesh.platform-record.v1.schema.json`. Platform Record v1 now consumes the current Platform Contract v0.2 vocabulary. Every record carries:

- the producer repository and exact 40-character producer revision;
- Platform Contract schema `0.2`;
- `authority_transfer: false`;
- the v0.2 component ID, type, version, lifecycle, and supported-platform vocabulary;
- declared capabilities, dependencies, and explicit relationships;
- all seven Platform System results using the exact v0.2 machine states;
- runtime, health, and readiness state where known;
- separate backup and verified-restore state;
- portability state;
- declared and computed conformance state;
- the exact `GoreeCloud/GoreeCloud` evaluator revision and evaluation time;
- Stable eligibility, blockers, and missing-evidence identifiers; and
- bounded evidence references rather than evidence payload duplication.

## Authority boundary

Mesh never upgrades producer truth. A valid transport or registry record does not itself prove that a component is secure, privacy-compliant, recoverable, accessible, healthy, Glaze-conformant, Identity-integrated, or Stable-eligible. Those assertions remain owned by their authoritative producers and acceptance evidence.

The registry rejects records that request authority transfer, whose source repository does not exactly match the component repository, whose source revision is not an exact Git revision, whose Platform Contract vocabulary is not v0.2, whose evaluator provenance is not bound to `GoreeCloud/GoreeCloud`, or that label a non-conformant/unverified record Stable-eligible.

Mesh also rejects unknown Platform System result vocabulary instead of silently accepting display labels or legacy states. This keeps coordination records machine-comparable with the canonical contract without transferring authority to Mesh.

## Recovery semantics

`backup_status` and `restore_status` are separate. Setting a backup to `verified` never modifies restore state. A `verified` restore requires a concrete `last_verified_restore` timestamp, and the timestamp is forbidden when restore state is not verified.

This makes the later Manager Continuity Health question — “If this server disappeared today, could GoreeCloud be restored?” — answerable from restoration evidence rather than backup-job optimism.

## Conformance provenance

The registry preserves both the repository's declared conformance and the canonical evaluator's computed conformance. It also carries the exact evaluator revision and evaluation time. Manager and other consumers may present these facts, but they must not reinterpret a failed, blocked, nonconformant, unverified, or stale result as a stronger state.

A component with lifecycle `stable` is rejected unless the computed result is `conformant` and `stable_eligible` is true.

## Dependency graph

The registry computes dependents only from explicitly declared dependencies and required relationships. It does not infer relationships from naming, network adjacency, UI placement, or shared infrastructure.

## Current implementation boundary

`internal/platformregistry` provides validated in-memory aggregation and dependency-impact queries. The durable authenticated API is developed separately and must preserve this exact producer/evaluator provenance model when records are persisted or exposed. Runtime publication, accepted producer evidence, Manager consumption, and production approval remain independently gated.
