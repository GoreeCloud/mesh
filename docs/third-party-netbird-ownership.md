# Ownership boundary — NetBird vs GoreeCloud VPN

**NetBird** and **GoreeCloud VPN** are different software products. Do not use their names, source trees, deployments, identities, release gates or completion claims interchangeably.

| System | Nature | Source of truth | Operational status |
| --- | --- | --- | --- |
| NetBird | Third-party, open-source self-hosted VPN | Official upstream NetBird project for product code; GoreeCloud/mesh for our *integration and operator tooling*; VPS Mesh for the live installation | Fresh NetBird control plane, Caddy ingress, two peers, private AdGuard DNS and API operations verified |
| GoreeCloud VPN | Founder-directed **first-party** GoreeCloud native VPN product | **GoreeCloud/VPN** repository; separate product requirements and roadmap | Product implementation/release must be evaluated independently. Running NetBird does **not** make GoreeCloud VPN built, delivered, or deployed |
| GoreeCloud Mesh | First-party interoperability and automation fabric | **GoreeCloud/mesh** repository | Owns the reviewed GoreeCloud-managed *integration surface* to third-party NetBird, not NetBird itself |

## What belongs in this repository

- `tools/netbird-cli/`: GoreeCloud-authored adapter `gc-netbird` for controlled NetBird REST reads/writes via the authorized Remote Desktop Commander VPS connection. Neither a NetBird fork nor a GoreeCloud VPN client.
- `deploy/netbird/`: Reviewed, **non-secret** Docker Compose, Caddy configuration examples, fresh bootstrap helper and recovery runbook for the *third-party* NetBird installation. The live credentials and protected NetBird state remain private on VPS Mesh and must never be committed.
- `.github/workflows/netbird-*-contracts.yml`: Safety and compatibility checks for these third-party integration assets, **not** evidence of first-party GoreeCloud VPN product completion.

The operational NetBird deployment uses its own container names and VPS private directory `~/goreecloud-netbird-fresh/`. The GoreeCloud VPN product must have its own architectures, clients, code, identity integration, security validation and deployments. It may eventually interoperate with NetBird if the founder explicitly chooses, but no dependency or equivalence is implied.

## Correction applied

Earlier draft work in [GoreeCloud/VPN PR #3](https://github.com/GoreeCloud/VPN/pull/3) incorrectly stored NetBird operations and framed them as GoreeCloud VPN source. This clean Mesh branch relocates the 21 reviewed non-secret operational files and creates a separate draft review. The original VPN branch/PR remains auditable historically; closing the PR does not rewrite or erase public Git history. Do **not** merge that VPN draft to introduce third-party NetBird operational code into the first-party product repository.

No live NetBird containers, peer policies, DNS records, accounts, tokens or AdGuard/Caddy infrastructure are changed by moving source-control records.

## Governance and credentials

Google Drive `GoreeCloud/CLI Commands/Third-Party/` is the canonical third-party NetBird command record, with host-specific operational notes in `GoreeCloud/CLI Commands/Hosts/`. Those records should point to this Mesh integration source, not to the first-party `GoreeCloud/VPN` application. Source ownership and runtime evidence are separate. Do not put the NetBird PAT, peer setup key, database encryption material, private CA keys, or private API exports in public Git.

**Verification levels:** source staged, reviewed, syntax-tested, integration-tested, committed, merged, deployed, live-authenticated and end-to-end verified are distinct. The deployed NetBird instance's operational readiness must not be used to assert any GoreeCloud VPN release progress.

## Related source

- [NetBird third-party deployment runbook](../deploy/netbird/README.md)
- [NetBird operator CLI](../tools/netbird-cli/README.md)
- [GoreeCloud VPN first-party repository](https://github.com/GoreeCloud/VPN)
- [GoreeCloud Mesh](https://github.com/GoreeCloud/mesh)
