"""Browser-level smoke test for the drawing toolbar (requires Vite + Playwright Chromium)."""
import sys
import json
from datetime import date, timedelta
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
        # Keep the drawing acceptance test deterministic and independent of DSE CORS/network.
        # The live DSE integration is verified separately against the real endpoints.
        daily_rows = []
        session_date = date(2025, 1, 1)
        for index in range(400):
            opening = 100 + index
            closing = opening + 0.5
            daily_rows.append({
                "date": (session_date + timedelta(days=index)).isoformat(),
                "open": str(opening), "high": str(closing + 1), "low": str(opening - 1),
                "close": str(closing), "volume_traded": "1000", "value_traded": "100000",
            })
        def mock_dse(route):
            payload = daily_rows
            if "/index/" in route.request.url:
                payload = [{
                    "date": row["date"], "open_val": row["open"], "max_val": row["high"],
                    "min_val": row["low"], "close_val": row["close"],
                    "traded_volume": row["volume_traded"], "value_traded": row["value_traded"],
                } for row in daily_rows]
                payload = {"value_and_date": payload}
            route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
        page.route("https://dse.sy/**", mock_dse)
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
            expected_count = 2 if drawing_committed else 1
            page.wait_for_function(
                "expected => window.__tradingpro.chart.drawings.export().length === expected",
                arg=expected_count,
                timeout=4000,
            )
        except Exception:
            horizontal_committed = False
            print(f"DEBUG {mode}: one-click tool timed out")
            print(f"DEBUG {mode}: drawings after one-click tool={export_drawings()}")
            print(f"DEBUG {mode}: pageErrors={errors}")
        drawings = export_drawings()
        check(f"{mode}: single-anchor tool commits on one click/tap", horizontal_committed and len(drawings) == (2 if drawing_committed else 1))
        if horizontal_committed and drawings:
            check(f"{mode}: single-anchor drawing has one anchor", len(drawings[-1].get("anchors", [])) == 1)
        # Exercise the remaining two-anchor tools in the real UI as well.
        for tool_name, tool_label in (("rectangle", "Rectangle"), ("fib-retracement", "Fib retracement")):
            tool_button = page.get_by_role("button", name=tool_label)
            check(f"{mode}: {tool_label} tool is present", tool_button.count() == 1)
            if tool_button.count() != 1:
                continue
            tool_button.click()
            check(f"{mode}: {tool_label} tool activates", tool_button.get_attribute("aria-pressed") == "true")
            before_count = len(export_drawings())
            tool_p1 = (box["x"] + box["width"] * 0.34, box["y"] + box["height"] * 0.32)
            tool_p2 = (box["x"] + box["width"] * 0.64, box["y"] + box["height"] * 0.66)
            if mode == "desktop":
                page.mouse.click(*tool_p1)
                check(f"{mode}: {tool_label} waits for its second anchor",
                      len(export_drawings()) == before_count, str(export_drawings()))
                page.mouse.click(*tool_p2)
            else:
                page.touchscreen.tap(*tool_p1)
                check(f"{mode}: {tool_label} waits for its second anchor",
                      len(export_drawings()) == before_count, str(export_drawings()))
                page.touchscreen.tap(*tool_p2)
            committed = True
            try:
                page.wait_for_function(
                    "expected => window.__tradingpro.chart.drawings.export().length === expected",
                    arg=before_count + 1,
                    timeout=4000,
                )
            except Exception:
                committed = False
                print(f"DEBUG {mode}: {tool_label} did not commit; drawings={export_drawings()}")
                print(f"DEBUG {mode}: activeTool={page.evaluate('window.__tradingpro.chart.drawings.activeTool')}")
                print(f"DEBUG {mode}: pageErrors={errors}")
            current_drawings = export_drawings()
            check(f"{mode}: {tool_label} commits after second click/tap",
                  committed and len(current_drawings) == before_count + 1, str(current_drawings))
            if len(current_drawings) > before_count:
                created = current_drawings[-1]
                check(f"{mode}: {tool_label} has two anchors",
                      len(created.get("anchors", [])) == 2, str(created))
                check(f"{mode}: {tool_label} is attached to price series",
                      created.get("seriesId") == "price", str(created.get("seriesId")))
            if committed:
                check(f"{mode}: {tool_label} exits after completion",
                      tool_button.get_attribute("aria-pressed") == "false")
        # Verify the autosaved drawings survive a full page reload.
        expected_drawings = export_drawings()
        page.wait_for_timeout(350)  # debounce window is 150 ms
        page.reload()
        page.wait_for_function("window.__tradingpro && document.querySelector('.status')?.textContent.includes('candles')", timeout=20000)
        try:
            page.wait_for_function(
                "expected => window.__tradingpro.chart.drawings.export().length === expected",
                arg=len(expected_drawings),
                timeout=6000,
            )
            restored_drawings = export_drawings()
            check(f"{mode}: drawings restore after page reload",
                  len(restored_drawings) == len(expected_drawings),
                  f"expected={len(expected_drawings)}, restored={len(restored_drawings)}")
            check(f"{mode}: restored drawing IDs and types match",
                  [(d.get("id"), d.get("type")) for d in restored_drawings] ==
                  [(d.get("id"), d.get("type")) for d in expected_drawings])
        except Exception as error:
            check(f"{mode}: drawings restore after page reload", False, str(error))
            print(f"DEBUG {mode}: expected persisted drawings={expected_drawings}")
            print(f"DEBUG {mode}: restored drawings={export_drawings()}")
        # A cleared drawing set must remain empty after debounce and reload.
        clear_button = page.get_by_role("button", name="Clear drawings")
        clear_button.click()
        try:
            page.wait_for_function("window.__tradingpro.chart.drawings.export().length === 0", timeout=3000)
            check(f"{mode}: clear drawings removes all drawings", len(export_drawings()) == 0)
            page.wait_for_timeout(350)  # allow the debounced empty state to be persisted
            page.reload()
            page.wait_for_function("window.__tradingpro && document.querySelector('.status')?.textContent.includes('candles')", timeout=20000)
            page.wait_for_timeout(400)  # allow asynchronous restoration to complete
            check(f"{mode}: cleared drawings stay cleared after reload", len(export_drawings()) == 0,
                  f"restored={export_drawings()}")
        except Exception as error:
            check(f"{mode}: cleared drawings stay cleared after reload", False, str(error))
            print(f"DEBUG {mode}: drawings after clear/reload={export_drawings()}")
        check(f"{mode}: no browser exceptions", not errors, repr(errors))
        context.close()
    browser.close()

sys.exit(1 if failures else 0)
