# Mesh Center website

GoreeCloud Mesh owns the standalone **Mesh Center** public website source in this repository.

## Target address

- Intended public hostname: `https://mesh.goreecloud.com/`
- Cloudflare Pages project name: `goreecloud-mesh`
- Production branch: `main`
- Framework preset: `None`
- Build command: `python scripts/build_public_site.py`
- Build output directory: `dist`
- Root directory: blank

The Cloudflare project, DNS/custom-domain binding, HTTPS verification, and production acceptance remain deployment operations separate from source implementation. A successful source build or preview does not establish public production availability.

## GoreeCloud UI succession — migration required

**Effective October 19, 2026:** GoreeCloud UI (GC UI) is Integral Platform System **5 of 9** and permanently replaces Glaze and Glaze UI as the active GoreeCloud design authority. The Glaze files and build dependencies described below are **legacy source and migration debt**, not currently acceptable GC UI conformance. Mesh's site is **not** asserted to be migrated, production-qualified or redeployed. Do not introduce any new Glaze dependency; first build and validate an independent GC UI replacement with keyboard, contrast, responsive, privacy, asset-integrity, rollback and deployment acceptance, then remove the old active dependencies. Preserve the historical lockfile for provenance until retirement is independently verified.

## Glaze UI baseline

The website is a ground-up consumer of **Glaze UI 2.2.0 Stable**. `website/glaze.lock.json` pins the Stable tag, promotion commit, and each browser CSS Git blob. CI checks out that exact Glaze revision and the build verifies every copied blob before creating `dist/`. Browsers consume only local built assets.

## Source layout

- `website/` — reviewed public source
- `website/assets/goreecloud-mesh-mark.svg` — byte-identical consumer derivative of the approved **Interlace** asset (`5362a52bd9fb38379f083a4d894934ed1acf9b67`)
- `website/glaze.lock.json` — Glaze UI 2.2.0 Stable consumer lock
- `scripts/build_public_site.py` — produces the isolated `dist/` artifact
- `scripts/validate_public_site.py` — validates branding, Glaze provenance, accessibility hooks, security boundaries, public truth, and built-asset integrity
- `scripts/verify_public_deployment.py` — fixed-host production verifier for `mesh.goreecloud.com`; checks HTTPS reachability, reviewed homepage/robots/Interlace/404 bytes, canonical Interlace markers, required security headers, and indexing behavior
- `.github/workflows/validate-website.yml` — exact-revision website acceptance gate; pull requests validate source/build/verifier configuration, while pushes to `main` additionally verify the public custom-domain deployment after source validation

## Production verification contract

Cloudflare Pages deployment status and custom-domain production equivalence are separate evidence gates.

A successful Cloudflare Pages deployment check proves that the configured `goreecloud-mesh` Pages project accepted the corresponding Git revision. It does not by itself prove that `mesh.goreecloud.com` is correctly bound, reachable over HTTPS, or serving the reviewed bytes.

For a push to `main`, the website workflow runs `scripts/verify_public_deployment.py` against the fixed canonical hostname `https://mesh.goreecloud.com/`. The verifier retries briefly to tolerate normal ordering between the Cloudflare deployment check and GitHub Actions. Production verification passes only when the canonical hostname is reachable over HTTPS and the reviewed homepage, `robots.txt`, Interlace mark, and 404 body match the exact repository source, the homepage identifies Interlace and the canonical hostname, required public security headers are present, and production indexing is not disabled.

A successful production verification establishes website publication evidence only for the exact tested revision and public files. It does not establish GoreeCloud Mesh runtime interoperability, authenticated production access, platform-system runtime acceptance, product Stable qualification, or another technical authority claim.

## Public truth boundary

Mesh Center may describe implemented Mesh source capabilities and accepted source/CI evidence. It must not convert source presence, a successful build, a preview deployment, or another system's evidence into production acceptance.

GoreeCloud Mesh remains coordination-only. Identity, Wardveil Security, Privacy Shield, Everkeep, Glaze UI, Gateway, Network, Monitoring, and application-specific authorities retain their documented domains. `authority_transfer=false` remains a substantive platform invariant, not a presentation label.
