# Mesh GC UI website — isolated development candidate

**Status:** Independently buildable source-and-browser preview, verified on main October 19, 2026. **Not deployed**, **not accepted as a production GC UI application**, and **not a replacement for the public site**.

GC UI is Integral Platform System **5 of the existing nine**. The candidate under `gc-ui-site/` is independently authored with local HTML, CSS and JavaScript and no active Glaze stylesheet, runtime or GitHub checkout. It preserves Mesh's `authority_transfer = false` boundary, Registry/Graph/Policy/Events model, truthful production-gate warnings, skip navigation, keyboard-friendly native controls, and three-way appearance preference. It deliberately avoids reusing the historical emblem because its embedded description attributes the design to Glaze.

## Local validation (no external dependencies)

From the repository root:

```sh
python3 scripts/validate_gc_ui_candidate.py
python3 -m unittest discover -s tests -p test_gc_ui_candidate.py -v
node --check gc-ui-site/site.js
python3 scripts/build_gc_ui_candidate.py
python3 scripts/validate_gc_ui_candidate.py --dist
```

The builder copies the reviewed source to `dist-gc-ui-candidate/` **only**, creates a SHA-256 manifest with acceptance and deployment flags set false, and never modifies historical `website/`, `dist/` or their CI. The [isolated CI](../.github/workflows/validate-gc-ui-candidate.yml) validates an exact revision, checks source and built integrity, runs negative tests, and publishes a short-retention preview artifact. Independent [Chromium and Firefox smoke CI](../.github/workflows/gc-ui-preview-browser.yml) checks localhost-only focus/skip link, theme control, narrow reflow, reduced motion, forced colors and homepage/404 interactions. Both workflows have **no deployment job**. On merged main commit `5e8ac201dea110ef32a1eaeb4d7a7f26310ba783`, all three exact-commit checks passed (repository validate, GC UI candidate validate, GC UI browser smoke).

## Local HTTP behavior checks (not CDN verification)

The new `scripts/test_gc_ui_http.py` builds on the candidate's existing offline artifact and performs **real localhost GET/HEAD HTTP requests** to a restricted allowlist-only test server. The test server applies a **strict, fail-closed interpretation of the checked-in `gc-ui-site/_headers` policy**. Tests assert 200 homepage and asset bytes, an actual 404 HTTP status with the reviewed 404 page, noindex/CSP/HSTS *header values*, short static-cache policy, nonpublication of `_headers` and SHA256 manifest as public assets, and negative-policy regressions. The exact PR revision runs this check in [isolated candidate CI](../.github/workflows/validate-gc-ui-candidate.yml).

```sh
python3 scripts/build_gc_ui_candidate.py
python3 scripts/test_gc_ui_http.py
```

**Scope warning:** This is a **simulated hosting-policy application** at 127.0.0.1, not verification that any real CDN correctly interprets `_headers`, nor actual HTTPS/TLS/HSTS enforcement, DNS, public 404 routing, cache behavior, security review or deployment acceptance. Those require a separately authorized staging and production test using the real hosting service.

## Scoped GC UI Foundations 1.0.1 source integration

The preview now includes **the exact generated GC UI Foundations CSS source blob** from the reviewed [GoreeCloud/gc-ui commit `7e0b61ee70af2edb87aa736cca483425f0aacaf4`](https://github.com/GoreeCloud/gc-ui/tree/7e0b61ee70af2edb87aa736cca483425f0aacaf4), source file `styles/gc.v1.generated.css`, Git blob `c0e32a40f0bba280c9a4e9e01f31e1114d60f26c`. The [published Foundations 1.0.1 GitHub archive](https://github.com/GoreeCloud/gc-ui/releases/tag/foundations-v1.0.1) identifies the same source commit and has recorded SHA-256 `275d7e6dc9503b2e74b3190bcecf176d73d2345860e8a20fa5faa3b326cd2298`.

`gc-ui-site/gc-ui-foundations.css` is copied unchanged into the offline output as `assets/gc-ui-foundations.css`. Both homepage and 404 load it *before* local `site.css`. The preview now consumes exact stable Foundations **touch target**, **UI font family**, and **focus outline width** variables while retaining separately authored product color roles. The validator checks the exact Git blob object identity at source and built-output time; tests reject unreviewed token changes and verify the stylesheet is served locally.

**Evidence boundary:** The copied source CSS Git-blob identity is verified against the reviewed release source, and the official tarball SHA-256 is recorded from GitHub. This checkout has **not independently unpacked and compared** the public tarball's CSS bytes; **no claim of npm registry installation, full GC UI component-library adoption, production UX conformity, or accepted visual identity is made**. Owner-approved component contracts and broader app conformance still require separate validation.

## Release and cutover gates

The GC UI `foundations-v1.0.1` stable release covers semantic tokens, color utilities and browser theme control. This candidate **now consumes a pinned copy of its released-source semantic stylesheet**, but this is still **not** a verified package installation, product-level conformance, or a stable GC UI component catalog. In future work, prove the supported design contract and exact release/artifact provenance rather than mass-renaming predecessor variables.

**Still required before any website cutover:** extend the passing basic Chromium/Firefox smoke tests to a documented **200–400% effective-zoom/reflow and screen-reader assessment**, color-pair contrast audits, actual HTTP response CSP/HSTS/cache validation, an approved first-party visual mark, release/license and supported GC UI foundations provenance, strictly bounded dependency/runtime audit, reproducible release and rollback, deployed-domain validation, and separately accepted product and GC UI Contract 2.1 status. Existing browser smoke coverage is useful evidence, but is not full accessibility or deployment qualification. The historical Mesh website currently cannot rebuild because its Glaze checkout source has disappeared; do not restore Glaze or weaken that CI as a workaround.

Tracking: [Mesh issue #54](https://github.com/GoreeCloud/mesh/issues/54), [GC UI cutover issue #13](https://github.com/GoreeCloud/gc-ui/issues/13).

**Explicit boundaries:** `deployed=false`, `gcUiRuntimeAccepted=false`, `legacyWebsiteCutover=false`, `platformMigrationComplete=false`.
