"""Phase 6 verification: drives the REAL app UI (menus, switches, fields) in Chromium and asserts on the real chart
and engine through the development-only `window.__tradingpro` seam. Needs the dev server on :5173."""
import sys
import json
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
T = "window.__tradingpro"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

# independent calculations done in the page, not by the code under test
JS_HELPERS = """
window.__h = {
  sma: (xs, n) => xs.map((_, i) => { if (i < n - 1) return null; const w = xs.slice(i - n + 1, i + 1); return w.some((v) => v === null) ? null : w.reduce((a, b) => a + b, 0) / n; }),
  // series.data() lists only real points (whitespace is omitted), so align to the engine's times
  shown: (id) => { const m = new Map(__tradingpro.chart.series.get(id).data().map((p) => [p.time, p.value])); return __tradingpro.engine.times.map((t) => (typeof m.get(t) === 'number' ? m.get(t) : null)); },
  close: (a, b) => a.length === b.length && a.every((v, i) => (v === null) === (b[i] === null) && (v === null || Math.abs(v - b[i]) < 1e-9)),
  paneRows: () => [...document.querySelectorAll('[data-testid=chart] table')[0].rows].filter((_, i) => i % 2 === 0).map((r) => Math.round(r.getBoundingClientRect().height)),
  vis: () => JSON.stringify(__tradingpro.chart.visibility.getSnapshot()),
};
"""

