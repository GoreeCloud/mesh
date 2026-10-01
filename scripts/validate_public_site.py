#!/usr/bin/env python3
from pathlib import Path
from html.parser import HTMLParser
import argparse
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "website"
DIST = ROOT / "dist"
parser = argparse.ArgumentParser()
parser.add_argument("--dist", action="store_true")
args = parser.parse_args()
BASE = DIST if args.dist else SOURCE
errors = []

EXPECTED_RELEASE = "15cc76d2bcd4065552dc31c77145b63f34d9e7b2"
EXPECTED_FILES = {
    "css/glaze-v1.1.0.css": "c689e8e58cefc49f931862996a1e0e871497fe88",
    "css/glaze-v1.0.0.css": "eca2209c5d678830f92907b4d44ea6cc5b1c8536",
    "css/glaze-v1.1.css": "aa0250f01151f17cd3c77e9a67544c6af4b5aa32",
    "css/glaze-v1.1-appearance.css": "c4e10e043d537c68f1e4a5f97bdb8b6f0d371dce",
    "css/glaze-v1.foundation.css": "b01051203831ce011c08f37b79f2e2032d34d0c8",
    "css/glaze-v1.components.css": "f74d5d4a4dd3ae22354812260e06a042d3928507",
    "css/glaze-v1.components.adaptive.css": "e174ea4923ec1ac6e1eb52d7ee33c14f2f77d5ca",
    "css/glaze-v1.components.runtime.css": "a89356172d74b66c62cfda198ae827fe9b71c520",
    "css/glaze-v1.structure.css": "9781c3e162edbac9fce67b93fd3287fdacbcd504",
    "css/glaze-v1.overlay.css": "cb937fae3166289c9c935d7ae25cefe3f82f3ec0",
    "css/glaze-v1.advanced.css": "d6e60a9b23354b1dc62dafac284c93b772e582a4",
    "css/glaze-v1.visual-refinement.css": "f5696fdb81f8deda3ce75e112989d772b7d74909",
    "css/glaze-v1.optical-reachability.css": "6123cff22f06b4c537156a1285e2664763f33316",
}


def check(condition: bool, message: str) -> None:
    if not condition:
        errors.append(message)


def blob_sha(path: Path) -> str:
    data = path.read_bytes()
    prefix = b"blob " + str(len(data)).encode("ascii") + b"\0"
    return hashlib.sha1(prefix + data, usedforsecurity=False).hexdigest()


class PublicHtmlAudit(HTMLParser):
    def handle_starttag(self, tag, attrs):
        values = dict(attrs)
        if "style" in values:
            errors.append("inline style attributes are forbidden by the public-site CSP")
        if tag == "script" and not values.get("src"):
            errors.append("inline scripts are forbidden by the public-site CSP")
        src = values.get("src", "")
        if src.startswith(("http://", "https://", "//")):
            errors.append(f"remote runtime source is forbidden: {src}")
        if tag == "link":
            href = values.get("href", "")
            rel = values.get("rel", "")
            if href.startswith(("http://", "https://", "//")) and "canonical" not in rel.split():
                errors.append(f"remote runtime link is forbidden: {href}")
            if "stylesheet" in rel.split() and ".candidate.css" in href:
                errors.append(f"direct Candidate stylesheet imports are forbidden: {href}")
        if tag == "a" and values.get("href", "").startswith("http://"):
            errors.append(f"external navigation must use HTTPS: {values.get('href')}")


lock = json.loads((SOURCE / "glaze.lock.json").read_text(encoding="utf-8"))
check(lock.get("schema") == "goreecloud.glaze-ui.web-source-manifest.v1", "unexpected Glaze lock schema")
check(lock.get("product") == "GLAZE UI V1.1", "Glaze product must be GLAZE UI V1.1")
check(lock.get("version") == "1.1.0", "Glaze version must be 1.1.0")
check(lock.get("tag") == "v1.1.0", "Glaze Stable tag must be v1.1.0")
check(lock.get("release_commit") == EXPECTED_RELEASE, "Glaze Stable release commit must be pinned")
check(lock.get("entrypoint") == "css/glaze-v1.1.0.css", "Glaze Stable entrypoint must be pinned")
check(lock.get("runtime_network_dependency_required") is False, "runtime Glaze network dependency must remain disabled")
check(lock.get("files") == EXPECTED_FILES, "Glaze V1.1 source graph must match the canonical Stable lock exactly")

