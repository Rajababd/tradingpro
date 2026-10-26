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
        drawing_debug = []
        page.on("pageerror", lambda error: errors.append(str(error)))
        page.on("console", lambda message: drawing_debug.append(message.text) if "[drawing-debug]" in message.text else None)
        page.goto(URL)
        page.wait_for_function("window.__tradingpro && document.querySelector('.status')?.textContent.includes('candles')", timeout=20000)
        page.wait_for_timeout(250)
        export_drawings = lambda: page.evaluate("window.__tradingpro.chart.drawings.export()")
        button = page.get_by_role("button", name="Trend line")
        check(f"{mode}: trend-line tool is present", button.count() == 1)
        button.click()
        check(f"{mode}: trend-line tool activates", button.get_attribute("aria-pressed") == "true")

        box = page.locator('[data-testid="chart"]').bounding_box()
        page.locator('[data-testid="chart"]').evaluate("""el => {
            window.__drawingDebugEvents = [];
            for (const type of ["pointerdown", "pointerup", "click"]) {
                el.addEventListener(type, event => {
                    window.__drawingDebugEvents.push({
                        type,
                        x: event.clientX,
                        y: event.clientY,
                        target: event.target?.tagName ?? null,
                        className: String(event.target?.className ?? "")
                    });
                }, true);
            }
        }""")
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

        drawing_committed = True
        try:
            page.wait_for_function(
                "window.__tradingpro.chart.drawings.export().length === 1",
                timeout=4000,
            )
        except Exception:
            drawing_committed = False
            print(f"DEBUG {mode}: chartBox={box}")
            print(f"DEBUG {mode}: p1={p1}, p2={p2}")
            print(f"DEBUG {mode}: drawings={export_drawings()}")
            print(
                f"DEBUG {mode}: activeTool="
                f"{page.evaluate('window.__tradingpro.chart.drawings.activeTool')}"
            )
            print(
                f"DEBUG {mode}: DOM pointer/click events="
                f"{page.evaluate('window.__drawingDebugEvents')}"
            )
            print(f"DEBUG {mode}: drawingManagerLogs={drawing_debug}")
            print(f"DEBUG {mode}: pageErrors={errors}")

        drawings = export_drawings()
        check(f"{mode}: second click/tap commits drawing", drawing_committed and len(drawings) == 1)
        if drawings:
            check(f"{mode}: drawing has two anchors", len(drawings[0].get("anchors", [])) == 2, str(drawings[0]))
            check(f"{mode}: drawing is attached to price series", drawings[0].get("seriesId") == "price", str(drawings[0].get("seriesId")))
        if drawing_committed:
            check(f"{mode}: tool exits after completion", button.get_attribute("aria-pressed") == "false")

        # Continue with a one-click tool even if the two-click tool failed; this distinguishes
        # a general click-dispatch problem from an anchor-count/second-click problem.
        horizontal = page.get_by_role("button", name="Horizontal line")
        horizontal.click()
        point = (box["x"] + box["width"] * 0.55, box["y"] + box["height"] * 0.48)
        if mode == "desktop":
            page.mouse.click(*point)
        else:
            page.touchscreen.tap(*point)
        horizontal_committed = True
        try:
            page.wait_for_function(
                "window.__tradingpro.chart.drawings.export().length === (window.__drawingExpectedCount ?? 2)",
                timeout=4000,
            )
        except Exception:
            horizontal_committed = False
            print(f"DEBUG {mode}: one-click tool timed out")
            print(f"DEBUG {mode}: drawings after one-click tool={export_drawings()}")
            print(f"DEBUG {mode}: drawingManagerLogs={drawing_debug}")
            print(f"DEBUG {mode}: pageErrors={errors}")
        drawings = export_drawings()
        check(f"{mode}: single-anchor tool commits on one click/tap", horizontal_committed and len(drawings) == (2 if drawing_committed else 1))
        if horizontal_committed and drawings:
            check(f"{mode}: single-anchor drawing has one anchor", len(drawings[-1].get("anchors", [])) == 1)
        check(f"{mode}: no browser exceptions", not errors, repr(errors))
        context.close()
    browser.close()

sys.exit(1 if failures else 0)
