# GoreeCloud Mesh

GoreeCloud Mesh is the Integral Platform System for private networking, connectivity, reachability, service discovery, and service communication across GoreeCloud. Mesh establishes and describes approved paths by which GoreeCloud users, devices, applications, infrastructure, networks, and services can reach one another.

**Authority boundary:** GoreeCloud Mesh transports information. **GoreeCloud Sync** is separately governed and owns synchronization and state coordination: change tracking, state replication, delta synchronization, synchronization queues/retries, shared synchronization event contracts, conflict detection/resolution, and cross-device/application state reconciliation. Mesh must not infer synchronization authority merely because information travels through a Mesh path.

Mesh also does not replace GoreeCloud Manager, Privacy Shield, Wardveil Security, Everkeep, Glaze UI, GoreeCloud Identity, GoreeCloud Policy, GoreeCloud Observability, or separately governed systems such as GoreeCloud Sync. Each specialized system retains its own authority.

## Current Development source foundation

The repository predates the current nine-system Integral Platform architecture and the separately governed Mesh/Sync authority split, so it still contains coordination-oriented source surfaces. They are retained as **Development-stage transitional implementation**, not as authority to compete with GoreeCloud Sync, GoreeCloud Policy, or GoreeCloud Manager.

Current source includes:

- **Mesh Registry** — durable records for applications/services, endpoints, capabilities, dependencies, health context, and platform-conformance metadata.
- **Mesh Graph** — explicit service relationships and dependency-impact analysis.
- **Mesh Policy** — transitional fail-closed evaluation of registered relationships and requested capabilities; this source does not make Mesh the GoreeCloud Policy authority.
- **Mesh Events** — bounded in-process publication of Registry/relationship lifecycle events.
- **Mesh Nodes and Connections** — service/node identity, operational state, and explicit versionable relationships.
- **Mesh Platform Catalog and Status** — authority/contract metadata and joined integration status without transferring producer authority into Mesh.
- **Mesh Source Attestations** — durable exact-source provenance kept independent from runtime and Stable acceptance.
- **Mesh Runtime Evidence** — bounded runtime contract evidence bound to canonical repositories, contracts, exact revisions, and observation time.
- **Mesh Evidence Envelopes** — immutable transport records for minimized producer-authoritative evidence with canonical producer/contract/authority validation, freshness, scoped subjects, minimization flags, and optional digest binding.
- **Authenticated Evidence Delivery** — `mesh.evidence.write` plus exact producer-service identity binding for ingestion, and `mesh.evidence.read` for inspection/consumer views.
- **Evidence Subject Views** — producer/authority/assertion-separated consumer models that expose latest/current evidence without manufacturing an overall security, privacy, recovery, continuity, identity, authorization, policy, synchronization, observability, or conformance verdict.
- **Mesh API** — private-first HTTP source surface for discovery, registration, reachability metadata, evidence transport, and the current transitional graph/policy endpoints.
- **Mesh Center** — planned Glaze UI administrative experience; product-level completion is not claimed.

The Registry/Graph/Policy/Event code must be decomposed or reclassified through controlled migrations where its current responsibilities exceed the adopted Mesh connectivity/reachability role. Existing source code is evidence of implementation history, not permission to override the Integral Platform architecture.

## Architecture principles

- Native GoreeCloud implementation from the ground up.
- Private connectivity, reachability, service discovery, and service communication are Mesh responsibilities.
- Synchronization state, replication, reconciliation, and conflict authority belong to separately governed GoreeCloud Sync.
- Shared policy definition, evaluation, decision, distribution, and enforcement coordination belong to GoreeCloud Policy where applicable.
- Platform-wide operational health, telemetry, diagnostics, and operational evidence belong to GoreeCloud Observability where applicable.
- Administration and operational control remain under GoreeCloud Manager where applicable.
- Stable documented contracts are preferred over direct database or filesystem coupling.
- Each participating application remains authoritative for its own domain data and business rules.
- Least privilege and explicit relationships are preferred over ambient trust.
- Privacy-conscious metadata: Mesh records only the connectivity, discovery, relationship, and minimized evidence information needed for its approved role.
- Evidence transport validity never creates or upgrades security, privacy, recovery, continuity, identity, authentication, authorization, policy, synchronization, observability, or design-conformance truth.
- A write scope is insufficient to impersonate another producer: the verified service identity must match the envelope producer.
- Authentication proves the bound producer identity and granted Mesh scope; it does not prove the producer-domain assertion carried by an evidence envelope.
- Expired evidence remains auditable but cannot satisfy current-evidence queries; normal expiry must not prevent restart.
- Applications must degrade safely where possible; Mesh must not become an unnecessary universal failure domain.

