# GoreeCloud Mesh — Implemented Features

> **Authority:** Repository-native implemented-feature record.  
> **Boundary:** These are verified Development-stage source foundations described by the repository; they do not transfer Sync, Policy, Manager, Identity, security, privacy, recovery, observability, runtime, production, or lifecycle authority to Mesh.

## Verified Development source foundation

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

