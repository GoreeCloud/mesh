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

## GLAZE UI baseline

The current public presentation target is **GLAZE UI V1.1 / 1.1.0 Stable**. `website/glaze.lock.json` pins release commit `15cc76d2bcd4065552dc31c77145b63f34d9e7b2`, the official `css/glaze-v1.1.0.css` entrypoint, and the complete 13-file Stable browser source graph by canonical Git blob identity. CI checks out that exact Glaze revision, and the build verifies every copied blob before creating `dist/`. Browsers consume only local built assets.

GLAZE UI controls presentation and interaction only. It does not create Mesh interoperability, authorization, evidence validity, production acceptance, or authority over another GoreeCloud system.

## Source layout

- `website/` — reviewed public source
- `website/assets/goreecloud-mesh-mark.svg` — byte-identical consumer derivative of the approved **Interlace** asset (`5362a52bd9fb38379f083a4d894934ed1acf9b67`)
- `website/glaze.lock.json` — immutable GLAZE UI V1.1 Stable consumer lock
- `website/mesh-theme.css` — Mesh product role mapping layered on V1.1 tokens and accessibility fallbacks
- `scripts/build_public_site.py` — produces the isolated `dist/` artifact from reviewed source and the locked Glaze graph
- `scripts/validate_public_site.py` — validates branding, V1.1 provenance, accessibility hooks, security boundaries, public truth, and built-asset integrity
- `scripts/verify_public_deployment.py` — fixed-host production verifier for `mesh.goreecloud.com`
- `.github/workflows/validate-website.yml` — exact-revision website acceptance gate; pull requests validate source/build/verifier configuration, while pushes to `main` additionally verify the public custom-domain deployment after source validation

## Presentation requirements

Mesh Center uses the V1.1 document activation and component contracts, supports System, Light, Dark, and Deep Dark appearance states, preserves a 48 px interaction floor, and maintains explicit reduced-motion, reduced-transparency, increased-contrast, forced-colors, narrow-width, and print behavior. Durable product and authority content remains solid; glaze is reserved for bounded navigation or secondary presentation surfaces.

## Production verification contract

Cloudflare Pages deployment status and custom-domain production equivalence are separate evidence gates. For a push to `main`, the website workflow runs `scripts/verify_public_deployment.py` against the fixed canonical hostname `https://mesh.goreecloud.com/`. Production verification passes only when the canonical hostname is reachable over HTTPS and the reviewed homepage, `robots.txt`, Interlace mark, and 404 body match the exact repository source, required public security headers are present, and production indexing is not disabled.

A successful production verification establishes website publication evidence only for the exact tested revision and public files. It does not establish GoreeCloud Mesh runtime interoperability, authenticated production access, platform-system runtime acceptance, product Stable qualification, or another technical authority claim.

## Public truth boundary

Mesh Center may describe implemented Mesh source capabilities and accepted source/CI evidence. It must not convert source presence, a successful build, a preview deployment, or another system's evidence into production acceptance.

GoreeCloud Mesh remains coordination-only. Identity, Wardveil Security, Privacy Shield, Everkeep, GLAZE UI, Gateway, Network, Monitoring, and application-specific authorities retain their documented domains. `authority_transfer=false` remains a substantive platform invariant, not a presentation label.