## Nine-system Integral Platform authority model

The current GoreeCloud Integral Platform model contains nine systems:

- **GoreeCloud Manager** — administration and operational control.
- **Privacy Shield** — privacy and data-use authority.
- **Wardveil Security** — security, protection, and trust authority.
- **Everkeep** — resilience, preservation, backup/recovery, and continuity authority.
- **Glaze UI** — interface, interaction, and accessibility authority.
- **GoreeCloud Mesh** — private networking, connectivity, reachability, discovery, and service communication authority.
- **GoreeCloud Identity** — identity, authentication, authorization, account/device/session, and delegated-authority system.
- **GoreeCloud Policy** — shared policy-definition, evaluation, decision, distribution, and enforcement-coordination authority.
- **GoreeCloud Observability** — platform-wide operational health, telemetry, diagnostics, performance, and operational-evidence authority.

**GoreeCloud Sync is separately governed and is not a tenth Integral Platform System.** Mesh must provide approved connectivity and transport to Sync without taking synchronization authority.

The repository-root `goreecloud.platform.yaml` is the platform-wide machine-readable declaration for Mesh under **GoreeCloud Platform Contract 0.4**. `docs/platform-conformance.json` remains supplemental Mesh-specific evidence and acceptance detail; it must not compete with or silently weaken the root declaration.

The current manifest deliberately remains `development` and `nonconformant`. Policy and Observability integration are explicitly blocked, and no accepted Mesh-to-Sync runtime reachability/transport integration is claimed yet.

## Evidence plane

The platform evidence-plane contract is `contracts/mesh.platform-evidence-plane.v1.json`. It binds each evidence producer to its canonical repository and producer-owned evidence profile while keeping `authority_transfer` false. Evidence transport through Mesh does not make Mesh authoritative for the producer domain.

GoreeCloud Manager is an administrative consumer/authority relationship rather than an evidence producer in the existing producer contract. GoreeCloud Sync integration must use an explicit bounded contract when implemented; it must not be inferred from generic event or relationship transport. GoreeCloud Policy and GoreeCloud Observability likewise require explicit accepted integrations rather than being inferred from transitional local policy or health/evidence source surfaces.

## Run

```bash
go run ./cmd/mesh \
  -listen 127.0.0.1:8787 \
  -state ./mesh-state.json \
  -source-attestations ./mesh-source-attestations.json \
  -runtime-evidence ./mesh-runtime-evidence.json \
  -evidence-envelopes ./mesh-evidence-envelopes.json \
  -everkeep-recovery-evidence ./mesh-everkeep-recovery-evidence.json
```

The default listen address is loopback-only. Persistent stores are written atomically to separate restrictive-permission JSON files. Passing an empty persistence path disables that store for test or ephemeral operation.

## Evidence API

Authenticated evidence routes include:

- `GET /v1/evidence/envelopes` — requires `mesh.evidence.read`.
- `POST /v1/evidence/envelopes` — requires `mesh.evidence.write` and a producer-matching verified service identity.
- `GET /v1/evidence/envelopes/{id}` — requires `mesh.evidence.read`.
- `GET /v1/evidence/status` — requires `mesh.evidence.read`.
- `GET /v1/evidence/subjects/{kind}/{id}` — requires `mesh.evidence.read` and returns the authority-separated consumer view.

A first accepted envelope returns `201`; an exact immutable replay returns `200` with `replayed: true`.

See [`docs/api.md`](docs/api.md), [`docs/evidence-envelope.md`](docs/evidence-envelope.md), [`docs/evidence-delivery.md`](docs/evidence-delivery.md), and [`docs/architecture.md`](docs/architecture.md).

## Validation

```bash
gofmt -w .
go vet ./...
go test ./...
```

CI runs formatting validation, vetting, tests, build validation, and Platform Contract checks.

## Release boundary

This repository is in **Development**. The current source contains substantial Registry, relationship, policy, event, evidence-registry, authenticated evidence-delivery, producer-bound receipt, consumer-view, and verifier foundations. Some of those source responsibilities predate the current nine-system architecture and separate Mesh/Sync boundary and require controlled migration or reclassification.

The repository does **not** independently establish a deployed GoreeCloud Identity verifier, accepted GoreeCloud Policy or GoreeCloud Observability runtime integration, accepted Mesh-to-Sync runtime integration, production Gateway/Network/TLS routing, multi-node production reachability, target-environment producer delivery, Mesh Center completion, or production/Stable acceptance of the Integral Platform Systems. Source implementation and CI success must not be represented as those runtime outcomes.

## License

AGPL-3.0-only. See [`LICENSE`](LICENSE).
