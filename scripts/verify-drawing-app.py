"""Browser-level smoke test for the drawing toolbar (requires Vite + Playwright Chromium)."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
failures = []

def check(name, condition, detail=""):
    print(("PASS " if condition else "FAIL ") + name + (f" [{detail}]" if detail and not condition else ""))
    if not condition:
        failures.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    for mode, viewport in (("desktop", {"width": 1280, "height": 800}),
                           ("phone", {"width": 390, "height": 844})):
        context = browser.new_context(viewport=viewport, is_mobile=(mode == "phone"),
                                     has_touch=(mode == "phone"))
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.goto(URL)
        page.wait_for_function("window.__tradingpro && document.querySelector('.status')?.textContent.includes('candles')", timeout=20000)
        page.wait_for_timeout(250)
        export_drawings = lambda: page.evaluate("window.__tradingpro.chart.drawings.export()")
        button = page.get_by_role("button", name="Trend line")
        check(f"{mode}: trend-line tool is present", button.count() == 1)
        button.click()
        check(f"{mode}: trend-line tool activates", button.get_attribute("aria-pressed") == "true")

        box = page.locator('[data-testid="chart"]').bounding_box()
        # Keep both points well inside the plotting region, away from the scales and time axis.
        p1 = (box["x"] + box["width"] * 0.42, box["y"] + box["height"] * 0.38)
        p2 = (box["x"] + box["width"] * 0.68, box["y"] + box["height"] * 0.62)
        if mode == "desktop":
            page.mouse.click(*p1)
            check(f"{mode}: first click does not commit a two-anchor drawing", len(export_drawings()) == 0)
            page.mouse.click(*p2)
        else:
            page.touchscreen.tap(*p1)
            check(f"{mode}: first tap does not commit a two-anchor drawing", len(export_drawings()) == 0)
            page.touchscreen.tap(*p2)

        page.wait_for_function("window.__tradingpro.chart.drawings.export().length === 1", timeout=4000)
        drawings = export_drawings()
        check(f"{mode}: second click/tap commits drawing", len(drawings) == 1)
        if drawings:
            check(f"{mode}: drawing has two anchors", len(drawings[0].get("anchors", [])) == 2, str(drawings[0]))
            check(f"{mode}: drawing is attached to price series", drawings[0].get("seriesId") == "price", str(drawings[0].get("seriesId")))
        check(f"{mode}: tool exits after completion", button.get_attribute("aria-pressed") == "false")

        horizontal = page.get_by_role("button", name="Horizontal line")
        horizontal.click()
        point = (box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.48)
        if mode == "desktop":
            page.mouse.click(*point)
        else:
            page.touchscreen.tap(*point)
        page.wait_for_function("window.__tradingpro.chart.drawings.export().length === 2", timeout=4000)
        drawings = export_drawings()
        check(f"{mode}: single-anchor tool commits on one click/tap", len(drawings) == 2)
        if drawings:
            check(f"{mode}: single-anchor drawing has one anchor", len(drawings[-1].get("anchors", [])) == 1)
        check(f"{mode}: no browser exceptions", not errors, repr(errors))
        context.close()
    browser.close()

sys.exit(1 if failures else 0)
