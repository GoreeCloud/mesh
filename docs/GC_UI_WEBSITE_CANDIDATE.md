# Mesh GC UI website — isolated development candidate

**Status:** Source-only preview, created October 19, 2026. Not deployed, not accepted as a GC UI application, and not a public-site replacement.

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

The builder copies the reviewed source to `dist-gc-ui-candidate/` **only**, creates a SHA-256 manifest with acceptance and deployment flags set false, and never modifies historical `website/`, `dist/` or their CI. The new [isolated CI](../.github/workflows/validate-gc-ui-candidate.yml) validates an exact revision, checks source and built integrity, runs negative tests, and publishes a short-retention preview artifact. It contains no deployment job.

## Release and cutover gates

The available GC UI `foundations-v1.0.1` release is **scoped** to semantic tokens, color utilities and browser theme control; this candidate's local CSS is **not** a claim of package installation, product-level conformance, or a stable GC UI component catalog. In future work, prove the supported design contract and exact release/artifact provenance rather than mass-renaming predecessor variables.

**Still required before any website cutover:** real Chromium/Firefox keyboard/focus and responsive tests (including 200–400% zoom), contrast and forced-colors/reduced-motion assessment, screen-reader review, an approved first-party visual mark, license and CSP/privacy validation under an actual HTTP server, strict source/runtime dependency audit, reproducible release and rollback, deployed domain and security header verification, separately approved product and GC UI Contract 2.1 status. The historical Mesh website currently cannot rebuild because its Glaze checkout source has disappeared; do not restore Glaze or weaken that CI as a workaround.

Tracking: [Mesh issue #54](https://github.com/GoreeCloud/mesh/issues/54), [GC UI cutover issue #13](https://github.com/GoreeCloud/gc-ui/issues/13).

**Explicit boundaries:** `deployed=false`, `gcUiRuntimeAccepted=false`, `legacyWebsiteCutover=false`, `platformMigrationComplete=false`.
