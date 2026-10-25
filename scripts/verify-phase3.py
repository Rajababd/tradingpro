"""Phase 3 verification against the REAL library: incremental updates, viewport behaviour, paging,
outage/invalid-data recovery. Needs the dev server on :5173 and Python Playwright + Chromium.
Exits non-zero on any failed check."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/scripts/browser/phase3.html"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

def wait_for(page, js, timeout_ms=8000, step=100):
    waited = 0
    while waited <= timeout_ms:
        if page.evaluate(js): return True
        page.wait_for_timeout(step); waited += step
    return False

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(locale="en-US", viewport={"width": 760, "height": 640}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "willReadFrequently" not in m.text else None)
    page.goto(URL)
    page.wait_for_function("window.__ready === true", timeout=25000)
    ev = page.evaluate
    rect = ev("(() => { const r = __md.price.getPane().getHTMLElement().getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })()")
    cx, cy = rect["x"] + rect["w"] / 2, rect["y"] + rect["h"] / 2
    def drag(dx):
        page.mouse.move(cx, cy); page.mouse.down(); page.mouse.move(cx + dx, cy, steps=8); page.mouse.up(); page.wait_for_timeout(250)
    rng = lambda: ev("__md.chart.viewport.getLogicalRange()")

    # ---- L1: initial load
    c = ev("__md.consistency()")
    check("L1 initial: chart and store hold the same 300 candles", c["chartLen"] == 300 and c["allEqual"] and c["ascending"], c)
    check("L1 initial: built with exactly one setData", ev("__md.counts.setData") == 1)

    # ---- L2: live ticks are incremental
    ev("() => { __md.service.startLive({ intervalMs: 150 }); }")
    check("L2 live: store grew by appended bars", wait_for(page, "__md.state().stats.appended >= 3", 12000), ev("__md.state()"))
    c = ev("__md.consistency()")
    check("L2 live: chart still equals the store, field for field, with no duplicates", c["allEqual"] and c["ascending"] and c["chartLen"] == c["storeLen"], c)
    check("L2 live: ticks used update(), never another setData()", ev("__md.counts.setData") == 1 and ev("__md.counts.update") > 3, ev("__md.counts"))
    check("L2 live: still exactly one chart", ev("__md.chartRoots()") == 1)
    st = ev("__md.state()")
    check("L2 live: identical re-sends were recognised as unchanged", st["stats"]["unchanged"] >= 1, st["stats"])

    # ---- L3: ticks do not move the viewport when the user has scrolled into the past
    # (If the live edge is visible the library deliberately follows new bars; see L4.)
    # Zoom to ~120 bars first: at fit-to-data zoom the whole history fills the screen, so any drag
    # would run into the start of the data (and paging there is correct).
    ev("() => { const n = __md.service.candles.length; __md.chart.viewport.setLogicalRange({ from: n - 120, to: n }); }"); page.wait_for_timeout(300)
    drag(150)  # drag right: the view moves back in time, away from the newest candle
    r1 = rng()
    last_index = ev("__md.service.candles.length - 1")
    check("L3 setup: the newest candle is out of view and the left edge is far away", r1["to"] < last_index - 5 and r1["from"] > 100, (r1, last_index))
    before = ev("__md.state().stats.appended")
    ok = wait_for(page, f"__md.state().stats.appended >= {before + 1}", 15000)
    page.wait_for_timeout(400)
    r2 = rng()
    check("L3 viewport: a bar was appended while scrolled away", ok)
    check("L3 viewport: the visible range did not move", abs(r1["from"] - r2["from"]) < 1e-6 and abs(r1["to"] - r2["to"]) < 1e-6, (r1, r2))
    check("L3 viewport: no paging was triggered by live ticks or by this pan", ev("__md.knobs.historicalCalls") == 1, ev("__md.knobs.historicalCalls"))

    # ---- L4: at the right edge the view follows a new bar
    # scrollToRealTime animates for ~1s; stop the feed meanwhile so its target does not go stale.
    ev("() => { __md.service.stopLive(); __md.chart.viewport.scrollToLatest(); }"); page.wait_for_timeout(1700)
    ev("() => { __md.service.startLive({ intervalMs: 150 }); }")
    before = ev("__md.state().stats.appended")
    wait_for(page, f"__md.state().stats.appended >= {before + 4}", 20000); page.wait_for_timeout(300)
    last_index = ev("__md.service.candles.length - 1")
    gap = last_index - rng()["to"]
    # Following means the gap stays within about one bar however many bars arrive (a view that stopped
    # following would fall one bar further behind with each arrival: 4+ bars here). The exact value
    # depends on whether a bar landed a few milliseconds ago, so a tolerance of 1.5 is used.
    check("L4 viewport: at the right edge the view keeps up with new bars (gap stays within ~1 bar after 4 arrivals)", gap <= 1.5, (rng(), last_index, gap))

    # ---- L5: prepend keeps the same candles on screen
    ev("() => { __md.service.stopLive(); const n = __md.service.candles.length; __md.chart.viewport.setLogicalRange({ from: n - 160, to: n - 40 }); }"); page.wait_for_timeout(300)
    drag(100)  # a view in the middle of the data, clear of the paging threshold: only the explicit call below loads history
    pre = rng()
    check("L5 setup: no history was requested yet and the left edge is far away", ev("__md.knobs.historicalCalls") == 1 and pre["from"] > 100, (ev("__md.knobs.historicalCalls"), pre))
    mx, my = rect["x"] + rect["w"] * 0.45, cy
    page.mouse.move(mx, my); page.wait_for_timeout(200)
    t_before = ev("window.__last && window.__last.time")
    n_before = ev("__md.service.candles.length")
    ev("async () => { await __md.service.loadOlder(); await __md.frame(); }")
    page.mouse.move(mx + 1, my); page.mouse.move(mx, my); page.wait_for_timeout(250)
    t_after = ev("window.__last && window.__last.time")
    n_after = ev("__md.service.candles.length"); added = n_after - n_before
    post = rng()
    check("L5 prepend: an older page of 100 candles arrived", added == 100, added)
    check("L5 prepend: the candle under a stationary pointer is unchanged", t_before is not None and t_before == t_after, (t_before, t_after))
    check("L5 prepend: the visible range shifted by exactly the number added",
          abs((post["from"] - pre["from"]) - added) < 0.5 and abs((post["to"] - pre["to"]) - added) < 0.5, (pre, post, added))
    c = ev("__md.consistency()")
    check("L5 prepend: chart equals store after the prepend", c["allEqual"] and c["ascending"], c)

    # ---- L6: panning left pages history automatically, to the very start, then stops
    for _ in range(14):
        drag(400)
        if ev("__md.state().history.exhausted"): break
        page.wait_for_timeout(200)
    st = ev("__md.state()")
    check("L6 paging: reached the start of history and marked it exhausted", st["history"]["exhausted"], st["history"])
    c = ev("__md.consistency()")
    first_time = ev("__md.service.candles[0].time")
    check("L6 paging: the series now begins at the very first simulated bar", first_time == 1704067200, first_time)
    check("L6 paging: chart equals store after all pages, no gaps or duplicates", c["allEqual"] and c["ascending"], c)
    calls = ev("__md.knobs.historicalCalls")
    drag(400); drag(400); page.wait_for_timeout(400)
    check("L6 paging: no more history requests once exhausted", ev("__md.knobs.historicalCalls") == calls)

    # ---- L7: network outage and recovery
    ev("() => { __md.chart.viewport.fitContent(); __md.service.startLive({ intervalMs: 150 }); }")
    wait_for(page, "__md.state().live && __md.state().live.connection === 'connected'", 5000)
    snap = ev("__md.consistency()")
    ev("() => { __md.knobs.down = true; }")
    ok = wait_for(page, "__md.state().live.connection === 'retrying' && __md.state().live.failures >= 2", 8000)
    st = ev("__md.state()")
    check("L7 outage: feed reports retrying with a growing failure count", ok and "connection reset" in (st["live"]["error"] or ""), st["live"])
    c = ev("__md.consistency()")
    check("L7 outage: chart and data untouched while offline, nothing invented", c["chartLen"] == snap["chartLen"] and c["allEqual"], (snap, c))
    check("L7 outage: the app status stays ready (the chart keeps working)", st["status"] == "ready")
    updated_before = ev("__md.state().stats.updated + __md.state().stats.appended")
    ev("() => { __md.knobs.down = false; }")
    ok = wait_for(page, "__md.state().live.connection === 'connected' && __md.state().live.failures === 0", 15000)
    check("L7 recovery: reconnects by itself", ok, ev("__md.state().live"))
    ok = wait_for(page, f"__md.state().stats.updated + __md.state().stats.appended > {updated_before}", 8000)
    check("L7 recovery: new ticks are applied again", ok)
    c = ev("__md.consistency()")
    check("L7 recovery: chart equals store, no duplicates", c["allEqual"] and c["ascending"], c)

    # ---- L8: invalid data
    snap = ev("__md.consistency()")
    ev("() => { __md.knobs.garbage = true; }")
    ok = wait_for(page, "__md.state().live.connection === 'retrying'", 8000)
    st = ev("__md.state()")
    check("L8 invalid data: reported as a failed poll with the reason", ok and "none were valid" in (st["live"]["error"] or ""), st["live"])
    c = ev("__md.consistency()")
    check("L8 invalid data: nothing was applied", c["chartLen"] == snap["chartLen"] and c["allEqual"] and c["lastEqual"], (snap, c))
    ev("() => { __md.knobs.garbage = false; }")
    check("L8 invalid data: recovers once the source is sane again", wait_for(page, "__md.state().live.connection === 'connected'", 15000))

    # ---- L9: dispose stops polling
    ev("() => { __md.service.dispose(); }")
    calls = ev("__md.knobs.latestCalls"); page.wait_for_timeout(1200)
    check("L9 dispose: no requests after dispose", ev("__md.knobs.latestCalls") == calls)
    check("L9 dispose: chart is still intact", ev("__md.chartRoots()") == 1 and ev("__md.price.data().length") > 300)

    check("no page or console errors during the whole run", not errors, errors[:3])
    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
