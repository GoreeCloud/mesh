#!/usr/bin/env python3
"""Real-browser smoke checks for the isolated Mesh GC UI candidate, never production."""
from __future__ import annotations
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
import json
import sys

from playwright.sync_api import sync_playwright
from build_gc_ui_candidate import DIST
from validate_gc_ui_candidate import validate


class QuietHandler(SimpleHTTPRequestHandler):
    def log_message(self, *_args):
        pass


def run() -> list[dict]:
    validate(DIST, built=True)
    handler = partial(QuietHandler, directory=str(DIST))
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_port}"
    results: list[dict] = []
    try:
        with sync_playwright() as playwright:
            for name in ("chromium", "firefox"):
                browser = getattr(playwright, name).launch(headless=True)
                context = browser.new_context(viewport={"width": 1280, "height": 900},
                                              reduced_motion="reduce")
                page = context.new_page()
                requests = []
                page.on("request", lambda request: requests.append(request.url))
                response = page.goto(base + "/", wait_until="networkidle")
                assert response is not None and response.status == 200, name + " index failed"
                assert page.title() == "GoreeCloud Mesh — GC UI development preview"
                assert page.get_by_role("heading", name="Coordinate openly. Keep authority independent.").count() == 1
                assert "authority_transfer = false" in page.locator("body").inner_text()
                assert page.get_by_role("navigation", name="Primary navigation").count() == 1
                assert page.get_by_role("main").count() == 1
                assert page.locator('meta[name="robots"]').get_attribute("content").startswith("noindex")
                assert page.locator("[data-theme-choice]").count() == 3

                # Verify that keyboard users reach the skip link before navigation.
                page.keyboard.press("Tab")
                assert page.evaluate("document.activeElement.classList.contains('skip')"), name + " skip link inaccessible"
                page.keyboard.press("Enter")
                assert page.evaluate("document.activeElement.id") == "main", name + " skip action did not focus main"

                # Appearance preference survives a reload in this isolated origin.
                page.get_by_role("button", name="Dark").click()
                assert page.locator("html").get_attribute("data-theme") == "dark"
                assert page.get_by_role("button", name="Dark").get_attribute("aria-pressed") == "true"
                dark = page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor")
                page.reload(wait_until="networkidle")
                assert page.locator("html").get_attribute("data-theme") == "dark"
                page.get_by_role("button", name="Light").click()
                light = page.locator("body").evaluate("el => getComputedStyle(el).backgroundColor")
                assert dark != light, name + " theme did not alter computed background"
                page.get_by_role("button", name="System").click()
                assert page.locator("html").get_attribute("data-theme") == "system"

                # No horizontal overflow at narrow, tablet or desktop viewport.
                for width in (320, 375, 768, 1280):
                    page.set_viewport_size({"width": width, "height": 900})
                    overflow = page.evaluate("document.documentElement.scrollWidth - window.innerWidth")
                    assert overflow <= 1, f"{name} horizontal overflow at {width}px: {overflow}px"

                page.set_viewport_size({"width": 375, "height": 900})
                page.emulate_media(forced_colors="active", reduced_motion="reduce")
                assert page.evaluate("matchMedia('(forced-colors: active)').matches")
                assert page.evaluate("matchMedia('(prefers-reduced-motion: reduce)').matches")
                page.emulate_media(forced_colors="none", reduced_motion="reduce")
                page.get_by_role("link", name="Model").click()
                assert page.url.endswith("#model"), name + " in-page navigation failed"

                # The candidate 404 is a static document; HTTP missing-path behavior
                # still needs its own deployment acceptance before production.
                error_response = page.goto(base + "/404.html", wait_until="networkidle")
                assert error_response is not None and error_response.status == 200
                assert page.get_by_role("heading", name="This Mesh path does not exist.").count() == 1
                assert page.locator("script").count() == 0
                page.get_by_role("link", name="Back to Mesh overview").click()
                assert page.title() == "GoreeCloud Mesh — GC UI development preview"

                # External links are allowed as user navigation only, never browser
                # runtime resources or automatic network calls.
                assert all(url.startswith(base + "/") for url in requests), (name, requests)
                results.append({"browser": name, "previewChecks": "pass", "viewports": [320, 375, 768, 1280],
                                "deployed": False, "runtimeCertified": False})
                context.close()
                browser.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=3)
    return results


if __name__ == "__main__":
    try:
        print(json.dumps(run(), sort_keys=True))
    except Exception as exc:
        print("GC UI browser preview smoke failed: " + str(exc), file=sys.stderr)
        sys.exit(1)
