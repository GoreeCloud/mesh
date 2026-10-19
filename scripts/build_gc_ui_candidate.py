#!/usr/bin/env python3
"""Build only the isolated GC UI site candidate. Never touches legacy dist/."""
from __future__ import annotations

from hashlib import sha256
import json
from pathlib import Path
import shutil
import sys

ROOT = Path(__file__).resolve().parents[1]
SOURCE = ROOT / "gc-ui-site"
DIST = ROOT / "dist-gc-ui-candidate"
FILES = {
    "index.html": "index.html",
    "404.html": "404.html",
    "_headers": "_headers",
    "site.css": "assets/site.css",
    "site.js": "assets/site.js",
}


def build() -> dict[str, object]:
    if SOURCE.is_symlink() or not SOURCE.is_dir():
        raise ValueError("GC UI candidate source must be a real directory")
    if DIST.is_symlink():
        raise ValueError("refusing symlinked candidate output")
    # Explicitly bounded output folder. Do not modify production dist/.
    if DIST.exists():
        if not DIST.is_dir():
            raise ValueError("candidate output must be a directory")
        shutil.rmtree(DIST)
    records: dict[str, str] = {}
    for source_name, target_name in FILES.items():
        source = SOURCE / source_name
        if not source.is_file() or source.is_symlink():
            raise ValueError("missing or unsafe GC UI candidate source: " + source_name)
        data = source.read_bytes()
        if not data or len(data) > 1_000_000:
            raise ValueError("empty or oversized candidate source: " + source_name)
        target = DIST / target_name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
        records[target_name] = sha256(data).hexdigest()
    manifest: dict[str, object] = {
        "schema": "gc-ui-mesh-site-candidate.v1",
        "scope": "isolated-offline-build-not-production",
        "deployApproved": False,
        "gcUiRuntimeAccepted": False,
        "legacyWebsiteModified": False,
        "files": dict(sorted(records.items())),
    }
    (DIST / "SHA256SUMS.json").write_text(
        json.dumps(manifest, sort_keys=True, indent=2) + "\n", encoding="utf-8"
    )
    return manifest


if __name__ == "__main__":
    try:
        result = build()
        print(json.dumps(result, sort_keys=True))
    except (OSError, ValueError) as exc:
        print("GC UI candidate build refused: " + str(exc), file=sys.stderr)
        sys.exit(1)
