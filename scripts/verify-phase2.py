"""Phase 2 verification against the REAL lightweight-charts library in headless Chromium.

Requires the dev server (npm run dev, port 5173) and Python Playwright with Chromium.
Exits non-zero if any check fails. The unit tests use a fake chart modelled on the
behaviour asserted here, so this script is what keeps that fake honest.
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/scripts/browser/phase2.html"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok), detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(locale="en-US", viewport={"width": 700, "height": 760}).new_page()
    page_errors = []
    page.on("pageerror", lambda e: page_errors.append(str(e)))
    page.goto(URL)
    page.wait_for_function("window.__ready === true", timeout=20000)
    # NOTE: Playwright CALLS any function an evaluated expression returns. subscribe() returns an
    # unsubscribe function, so multi-statement setups must be block-bodied arrow functions that return nothing.
    ev = page.evaluate

    # --- S1: initial state
    check("S1 one chart root, one real pane", ev("document.querySelectorAll('.tv-lightweight-charts').length") == 1 and ev("__tp.paneCount()") == 1)
    lay = ev("__tp.layout()")
    check("S1 price series is in LW pane 0", len(lay) == 1 and lay[0]["id"] == "price" and lay[0]["lwIndex"] == 0, lay)

    # --- S2: logical order honoured when panes are created out of order
    ev("['volume','rsi','macd'].forEach((id) => __tp.controller.panes.register(id))")
    ev("__tp.addLine('macd', 'macd', 0)")
    ev("__tp.addLine('rsi', 'rsi', 50)")
    ev("__tp.addHist('volume', 'volume')")
    ev("__tp.frame()")
    lay = {s["id"]: s for s in ev("__tp.layout()")}
    check("S2 real pane count is 4", ev("__tp.paneCount()") == 4, ev("__tp.paneCount()"))
    check("S2 real LW indices follow logical order price,volume,rsi,macd",
          [lay[i]["lwIndex"] for i in ("price", "volume", "rsi", "macd")] == [0, 1, 2, 3], lay)
    check("S2 manager's expected index equals the library's index for every series",
          all(s["lwIndex"] == s["expectedIndex"] for s in lay.values()), lay)

    # --- S3 / Scenario A: repeated hide/show of RSI
    toggles = ev("() => { let n = 0; for (let i = 0; i < 25; i++) { __tp.controller.visibility.setSeriesVisible('rsi', false); __tp.controller.visibility.setSeriesVisible('rsi', true); n += 2; } return n; }")
    check("A: the 25 hide/show cycles really ran", toggles == 50, toggles)
    ev("__tp.controller.visibility.setSeriesVisible('rsi', false)")
    ev("__tp.frame()")
    lay = {s["id"]: s for s in ev("__tp.layout()")}
    check("A: no duplicate series after 25 hide/show cycles", len(ev("__tp.layout()")) == 4)
    check("A: pane count and indices unchanged while hidden", ev("__tp.paneCount()") == 4 and lay["rsi"]["lwIndex"] == 2 and lay["macd"]["lwIndex"] == 3)
    check("A: library really has the series hidden, still attached", ev("__tp.controller.series.get('rsi').options().visible") is False and lay["rsi"]["seriesInLwPane"] == 1)
    ev("__tp.controller.visibility.setSeriesVisible('rsi', true)")
    check("A: library shows it again", ev("__tp.controller.series.get('rsi').options().visible") is True)

    # --- S4 / Scenario B: shared pane
    ev("__tp.addLine('rsi-sma', 'rsi', 50)")
    ev("__tp.controller.visibility.setSeriesVisible('rsi', false)")
    lay = {s["id"]: s for s in ev("__tp.layout()")}
    check("B: pane stays (2 series in it) while one series is hidden", ev("__tp.paneCount()") == 4 and lay["rsi"]["seriesInLwPane"] == 2)
    ev("__tp.controller.visibility.removeSeries('rsi')")
    check("B: pane stays after removing one of two series", ev("__tp.paneCount()") == 4)
    ev("__tp.controller.visibility.removeSeries('rsi-sma')")
    ev("__tp.frame()")
    lay = {s["id"]: s for s in ev("__tp.layout()")}
    check("B: pane disappears with its last series; later panes shift down in the real library",
          ev("__tp.paneCount()") == 3 and lay["macd"]["lwIndex"] == 2 and lay["macd"]["expectedIndex"] == 2, lay)
    check("B: logical slot kept in manager", ev("__tp.controller.panes.order") == ["price", "volume", "rsi", "macd"])
    ev("__tp.addLine('rsi', 'rsi', 50)")
    ev("__tp.frame()")
    lay = {s["id"]: s for s in ev("__tp.layout()")}
    check("B: re-added pane returns to its logical slot (index 2) and macd moves back to 3",
          ev("__tp.paneCount()") == 4 and lay["rsi"]["lwIndex"] == 2 and lay["macd"]["lwIndex"] == 3, lay)

    # --- S5: protections and failure handling
    before = ev("__tp.layout()")
    check("price series cannot be removed", ev("(() => { try { __tp.controller.visibility.removeSeries('price'); return 'no throw'; } catch (e) { return e.message; } })()").endswith("cannot be removed."))
    check("duplicate id is refused", "already exists" in ev("(() => { try { __tp.addLine('macd', 'macd'); return 'no throw'; } catch (e) { return e.message; } })()"))
    msg = ev("(() => { try { __tp.controller.visibility.addSeries({ id: 'bad', definition: { type: 'Bogus' }, paneId: 'bad' }); return 'no throw'; } catch (e) { return 'threw'; } })()")
    check("library-rejected series leaves no trace in manager or chart",
          msg == "threw" and not ev("__tp.controller.series.has('bad')") and not ev("__tp.controller.panes.isMaterialized('bad')")
          and ev("__tp.paneCount()") == 4 and ev("__tp.layout()") == before, (msg, ev("__tp.paneCount()")))

    # --- S6: viewport
    ev("() => { window.__ranges = []; window.__stopRange = __tp.controller.viewport.subscribe((r) => window.__ranges.push(r)); }")
    ev("__tp.controller.viewport.fitContent()"); page.wait_for_timeout(150)
    rng = ev("__tp.controller.viewport.getLogicalRange()")
    check("viewport: fitContent shows the whole logical range", rng and rng["from"] <= 0.5 and rng["to"] >= 118.5, rng)
    n0 = ev("window.__ranges.length")
    pr = ev("(() => { const r = __tp.controller.series.get('price').getPane().getHTMLElement().getBoundingClientRect(); return { x: r.left, y: r.top, w: r.width, h: r.height }; })()")
    cx, cy = pr["x"] + pr["w"] / 2, pr["y"] + pr["h"] / 2
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + 80, cy, steps=6); page.mouse.up(); page.wait_for_timeout(200)
    after = ev("__tp.controller.viewport.getLogicalRange()")
    check("viewport: dragging scrolls the logical range and notifies subscribers",
          ev("window.__ranges.length") > n0 and after["from"] != rng["from"], (rng, after))
    ev("__tp.controller.viewport.scrollToLatest()"); page.wait_for_timeout(1500)  # the library animates this
    check("viewport: scrollToLatest keeps the newest candle in view", ev("__tp.controller.viewport.getLogicalRange().to") >= 118.5, ev("__tp.controller.viewport.getLogicalRange()"))
    ev("() => { window.__stopRange(); }"); n1 = ev("window.__ranges.length")
    page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx - 60, cy, steps=5); page.mouse.up(); page.wait_for_timeout(200)
    check("viewport: no notifications after unsubscribe", ev("window.__ranges.length") == n1)

    # --- S7: crosshair with a real mouse
    ev("() => { window.__snaps = []; window.__stopCross = __tp.controller.crosshair.subscribe((s) => window.__snaps.push(s)); }")
    ev("__tp.controller.viewport.fitContent()"); page.wait_for_timeout(150)
    # A viewport change under an idle pointer legitimately re-emits the crosshair for the candle now
    # beneath it; drop that event so the sweep below is judged on its own.
    ev("() => { window.__snaps.length = 0; }")
    for k in range(0, int(pr["w"]) - 60, 25):
        page.mouse.move(pr["x"] + 10 + k, cy)
    page.wait_for_timeout(150)
    snaps = [s for s in ev("window.__snaps") if s["time"] is not None]
    bar = ev("Object.fromEntries(__tp.report.candles.map((c) => [c.time, c]))")
    ok = len(snaps) > 5 and all(s["candle"] and abs(s["candle"]["close"] - bar[str(s["time"])]["close"]) < 1e-9 for s in snaps)
    check("crosshair: every snapshot carries the price candle for its own time", ok, snaps[:2])
    times = [s["time"] for s in snaps]
    check("crosshair: time increases as the pointer moves right", times == sorted(times) and times[0] < times[-1])
    check("crosshair: pane index reported for the price pane", all(s["paneIndex"] == 0 for s in snaps))
    ev("window.__snaps.length = 0")
    vp = ev("(() => { const r = __tp.controller.series.get('volume').getPane().getHTMLElement().getBoundingClientRect(); return { y: r.top + r.height / 2 }; })()")
    page.mouse.move(pr["x"] + pr["w"] / 2, vp["y"]); page.wait_for_timeout(150)
    inds = [s for s in ev("window.__snaps") if s["time"] is not None]
    check("crosshair: hovering an indicator pane reports that pane but still the price candle",
          inds and inds[-1]["paneIndex"] == 1 and inds[-1]["candle"] is not None, inds[-1:] )
    page.mouse.move(690, 750); page.wait_for_timeout(150)
    check("crosshair: leaving the chart yields an empty snapshot", ev("window.__snaps[window.__snaps.length-1].time") is None)
    ev("() => { window.__stopCross(); window.__snaps.length = 0; }")
    page.mouse.move(pr["x"] + 100, cy); page.mouse.move(pr["x"] + 140, cy); page.wait_for_timeout(100)
    check("crosshair: no notifications after unsubscribe", ev("window.__snaps.length") == 0)

    # --- S8: dispose and clean re-mount (React StrictMode pattern)
    ev("__tp.controller.dispose()")
    check("dispose removes the chart from the DOM", ev("document.querySelectorAll('.tv-lightweight-charts').length") == 0)
    ev("""(() => { const c = new __tp.ChartController(__tp.theme); c.mount(document.getElementById('c')); c.setCandles(__tp.report.candles); window.__second = c; })()""")
    check("a fresh controller mounts a single clean chart afterwards", ev("document.querySelectorAll('.tv-lightweight-charts').length") == 1)
    ev("window.__second.dispose()")
    check("no leaked chart roots after second dispose", ev("document.querySelectorAll('.tv-lightweight-charts').length") == 0)

    check("no page errors during the whole run", not page_errors, page_errors)
    browser.close()

failed = [r for r in results if not r[1]]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
