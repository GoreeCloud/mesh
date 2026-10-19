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

## Release and cutover gates

The available GC UI `foundations-v1.0.1` release is **scoped** to semantic tokens, color utilities and browser theme control; this candidate's local CSS is **not** a claim of package installation, product-level conformance, or a stable GC UI component catalog. In future work, prove the supported design contract and exact release/artifact provenance rather than mass-renaming predecessor variables.

**Still required before any website cutover:** extend the passing basic Chromium/Firefox smoke tests to a documented **200–400% effective-zoom/reflow and screen-reader assessment**, color-pair contrast audits, actual HTTP response CSP/HSTS/cache validation, an approved first-party visual mark, release/license and supported GC UI foundations provenance, strictly bounded dependency/runtime audit, reproducible release and rollback, deployed-domain validation, and separately accepted product and GC UI Contract 2.1 status. Existing browser smoke coverage is useful evidence, but is not full accessibility or deployment qualification. The historical Mesh website currently cannot rebuild because its Glaze checkout source has disappeared; do not restore Glaze or weaken that CI as a workaround.

Tracking: [Mesh issue #54](https://github.com/GoreeCloud/mesh/issues/54), [GC UI cutover issue #13](https://github.com/GoreeCloud/gc-ui/issues/13).

**Explicit boundaries:** `deployed=false`, `gcUiRuntimeAccepted=false`, `legacyWebsiteCutover=false`, `platformMigrationComplete=false`.
