# Third-party license review — GoreeCloud Mesh Code Mode fixture

**Scope:** npm production dependencies in `code-mode/package-lock.json`; nonproduction review, November 20, 2026. GoreeCloud's Apache-2.0 repository license does **not** replace any transitive package license. This is not a legal conclusion or a claim of first-party authorship.

CI uses `npm ci --ignore-scripts`, verifies npm-registry URLs and hashes and summarizes installed production licenses. The [isolated job](https://github.com/GoreeCloud/mesh/actions/runs/44747622970/job/136326906446) recorded 192 locked production package entries, 171 installed packages, a 166-component CycloneDX SBOM and zero reported npm production advisories. Recompute on each lockfile update.

## Identified special-license records

| Package | Version | License reported by installed package | Official upstream | Disposition |
| --- | --- | --- | --- | --- |
| `caniuse-lite` | 1.0.30001826 | CC-BY-4.0 | https://github.com/browserslist/caniuse-lite | Attribution and redistribution review open; license: https://github.com/browserslist/caniuse-lite/blob/main/LICENSE |
| `postal-mime` | 2.7.6 | MIT-0 (MIT No Attribution) | https://github.com/postalsys/postal-mime | Permissive license identifier verified; retain upstream provenance |

`caniuse-lite` distributes browser-compatibility data. Appropriate CC BY 4.0 attribution, notices, source URL and indications of changes depend on whether GoreeCloud bundles or redistributes that data. This review does not claim incompatibility with Apache-2.0 or assert that all notice duties are satisfied.

This document is not a complete runtime-bundle license inventory. The machine-readable SBOM is emitted in ephemeral CI and the npm lockfile is maintained in GitHub. Upstream notices and any future vendored dependencies require independent distribution review.

## Before promotion

- Re-run the pinned install, package manifest scan, CycloneDX SBOM and npm advisory audit on the exact reviewed head.
- Verify whether CC-BY-4.0 data is included in the actual Worker bundle; preserve attribution and license text as applicable.
- Examine any new SPDX identifiers, optional platform-specific dependencies and upstream copyright notices individually.
- Never place personal data, secrets or production logs in the SBOM, notices, or CI evidence.
