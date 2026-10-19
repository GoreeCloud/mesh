#!/usr/bin/env python3
"""Fail-closed static acceptance of a non-deployed GC UI site candidate."""
from __future__ import annotations
import argparse
from hashlib import sha1, sha256
from html.parser import HTMLParser
import json
from pathlib import Path
import re
import sys

from build_gc_ui_candidate import ROOT, SOURCE, DIST, FILES

LEGACY = re.compile(r"glaze|(?:--|[./_-])glz[-_]", re.IGNORECASE)
FOUNDATIONS_SOURCE_REPO = "GoreeCloud/gc-ui"
FOUNDATIONS_SOURCE_COMMIT = "7e0b61ee70af2edb87aa736cca483425f0aacaf4"
FOUNDATIONS_SOURCE_PATH = "styles/gc.v1.generated.css"
FOUNDATIONS_GIT_BLOB = "c0e32a40f0bba280c9a4e9e01f31e1114d60f26c"
FOUNDATIONS_RELEASE_TAG = "foundations-v1.0.1"
FOUNDATIONS_ARCHIVE_SHA256 = "275d7e6dc9503b2e74b3190bcecf176d73d2345860e8a20fa5faa3b326cd2298"

REQUIRED_IDS = {"top", "main", "model", "boundaries", "status"}
CHECKS = ("prefers-color-scheme", "prefers-reduced-motion", "forced-colors",
          "prefers-contrast", "max-width:600px", "focus-visible", "--gc-accent")


class Page(HTMLParser):
    def __init__(self):
        super().__init__()
        self.ids = set()
        self.anchors = []
        self.scripts = []
        self.styles = []
        self.title_count = 0
        self.lang_count = 0
        self.skip = False
        self.style_attributes = 0
        self.inline_scripts = 0
        self.theme_buttons = []
        self.in_script = False
        self.roles = []

    def handle_starttag(self, tag, attrs):
        a = dict(attrs)
        if "id" in a:
            if a["id"] in self.ids:
                raise ValueError("duplicate document id: " + a["id"])
            self.ids.add(a["id"])
        if "style" in a:
            self.style_attributes += 1
        if tag == "html":
            if a.get("lang") != "en":
                raise ValueError("missing document language")
            self.lang_count += 1
        if tag == "a":
            if a.get("href", "").startswith("#"):
                self.anchors.append(a["href"][1:])
                if "skip" in a.get("class", "").split():
                    self.skip = a["href"] == "#main"
        if tag == "script":
            if not a.get("src"):
                self.inline_scripts += 1
            self.scripts.append(a.get("src"))
        if tag == "link" and "stylesheet" in a.get("rel", "").split():
            self.styles.append(a.get("href"))
        if tag == "button" and "data-theme-choice" in a:
            self.theme_buttons.append((a["data-theme-choice"], a.get("aria-pressed")))
        if "role" in a:
            self.roles.append(a["role"])