def new_page(browser, **ctx):
    page = browser.new_context(locale="en-US", **ctx).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "willReadFrequently" not in m.text else None)
    # Mock the DSE historical endpoints for deterministic browser acceptance tests.
    # Live endpoint access/CORS is a separate integration check.
    daily_rows = []
    start_date = date(2025, 1, 1)
    for index in range(400):
        opening = 100 + index
        closing = opening + 0.5
        daily_rows.append({
            "date": (start_date + timedelta(days=index)).isoformat(),
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
    page.goto(URL)
    page.wait_for_function(f"{T} && {T}.service.getState().status === 'ready' && {T}.service.candles.length >= 300", timeout=20000)
    page.evaluate(JS_HELPERS)
    page.wait_for_timeout(400)
    return page, errors

with sync_playwright() as p:
    browser = p.chromium.launch()
    page, errors = new_page(browser, viewport={"width": 1280, "height": 800})
    ev = page.evaluate
    trig = lambda name: page.get_by_role("button", name=name, exact=False).filter(has_text=name).first
    open_menu = lambda name: (trig(name).click(), page.wait_for_selector(f"#menu-{ 'indicators' if name == 'Indicators' else 'sma' }", timeout=3000))
    row = lambda attr, key: page.locator(f"[{attr}='{key}']")
    switch = lambda attr, key: row(attr, key).locator(".switch-row")

    # ---- M1: opening a menu changes nothing
    before = ev("__h.vis()"); engine_before = ev(f"{T}.engine.list().length")
    open_menu("Indicators"); page.keyboard.press("Escape"); open_menu("SMA"); page.keyboard.press("Escape")
    check("M1 opening and closing both menus changes no visibility and creates no calculation", ev("__h.vis()") == before and ev(f"{T}.engine.list().length") == engine_before == 0)
    check("M1 the price chart is untouched: one pane, one series", ev("__h.paneRows().length") == 1 and ev(f"{T}.chart.series.list().length") == 1)

    # ---- M13: lists come from the registry
    open_menu("Indicators")
    ids = ev("[...document.querySelectorAll('#menu-indicators [data-indicator]')].map((e) => e.dataset.indicator)")
    check("M13 Indicators menu rows = the registry's indicators, in order", ids == ev(f"{T}.engine.registry.list().map((d) => d.id)") == ["rsi", "volume", "obv", "ad", "macd"], ids)
    names = ev("[...document.querySelectorAll('#menu-indicators .row-name')].map((e) => e.textContent)")
    check("M13 ...with their names", names == ["RSI", "Volume", "OBV", "Accumulation/Distribution", "MACD"], names)
    check("M13 nothing is displayed by default", ev("[...document.querySelectorAll('#menu-indicators input[role=switch]')].every((i) => !i.checked)"))

    # ---- M3 / M4 / Scenario A through real clicks
    H0 = ev("__h.paneRows()")
    switch("data-indicator", "rsi").click(); page.wait_for_timeout(150)
    check("M3 clicking RSI shows it: switch on, a second pane appears", ev(f"{T}.workspace.getSnapshot().indicators.find((r) => r.definitionId === 'rsi').displayed") and ev("__h.paneRows().length") == 2)
    check("M3 the menu stays open while toggling (several can be switched)", page.locator("#menu-indicators").count() == 1)
    ev(f"() => {{ window.__rsi = {T}.chart.series.get('rsi:rsi'); }}")
    check("M3 RSI data in the chart equals the engine's RSI, warm-up as gaps", ev(f"__h.close(__h.shown('rsi:rsi'), {T}.engine.values('rsi','rsi'))") and ev("__h.shown('rsi:rsi').slice(0, 14).every((v) => v === null)"))
    switch("data-indicator", "rsi").click(); page.wait_for_timeout(150)
    check("M3 clicking again hides it: its pane collapses, nothing removed", ev("__h.paneRows()[1]") <= 3 and ev(f"{T}.chart.series.has('rsi:rsi')") and ev(f"{T}.engine.has('rsi')"))
    switch("data-indicator", "rsi").click(); page.wait_for_timeout(150)
    Hs = ev("__h.paneRows()")
    check("M3 showing it again restores the pane to its earlier size", ev("__h.paneRows().length") == 2 and Hs[1] > 40, Hs)
    for _ in range(24):
        switch("data-indicator", "rsi").click(); switch("data-indicator", "rsi").click()
    page.wait_for_timeout(200)
    check("M4 after 25 real hide/show cycles: still ONE RSI series, the same object, same pane size",
          ev(f"{T}.chart.series.list().filter((s) => s.id === 'rsi:rsi').length") == 1 and ev(f"{T}.chart.series.get('rsi:rsi') === window.__rsi") is True and abs(ev("__h.paneRows()[1]") - Hs[1]) <= 1)
    check("M4 ...and one calculation, correct data", ev(f"{T}.engine.list().length") == 1 and ev(f"__h.close(__h.shown('rsi:rsi'), {T}.engine.values('rsi','rsi'))"))

    # ---- M12: indicator settings
    page.get_by_role("button", name="RSI settings").click()
    field = page.locator("[data-indicator='rsi'] .field input")
    check("M12 RSI settings show the current period", field.input_value() == "14")
    field.fill("7"); field.press("Enter"); page.wait_for_timeout(150)
    check("M12 a valid period is applied: engine parameters and the drawn series both follow",
          ev(f"{T}.engine.get('rsi').params.period") == 7 and ev("__h.shown('rsi:rsi').findIndex((v) => v !== null)") == 7 and ev(f"{T}.chart.series.get('rsi:rsi') === window.__rsi") is True)
    field.fill("1"); field.press("Enter"); page.wait_for_timeout(100)
    err = page.locator("[data-indicator='rsi'] .error")
    check("M12 an invalid period shows the reason and changes nothing", err.count() == 1 and "between 2 and 500" in err.inner_text() and ev(f"{T}.engine.get('rsi').params.period") == 7, err.all_inner_texts())
    field.fill("abc"); field.press("Enter"); page.wait_for_timeout(100)
    check("M12 text that is not a whole number is refused", "whole number" in err.inner_text() and ev(f"{T}.engine.get('rsi').params.period") == 7)
    field.press("Escape"); page.wait_for_timeout(100)
    check("M12 Escape reverts the edit (first Escape does not close the menu)", field.input_value() == "7" and page.locator("#menu-indicators").count() == 1)
    page.get_by_role("button", name="RSI settings").click()  # collapse

    # ---- MACD: shared pane and per-line control (Scenario B in the UI)
    switch("data-indicator", "macd").click(); page.wait_for_timeout(150)
    n_panes = ev("__h.paneRows().length")
    check("B MACD shows three lines in ONE new pane", n_panes == 3 and ev(f"{T}.chart.visibility.getSnapshot().panes.find((p) => p.paneId === 'macd').seriesIds.length") == 3, n_panes)
    page.get_by_role("button", name="MACD settings").click()
    page.locator("[data-indicator='macd'] .chip", has_text="Signal").click(); page.locator("[data-indicator='macd'] .chip", has_text="MACD").first.click(); page.wait_for_timeout(120)
    macd_h = ev("__h.paneRows()[2]")
    check("B hiding two of three lines leaves the pane open at full size", macd_h > 40 and ev(f"{T}.workspace.getSnapshot().indicators.find((r) => r.definitionId === 'macd').displayed"), macd_h)
    page.locator("[data-indicator='macd'] .chip", has_text="Histogram").click(); page.wait_for_timeout(120)
    check("B hiding the last line collapses the pane and the indicator reads as not displayed", ev("__h.paneRows()[2]") <= 3 and not ev(f"{T}.workspace.getSnapshot().indicators.find((r) => r.definitionId === 'macd').displayed"))
    page.locator("[data-indicator='macd'] .chip", has_text="Signal").click(); page.wait_for_timeout(120)
    check("B showing one line brings the pane back; the other two stay hidden",
          ev("__h.paneRows()[2]") > 40 and ev(f"{T}.chart.series.get('macd:macd').options().visible") is False and ev(f"{T}.chart.series.get('macd:signal').options().visible") is not False)
    f_fast = page.locator("[data-indicator='macd'] .field input").first
    f_fast.fill("40"); f_fast.press("Enter"); page.wait_for_timeout(100)
    check("M12 MACD: fast not shorter than slow is refused with the reason", "shorter than the slow" in page.locator("[data-indicator='macd'] .error").first.inner_text() and ev(f"{T}.engine.get('macd').params.fast") == 12)
    f_fast.press("Escape")
    page.keyboard.press("Escape")

    # ---- closing behaviour
    check("M5 Escape closed the menu", page.locator("#menu-indicators").count() == 0)
    check("M5 focus went back to the trigger", ev("document.activeElement.textContent.startsWith('Indicators')"))
    open_menu("Indicators"); box = page.locator("[data-testid=chart]").bounding_box()
    page.mouse.click(box["x"] + box["width"] * 0.85, box["y"] + 200); page.wait_for_timeout(100)
    check("M5 pressing on the chart closes the menu", page.locator("#menu-indicators").count() == 0)
    open_menu("Indicators"); open_menu("SMA")
    check("M5 opening the other menu closes the first (only one panel exists)", page.locator(".menu-panel").count() == 1 and page.locator("#menu-sma").count() == 1)

    # ---- SMA menu: sources from the registry, Price first
    keys = ev("[...document.querySelectorAll('#menu-sma [data-sma-source]')].map((e) => e.dataset.smaSource)")
    check("M13 SMA menu lists Price first, then every eligible output, exactly as the registry derives them",
          keys == ev(f"{T}.engine.registry.smaSourceOptions().map((o) => o.key)") and keys[0] == "price" and "macd:signal" in keys and len(keys) == 8, keys)
    labels = ev("[...document.querySelectorAll('#menu-sma .row-name')].map((e) => e.textContent.replace(' · not shown', ''))")
    expected_sma_keys = ["price", "rsi:rsi", "volume:volume", "obv:obv", "ad:ad", "macd:macd", "macd:signal", "macd:histogram"]
    expected_sma_labels = ["Price", "RSI", "Volume", "OBV", "Accumulation/Distribution", "MACD · MACD", "MACD · Signal", "MACD · Histogram"]
    check("M13 SMA menu has the complete expected source keys in order", keys == expected_sma_keys, keys)
    check("M13 SMA menu has the complete expected labels in order", labels == expected_sma_labels, labels)
    check("M13 SMA source menu matches registry keys and labels", 
          keys == ev(f"{T}.engine.registry.smaSourceOptions().map((o) => o.key)") and
          labels == ev(f"{T}.engine.registry.smaSourceOptions().map((o) => o.label)"))
    check("M6 every SMA starts off with period 20", ev("[...document.querySelectorAll('#menu-sma .field input')].every((i) => i.value === '20')") and ev("[...document.querySelectorAll('#menu-sma input[role=switch]')].every((i) => !i.checked)"))

    # ---- M6: SMA on price (Scenario C)
    switch("data-sma-source", "price").click(); page.wait_for_timeout(200)
    check("M6 SMA on price: a line in the PRICE pane (no new pane)", ev(f"{T}.chart.series.get('sma:price').getPane().paneIndex()") == 0 and ev("__h.paneRows().length") == 3)
    check("M6 its values equal an independent SMA(20) of the closes",
          ev(f"__h.close(__h.shown('sma:price'), __h.sma({T}.service.candles.map((c) => c.close), 20))"))
    ev(f"() => {{ window.__smaPrice = {T}.chart.series.get('sma:price'); }}")
    f = page.locator("[data-sma-source='price'] .field input")
    f.fill("50"); f.press("Enter"); page.wait_for_timeout(200)
    check("M6 changing the period to 50 recalculates correctly, in the same series", ev(f"__h.close(__h.shown('sma:price'), __h.sma({T}.service.candles.map((c) => c.close), 50))") and ev(f"{T}.chart.series.get('sma:price') === window.__smaPrice") is True)
    switch("data-sma-source", "price").click(); page.wait_for_timeout(150)
    check("M6 turning it off hides the line but keeps its calculation and its period",
          ev(f"{T}.chart.series.get('sma:price').options().visible") is False and ev(f"{T}.engine.has('sma-price')") and f.input_value() == "50")
    switch("data-sma-source", "price").click(); page.wait_for_timeout(150)
    check("M6 turning it back on shows the same series with period 50 intact", ev(f"{T}.chart.series.get('sma:price') === window.__smaPrice") is True and f.input_value() == "50" and ev(f"{T}.chart.series.get('sma:price').options().visible") is not False)
    for _ in range(15):
        switch("data-sma-source", "price").click(); switch("data-sma-source", "price").click()
    check("M6 repeated toggling creates no duplicate series", ev(f"{T}.chart.series.list().filter((s) => s.id === 'sma:price').length") == 1)
    f.fill("0"); f.press("Enter"); page.wait_for_timeout(100)
    check("M7 period 0 is refused with the reason and the old period stays", "between 1 and 1000" in page.locator("[data-sma-source='price'] .error").inner_text() and ev(f"{T}.engine.get('sma-price').period") == 50)
    f.press("Escape")

    # ---- M8: SMA on a source that is not displayed
    check("M8 OBV was never shown: no OBV series exists yet", not ev(f"{T}.chart.series.has('obv:obv')"))
    panes_before = ev("__h.paneRows().length")
    switch("data-sma-source", "obv:obv").click(); page.wait_for_timeout(200)
    check("M8 SMA on OBV works while OBV is not displayed: its pane opens with only the SMA line", ev("__h.paneRows().length") == panes_before + 1 and not ev(f"{T}.chart.series.has('obv:obv')") and ev(f"{T}.chart.series.has('sma:obv:obv')"))
    check("M8 the row says the source is not shown (the SMA is on and its source is hidden)", "source not shown" in row("data-sma-source", "obv:obv").inner_text())
    check("M8 ...and rows whose SMA is off say nothing of the kind", "not shown" not in row("data-sma-source", "volume:volume").inner_text() and "not shown" not in row("data-sma-source", "ad:ad").inner_text())
    check("M8 its values equal an independent SMA(20) of the engine's OBV", ev(f"__h.close(__h.shown('sma:obv:obv'), __h.sma({T}.engine.values('obv','obv'), 20))"))
    open_menu("Indicators"); switch("data-indicator", "obv").click(); page.wait_for_timeout(200)
    check("M8 showing OBV later puts it in the SAME pane as its SMA",
          ev(f"{T}.chart.series.get('obv:obv').getPane().paneIndex() === {T}.chart.series.get('sma:obv:obv').getPane().paneIndex()") is True and ev("__h.paneRows().length") == panes_before + 1)
    open_menu("SMA")
    check("M8 ...and the row no longer says not shown", "not shown" not in row("data-sma-source", "obv:obv").inner_text())
    switch("data-indicator", "obv") if False else None

    # ---- M9: MACD outputs are not mixed up
    switch("data-sma-source", "macd:signal").click(); switch("data-sma-source", "macd:macd").click(); page.wait_for_timeout(250)
    check("M9 SMA of MACD's signal uses the SIGNAL line", ev(f"__h.close(__h.shown('sma:macd:signal'), __h.sma({T}.engine.values('macd','signal'), 20))"))
    check("M9 SMA of the MACD line uses the MACD line", ev(f"__h.close(__h.shown('sma:macd:macd'), __h.sma({T}.engine.values('macd','macd'), 20))"))
    check("M9 they are two different series with different colours",
          ev(f"{T}.chart.series.get('sma:macd:signal').options().color !== {T}.chart.series.get('sma:macd:macd').options().color"))
    check("M9 both sit in MACD's pane", ev(f"[ 'sma:macd:signal', 'sma:macd:macd', 'macd:signal' ].map((id) => {T}.chart.series.get(id).getPane().paneIndex())").count(ev(f"{T}.chart.series.get('macd:signal').getPane().paneIndex()")) == 3)
    page.keyboard.press("Escape")

    # ---- M10: live updates keep everything consistent
    # DSE supplies daily history rather than a rapid intraday stream. Inject one controlled
    # live-feed event here so this acceptance test still verifies indicator synchronization
    # on append without making the production DSE poll interval artificially short.
    page.evaluate(f"""() => {{
      const service = {T}.service;
      window.__appended0 = service.getState().stats.appended;
      service.stopLive();
      service.startLive({{ intervalMs: 2000, feed: {{
        start: (handlers) => {{ window.__emitDseTestCandle = handlers.onRecords; }},
        stop: () => {{ delete window.__emitDseTestCandle; }}
      }} }});
      const last = service.candles.at(-1);
      window.__emitDseTestCandle([{{ time: last.time + 86400, open: last.close,
        high: last.close + 1, low: last.close - 1, close: last.close + 0.5,
        volume: 1000, valueTraded: 5000 }}]);
    }}""")
    page.wait_for_function(f"{T}.service.getState().stats.appended >= window.__appended0 + 1", timeout=30000)
    page.wait_for_timeout(300)
    ok = ev(f"""(() => {{
      const e = {T}.engine; let bad = [];
      for (const [id, key, inst] of [['rsi:rsi','rsi','rsi'], ['obv:obv','obv','obv'], ['macd:signal','signal','macd'], ['sma:price','sma','sma-price'], ['sma:obv:obv','sma','sma-obv-obv'], ['sma:macd:signal','sma','sma-macd-signal']]) {{
        const data = {T}.chart.series.get(id).data(); const col = e.values(inst, key);
        const times = data.map((p) => p.time);
        if (data.length !== col.filter((v) => v !== null).length || new Set(times).size !== times.length) bad.push(id + ' length/duplicates');
        else if (!__h.close(__h.shown(id), col)) bad.push(id + ' values');
      }}
      return bad; }})()""")
    check("M10 after live ticks and a new bar, every indicator and SMA series equals its calculation, with no duplicate times", ok == [], ok)

    # ---- M11: the menu never fights the chart for gestures
    open_menu("SMA")
    r0 = ev(f"{T}.chart.viewport.getLogicalRange()")
    pb = page.locator("#menu-sma").bounding_box()
    page.mouse.move(pb["x"] + pb["width"] / 2, pb["y"] + 60); page.mouse.down(); page.mouse.move(pb["x"] + pb["width"] / 2 + 120, pb["y"] + 60, steps=6); page.mouse.up(); page.wait_for_timeout(200)
    r1 = ev(f"{T}.chart.viewport.getLogicalRange()")
    check("M11 dragging inside the open menu does not pan the chart", abs(r0["from"] - r1["from"]) < 1e-6 and page.locator("#menu-sma").count() == 1, (r0, r1))
    page.mouse.move(box["x"] + box["width"] * 0.6, box["y"] + 200); page.mouse.down(); page.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + 200, steps=6); page.mouse.up(); page.wait_for_timeout(250)
    r2 = ev(f"{T}.chart.viewport.getLogicalRange()")
    check("M11 dragging on the chart closes the menu AND pans the chart as normal", page.locator("#menu-sma").count() == 0 and abs(r2["from"] - r1["from"]) > 1, (r1, r2))


    # ---- G: a missing volume must show up as a real gap in the OBV line (pixels, not data)
    GAP_JS = f"""() => {{
      const pane = {T}.chart.series.get('obv:obv').getPane().getHTMLElement(); let cols = null;
      for (const c of pane.querySelectorAll('canvas')) {{
        const w = c.width, h = c.height; if (!w || !h) continue;
        const d = c.getContext('2d').getImageData(0, 0, w, h).data, lim = Math.max(0, w - 90), has = new Array(lim).fill(false);
        for (let y = 0; y < h; y++) for (let x = 0; x < lim; x++) {{ const i = (y * w + x) * 4;
          if (d[i + 3] > 0 && Math.abs(d[i] - 122) < 45 && Math.abs(d[i + 1] - 167) < 45 && Math.abs(d[i + 2] - 255) < 45) has[x] = true; }}
        cols = cols ? cols.map((v, i) => v || has[i]) : has; }}
      const first = cols.indexOf(true), last = cols.lastIndexOf(true);
      return {{ first, last, gapColumns: cols.slice(first, last + 1).filter((v) => !v).length }}; }}"""
    base = ev(f"{T}.chart.viewport.fitContent(), 0"); page.wait_for_timeout(500)
    g0 = ev(GAP_JS)
    check("G baseline: with full volume the OBV line is continuous (no interior gap columns)", g0["last"] > g0["first"] + 100 and g0["gapColumns"] == 0, g0)
    ev(f"""() => {{ const c = {T}.service.candles.map((x, i) => (i >= 240 && i < 250 ? {{ ...x, volume: null }} : x)); {T}.engine.reset(c); }}""")
    page.wait_for_timeout(500)
    g1 = ev(GAP_JS)
    check("G ten bars with no volume leave a visible gap in the OBV line (nothing bridges it)", g1["gapColumns"] >= 15, g1)
    check("G ...and the data for those bars is gaps, not zeros", ev(f"{T}.engine.values('obv','obv').slice(240, 250).every((v) => v === null)"))

    check("no page or console errors (desktop)", not errors, errors[:3])
    page.context.close()

    # ---- placement on awkward screens, and touch
    for name, vp, touch in [("phone portrait 360x640", {"width": 360, "height": 640}, True), ("phone 320x480", {"width": 320, "height": 480}, True),
                            ("phone landscape 640x360", {"width": 640, "height": 360}, True), ("tablet 768x1024", {"width": 768, "height": 1024}, True)]:
        pg, errs = new_page(browser, viewport=vp, has_touch=touch, is_mobile=True, device_scale_factor=2)
        e2 = pg.evaluate
        for menu_name, mid in [("Indicators", "menu-indicators"), ("SMA", "menu-sma")]:
            tr = pg.get_by_role("button", name=menu_name).first
            tb = tr.bounding_box()
            check(f"M14 {name}: the {menu_name} button is at least 40px tall (touch target)", tb["height"] >= 40, tb)
            tr.tap(); pg.wait_for_selector(f"#{mid}", timeout=3000); pg.wait_for_timeout(150)
            r = e2(f"(() => {{ const r = document.getElementById('{mid}').getBoundingClientRect(); const el = document.getElementById('{mid}'); return {{ l: r.left, t: r.top, r: r.right, b: r.bottom, scroll: el.scrollHeight > el.clientHeight, oy: getComputedStyle(el).overflowY }}; }})()")
            inside = r["l"] >= 0 and r["t"] >= 0 and r["r"] <= vp["width"] + 0.5 and r["b"] <= vp["height"] + 0.5
            check(f"M2 {name}: the {menu_name} panel is fully inside the screen", inside, (r, vp))
            check(f"M2 {name}: if the panel is taller than the room it scrolls inside itself", (not r["scroll"]) or r["oy"] in ("auto", "scroll"), r)
            sw = pg.locator(f"#{mid} .switch-row").first.bounding_box()
            check(f"M14 {name}: switch rows are at least 44px tall and fill the row beside any settings button", sw["height"] >= 44 and sw["width"] >= r["r"] - r["l"] - 24 - 44, sw)  # a 44px settings button may sit beside it
            if menu_name == "Indicators":
                before = e2(f"{T}.workspace.getSnapshot().indicators.find((x) => x.definitionId === 'rsi').displayed")
                pg.locator("#menu-indicators [data-indicator='rsi'] .switch-row").tap(); pg.wait_for_timeout(200)
                after = e2(f"{T}.workspace.getSnapshot().indicators.find((x) => x.definitionId === 'rsi').displayed")
                check(f"M11 {name}: a tap on a switch toggles it, closes nothing, and starts no crosshair", before is False and after is True and pg.locator("#menu-indicators").count() == 1 and e2("document.querySelector('[data-testid=legend]').textContent") == "")
                pg.locator("#menu-indicators [data-indicator='rsi'] .switch-row").tap(); pg.wait_for_timeout(150)
            close = pg.get_by_role("button", name=f"Close {menu_name} menu")
            cb_ = close.bounding_box()
            check(f"M14 {name}: the panel's Close button is a 40px+ touch target", cb_["width"] >= 40 and cb_["height"] >= 40, cb_)
            close.tap(); pg.wait_for_timeout(150)
            check(f"M5 {name}: the Close button closes the {menu_name} menu and returns focus to its button", pg.locator(f"#{mid}").count() == 0 and e2(f"document.activeElement.textContent.startsWith('{menu_name}')"))
            tr.tap(); pg.wait_for_selector(f"#{mid}", timeout=3000)
            pg.locator("h1.brand").tap(); pg.wait_for_timeout(150)
            check(f"M5 {name}: tapping outside the panel (the top bar) closes the {menu_name} menu", pg.locator(f"#{mid}").count() == 0)
        check(f"{name}: no page or console errors", not errs, errs[:3])
        pg.context.close()

    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