vendor_dir = SOURCE / "glaze"
check(vendor_dir.is_dir(), "committed local Glaze vendor directory missing")
if vendor_dir.is_dir():
    expected_vendor_names = {Path(path).name for path in EXPECTED_FILES}
    actual_vendor_names = {path.name for path in vendor_dir.iterdir() if path.is_file() and not path.is_symlink()}
    check(
        actual_vendor_names == expected_vendor_names,
        "committed local Glaze vendor set must match the canonical Stable lock exactly",
    )
    for upstream_path, expected_sha in EXPECTED_FILES.items():
        vendor_path = vendor_dir / Path(upstream_path).name
        safe_vendor_file = vendor_path.is_file() and not vendor_path.is_symlink()
        check(safe_vendor_file, f"missing or unsafe committed Glaze source: {upstream_path}")
        if safe_vendor_file:
            check(
                blob_sha(vendor_path) == expected_sha,
                f"committed Glaze source integrity mismatch: {upstream_path}",
            )

html = (BASE / "index.html").read_text(encoding="utf-8")
not_found = (BASE / "404.html").read_text(encoding="utf-8")
css = (BASE / "assets" / "site.css" if args.dist else SOURCE / "site.css").read_text(encoding="utf-8")
theme_css = (BASE / "assets" / "mesh-theme.css" if args.dist else SOURCE / "mesh-theme.css").read_text(encoding="utf-8")
js = (BASE / "assets" / "site.js" if args.dist else SOURCE / "site.js").read_text(encoding="utf-8")
for page in (BASE / "index.html", BASE / "404.html"):
    PublicHtmlAudit().feed(page.read_text(encoding="utf-8"))

for document in (html, not_found):
    check('data-glaze-version="1.1"' in document, "missing Glaze V1.1 document marker")
    check('/assets/glaze/glaze-v1.1.0.css' in document, "Stable Glaze V1.1 stylesheet entrypoint not linked")
    for stale in ("Glaze UI 2.2", "Glaze UI 2.1", "glaze-2.2", 'data-glaze-version="2.'):
        check(stale not in document, f"superseded Glaze marker remains in public document: {stale}")
check('name="goreecloud-glaze-ui" content="1.1.0"' in html, "missing Glaze 1.1.0 meta marker")
check('data-glaze-ui="1.1.0"' in html, "missing Glaze 1.1.0 stylesheet marker")
check("glz11-nav" in html and "glz11-nav-item" in html and "glz11-button" in html, "V1.1 component semantics missing")
check("prefers-reduced-motion:reduce" in css, "reduced-motion fallback missing")
check("forced-colors:active" in css, "forced-colors fallback missing")
check("prefers-contrast:more" in css, "increased-contrast fallback missing")
check("prefers-reduced-transparency: reduce" in theme_css, "reduced-transparency fallback missing")
check("min-height:48px" in css, "48px interaction floor missing")
check("localStorage" in js and all(choice in js for choice in ("system", "light", "dark", "deep-dark")), "V1.1 appearance modes missing")
check("data-glz-appearance" in js, "V1.1 appearance attribute contract missing")
check("fonts.googleapis" not in html + css + theme_css, "remote fonts are forbidden")
check("googletagmanager" not in html.lower(), "analytics/tracker runtime is forbidden")
check("segment.com" not in html.lower(), "analytics/tracker runtime is forbidden")
headers = (BASE / "_headers").read_text(encoding="utf-8")
check("Content-Security-Policy:" in headers, "Content Security Policy missing")
check("connect-src 'none'" in headers, "public website must not make browser network API connections")
check("Strict-Transport-Security: max-age=31536000" in headers, "HSTS policy missing")
check("Referrer-Policy: no-referrer" in headers, "strict referrer policy missing")

mark = SOURCE / "assets" / "goreecloud-mesh-mark.svg"
check(mark.exists(), "Mesh mark missing")
if mark.exists():
    check(blob_sha(mark) == "5362a52bd9fb38379f083a4d894934ed1acf9b67", "Mesh mark diverged from approved Interlace blob")
check("Interlace" in html, "approved Interlace identity missing")
check("authority_transfer = false" in html, "Mesh authority-transfer invariant missing")
check('rel="canonical" href="https://mesh.goreecloud.com/"' in html, "Mesh canonical URL missing")
check("Production acceptance stays explicit" in html, "Mesh production truth boundary missing")

if args.dist:
    for upstream_path, expected_sha in EXPECTED_FILES.items():
        path = DIST / "assets" / "glaze" / Path(upstream_path).name
        check(path.exists(), f"missing built Glaze asset: {upstream_path}")
        if path.exists():
            check(blob_sha(path) == expected_sha, f"Glaze asset integrity mismatch: {upstream_path}")
    built_mark = DIST / "assets" / mark.name
    check(built_mark.exists(), f"missing built product mark: {mark.name}")
    if built_mark.exists():
        check(blob_sha(built_mark) == blob_sha(mark), f"built product mark integrity mismatch: {mark.name}")
    check((DIST / "_headers").exists(), "built security headers missing")

if errors:
    print("Public website validation failed:", file=sys.stderr)
    for error in errors:
        print(f" - {error}", file=sys.stderr)
    raise SystemExit(1)
print(f"Mesh Center public website validation passed ({'dist' if args.dist else 'source'})")
