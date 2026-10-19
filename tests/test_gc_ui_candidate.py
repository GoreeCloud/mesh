"""Non-production GC UI website source validation and regression tests."""
from __future__ import annotations
from pathlib import Path
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from validate_gc_ui_candidate import SOURCE, validate
from build_gc_ui_candidate import FILES


class GCUICandidateTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.folder = Path(self.tmp.name) / "isolated"
        self.folder.mkdir()
        for name in FILES:
            shutil.copyfile(SOURCE / name, self.folder / name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_original_source_is_valid_but_not_accepted(self):
        result = validate(self.folder, built=False)
        self.assertEqual("source-and-integrity-validated", result["status"])
        self.assertFalse(result["deployed"])
        self.assertFalse(result["gcUiRuntimeAccepted"])
        self.assertFalse(result["legacyWebsiteCutover"])

    def test_active_predecessor_import_fails_closed(self):
        p = self.folder / "index.html"
        p.write_text(p.read_text() + '\n<link rel="stylesheet" href="/assets/glaze.css">\n')
        with self.assertRaisesRegex(ValueError, "predecessor"):
            validate(self.folder, built=False)

    def test_unreviewed_foundations_css_change_is_rejected(self):
        p = self.folder / "gc-ui-foundations.css"
        p.write_text(p.read_text() + "\\n/* unreviewed change */\\n")
        with self.assertRaisesRegex(ValueError, "Foundations CSS drift"):
            validate(self.folder, built=False)

    def test_missing_csp_fails_closed(self):
        p = self.folder / "_headers"
        p.write_text(p.read_text().replace("connect-src 'none'", "connect-src *"))
        with self.assertRaisesRegex(ValueError, "security header"):
            validate(self.folder, built=False)

    def test_broken_navigation_fails_closed(self):
        p = self.folder / "index.html"
        p.write_text(p.read_text().replace('href="#model"', 'href="#missing-section"'))
        with self.assertRaisesRegex(ValueError, "broken in-page anchor"):
            validate(self.folder, built=False)

    def test_symlink_rejected(self):
        p = self.folder / "site.css"
        p.unlink()
        p.symlink_to(SOURCE / "site.css")
        with self.assertRaisesRegex(ValueError, "symlink"):
            validate(self.folder, built=False)

    def test_external_script_fails_closed(self):
        p = self.folder / "index.html"
        p.write_text(p.read_text().replace('./assets/site.js', 'https://example.invalid/site.js'))
        with self.assertRaisesRegex(ValueError, "script must be local"):
            validate(self.folder, built=False)


if __name__ == "__main__":
    unittest.main()