def validate(folder: Path, built: bool) -> dict:
    if not folder.is_dir() or folder.is_symlink():
        raise ValueError("missing or unsafe candidate root")
    allowed = set(FILES.values()) if built else set(FILES.keys())
    allowed.add("SHA256SUMS.json") if built else None
    actual = set()
    for path in folder.rglob("*"):
        if path.is_symlink():
            raise ValueError("candidate contains a symlink")
        if path.is_file():
            actual.add(path.relative_to(folder).as_posix())
    if actual != allowed:
        raise ValueError("candidate output has missing or unexpected files: " +
                         repr(sorted(actual ^ allowed)))

    sources = {}
    for source_name, output_name in FILES.items():
        file = folder / (output_name if built else source_name)
        data = file.read_bytes()
        if not data or len(data) > 1_000_000 or b"\0" in data:
            raise ValueError("invalid or oversized candidate content: " + file.name)
        text = data.decode("utf-8", "strict")
        if LEGACY.search(text):
            raise ValueError("active predecessor reference in candidate file: " + file.name)
        sources[output_name] = data
    # The official stable 1.0.1 package build copies this exact generated
    # stylesheet unchanged from the pinned release source commit. We verify
    # *Git source blob identity*, not equivalence to a separately downloaded
    # tarball or successful npm registry installation.
    foundation = sources["assets/gc-ui-foundations.css"]
    blob_bytes = b"blob " + str(len(foundation)).encode("ascii") + bytes([0]) + foundation
    if sha1(blob_bytes).hexdigest() != FOUNDATIONS_GIT_BLOB:
        raise ValueError("pinned GC UI Foundations CSS drift: unreviewed source")
    if b"@import" in foundation or b"url(http" in foundation:
        raise ValueError("Foundations CSS must remain self-contained and local")

    if built:
        manifest = json.loads((folder / "SHA256SUMS.json").read_text("utf-8"))
        if manifest.get("schema") != "gc-ui-mesh-site-candidate.v1":
            raise ValueError("unknown candidate manifest schema")
        if manifest.get("deployApproved") is not False:
            raise ValueError("preview is not deployment approved")
        if manifest.get("gcUiRuntimeAccepted") is not False:
            raise ValueError("preview is not a GC UI runtime acceptance")
        if manifest.get("legacyWebsiteModified") is not False:
            raise ValueError("preview cannot claim legacy website modified")
        expected = {name: sha256(data).hexdigest() for name, data in sources.items()}
        if manifest.get("files") != expected:
            raise ValueError("built candidate integrity manifest does not match")

    def read(name):
        return sources[name].decode("utf-8", "strict")

    homepage = read("index.html")
    errorpage = read("404.html")
    for title, html in (("home", homepage), ("404", errorpage)):
        page = Page()
        page.feed(html)
        if page.style_attributes or page.inline_scripts:
            raise ValueError(title + ": inline scripts or styles forbidden")
        if page.lang_count != 1 or not page.skip:
            raise ValueError(title + ": missing language or skip link")
        if not {"main"}.issubset(page.ids):
            raise ValueError(title + ": no main region")
        if any(anchor not in page.ids for anchor in page.anchors):
            raise ValueError(title + ": broken in-page anchor")
        if page.styles != ["./assets/gc-ui-foundations.css", "./assets/site.css"]:
            raise ValueError(title + ": CSS must be local, sole reviewed source")
        if title == "home":
            if set(page.ids).issuperset(REQUIRED_IDS) is False:
                raise ValueError("missing required model/boundary/status sections")
            if page.scripts != ["./assets/site.js"]:
                raise ValueError("home script must be local")
            if sorted(page.theme_buttons) != [("dark", "false"),
                                              ("light", "false"),
                                              ("system", "true")]:
                raise ValueError("theme chooser state and semantics invalid")
            if "authority_transfer = false" not in html:
                raise ValueError("Mesh must preserve no-authority-transfer invariant")
        elif page.scripts:
            raise ValueError("404 must be functional without JavaScript")
        if "noindex" not in html:
            raise ValueError("unaccepted preview must not be indexed")
    css = read("assets/site.css")
    foundations = read("assets/gc-ui-foundations.css")
    for name in ("--gc-v1-foundation-target-touch",
                 "--gc-v1-foundation-typography-family-ui",
                 "--gc-v1-component-focus-width",
                 "--gc-v1-color-on-canvas"):
        if name not in foundations:
            raise ValueError("pinned Foundations token not defined: " + name)
        if name != "--gc-v1-color-on-canvas" and name not in read("assets/site.css"):
            raise ValueError("Mesh preview does not use Foundations role: " + name)

    script = read("assets/site.js")
    headers = read("_headers")
    for token in CHECKS:
        if token not in css:
            raise ValueError("missing style accessibility/resilience contract: " + token)
    for token in ("data-theme-choice", "aria-pressed", "localStorage", "catch"):
        if token not in script:
            raise ValueError("missing theme persistence/failure contract: " + token)
    if re.search(r"\b(fetch|XMLHttpRequest|WebSocket|sendBeacon|eval)\s*\(", script):
        raise ValueError("script must not create network, beacon or eval execution")
    for token in ("Content-Security-Policy:", "default-src 'self'", "connect-src 'none'",
                  "script-src 'self'", "frame-ancestors 'none'", "X-Robots-Tag: noindex",
                  "Strict-Transport-Security: max-age=31536000", "Referrer-Policy: no-referrer"):
        if token not in headers:
            raise ValueError("missing isolated security header: " + token)
    for path, data in sources.items():
        if path.endswith((".html", ".css", ".js")):
            if re.search(r"""(?:src|href)=["']https?://[^"']+\.(?:css|js)["']""", data.decode()):
                raise ValueError("remote browser assets forbidden: " + path)
    return {"candidate": "mesh-gc-ui-static-preview", "files": len(sources),
            "status": "source-and-integrity-validated", "deployed": False,
            "gcUiRuntimeAccepted": False, "legacyWebsiteCutover": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--dist", action="store_true", help="verify built artifact and SHA256")
    args = parser.parse_args()
    try:
        print(json.dumps(validate(DIST if args.dist else SOURCE, args.dist), sort_keys=True))
    except (OSError, UnicodeError, ValueError, KeyError) as error:
        print("GC UI candidate validation failed: " + str(error), file=sys.stderr)
        sys.exit(1)
