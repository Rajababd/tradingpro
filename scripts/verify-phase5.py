"""Phase 5 verification against the REAL library: series/pane visibility, collapse and restore, layout drift.
Needs the dev server on :5173 and Python Playwright + Chromium. Exits non-zero on any failed check."""
import sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/scripts/browser/phase5.html"
results = []

def check(name, ok, detail=""):
    results.append((name, bool(ok)))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_context(locale="en-US", viewport={"width": 760, "height": 700}).new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "willReadFrequently" not in m.text else None)
    page.goto(URL)
    page.wait_for_function("window.__ready === true", timeout=25000)
    ev = page.evaluate
    settle = lambda: ev("__v.frame()")
    hs = lambda: ev("__v.heights()")
    near = lambda a, b, tol=1: len(a) == len(b) and all(abs(x - y) <= tol for x, y in zip(a, b))

    H0, S0 = hs(), ev("__v.stretch()")
    TOTAL0 = sum(H0)
    check("P1 initial: price + volume + rsi + macd = 4 panes, all visible and sized", len(H0) == 4 and all(h > 40 for h in H0), H0)
    check("P1 initial: logical order matches chart order", ev("['vol','rsi','macd'].map((id) => __v.lwIndex(id))") == [1, 2, 3])
    SERIES0 = ev("__v.libraryPaneSeriesTotal()")
    REF = ev("() => { window.__ref = __v.controller.series.get('vol'); return true; }")

    # ---- A: single-series pane, repeated hide / show
    ev("() => { __v.vc.setSeriesVisible('vol', false); }"); settle()
    Hh = hs()
    check("A: hiding the volume series collapses its pane to a sliver (<= 3px) and keeps all 4 panes", Hh[1] <= 3 and len(Hh) == 4, Hh)
    check("A: the freed space goes to the other panes (total height conserved)", abs(sum(Hh) - TOTAL0) <= 2, (sum(Hh), TOTAL0))
    check("A: the series is hidden in the library, not removed", ev("__v.controller.series.get('vol').options().visible") is False and ev("__v.libraryPaneSeriesTotal()") == SERIES0)
    ev("() => { __v.vc.setSeriesVisible('vol', true); }"); settle()
    check("A: showing it again restores the same pane sizes (within 1px)", near(hs(), H0), (hs(), H0))
    check("A: ...and exactly the same stretch factors", ev("__v.stretch()") == S0, (ev("__v.stretch()"), S0))
    ev("() => { for (let i = 0; i < 50; i++) { __v.vc.setSeriesVisible('vol', false); __v.vc.setSeriesVisible('vol', true); } }"); settle()
    check("A: after 50 more hide/show cycles there is no layout drift", near(hs(), H0) and ev("__v.stretch()") == S0, (hs(), ev("__v.stretch()")))
    check("A: ...no duplicate series, and it is the very same series object (never re-created)",
          ev("__v.libraryPaneSeriesTotal()") == SERIES0 and ev("__v.controller.series.get('vol') === window.__ref") is True)

    # ---- B: shared pane (three series)
    ev("() => { __v.vc.setSeriesVisible('macd', false); __v.vc.setSeriesVisible('signal', false); }"); settle()
    check("B: hiding two of three series leaves the shared pane at full size", near(hs(), H0), (hs(), H0))
    ev("() => { __v.vc.setSeriesVisible('hist', false); }"); settle()
    check("B: hiding the last visible series collapses the pane", hs()[3] <= 3, hs())
    ev("() => { __v.vc.setSeriesVisible('signal', true); }"); settle()
    check("B: showing ONE series brings the whole pane back at its original size", near(hs(), H0), (hs(), H0))
    check("B: the other two series stay hidden (independent visibility)",
          ev("__v.controller.series.get('macd').options().visible") is False and ev("__v.controller.series.get('hist').options().visible") is False
          and ev("__v.controller.series.get('signal').options().visible") is not False)
    ev("() => { __v.vc.setSeriesVisible('macd', true); __v.vc.setSeriesVisible('hist', true); }"); settle()

    # ---- SMA independence in the rsi pane
    ev("() => { __v.vc.setSeriesVisible('rsi', false); }"); settle()
    check("SMA: hiding the RSI series keeps its pane open while the SMA is visible", near(hs(), H0), (hs(), H0))
    ev("() => { __v.vc.setSeriesVisible('rsi-sma', false); }"); settle()
    check("SMA: hiding the SMA as well collapses the pane", hs()[2] <= 3, hs())
    ev("() => { __v.vc.setSeriesVisible('rsi', true); }"); settle()
    check("SMA: showing the source does not resurrect the SMA",
          ev("__v.vc.isSeriesVisible('rsi-sma')") is False and near(hs(), H0), hs())
    ev("() => { __v.vc.setSeriesVisible('rsi-sma', true); }"); settle()

    # ---- only the price pane
    ev("() => { for (const id of ['vol','rsi','rsi-sma','macd','signal','hist']) __v.vc.setSeriesVisible(id, false); }"); settle()
    Hp = hs()
    seps = ev("__v.separators().length")
    check("only price: every indicator pane is collapsed to <= 3px", all(h <= 3 for h in Hp[1:]) and len(Hp) == 4, Hp)
    check("only price: the price pane takes the available height (all but ~3px per hidden pane)", Hp[0] >= TOTAL0 - 3 * 3 - 2, (Hp[0], TOTAL0))
    check("only price: the price pane grew substantially", Hp[0] > H0[0] * 1.5, (Hp[0], H0[0]))
    check("only price: visible pane order is just the price pane", ev("__v.vc.visiblePaneOrder()") == ["price"])
    check("only price: nothing was removed (all series still exist in the library)", ev("__v.libraryPaneSeriesTotal()") == SERIES0)
    page.screenshot(path="/mnt/user-data/outputs/phase5_price_only.png")
    ev("() => { for (const id of ['macd','signal','hist','rsi-sma','rsi','vol']) __v.vc.setSeriesVisible(id, true); }"); settle()
    check("restoring everything (in a different order) returns the original layout", near(hs(), H0) and ev("__v.stretch()") == S0, (hs(), ev("__v.stretch()")))
    check("pane order is unchanged throughout", ev("['vol','rsi','macd'].map((id) => __v.lwIndex(id))") == [1, 2, 3])
    ev("() => { for (let i = 0; i < 30; i++) { for (const id of ['vol','rsi','rsi-sma','macd','signal','hist']) __v.vc.setSeriesVisible(id, false); for (const id of ['hist','signal','macd','rsi-sma','rsi','vol']) __v.vc.setSeriesVisible(id, true); } }"); settle()
    check("30 cycles of hide-everything / show-everything: no drift", near(hs(), H0) and ev("__v.stretch()") == S0 and ev("__v.libraryPaneSeriesTotal()") == SERIES0, (hs(), ev("__v.stretch()")))

    # ---- the user resizes a pane by dragging a separator; hide/show must preserve THEIR layout
    sep = ev("(() => { const r = __v.separators()[1].getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()")
    page.mouse.move(sep["x"], sep["y"]); page.mouse.down(); page.mouse.move(sep["x"], sep["y"] + 45, steps=10); page.mouse.up(); page.wait_for_timeout(300); settle()
    Hu, Su = hs(), ev("__v.stretch()")
    dragged = not near(Hu, H0, 3)
    check("U setup: dragging a separator really resizes panes in this library version (a real user action)", dragged, (H0, Hu))
    if not dragged:  # fall back to the same effect the drag has, so the preservation check still runs
        ev("() => { __v.paneHandle('rsi').setStretchFactor(3); }"); settle(); Hu, Su = hs(), ev("__v.stretch()")
    ev("() => { __v.vc.setSeriesVisible('rsi', false); __v.vc.setSeriesVisible('rsi-sma', false); }"); settle()
    check("U: the user-resized pane collapses when hidden", hs()[2] <= 3, hs())
    ev("() => { __v.vc.setSeriesVisible('rsi', true); }"); settle()
    check("U: it returns at the size the USER set, not the default (stretch factors identical)", ev("__v.stretch()") == Su, (ev("__v.stretch()"), Su))
    check("U: ...and the layout in pixels matches (within 1px)", near(hs(), Hu), (hs(), Hu))
    ev("() => { __v.vc.setSeriesVisible('rsi-sma', true); }"); settle()

    # ---- created hidden; removal and return
    ev("() => { __v.addLine('obv-line', 'obv', 20, false); }"); settle()
    Hc = hs()
    check("C: a series created hidden gets a collapsed pane immediately (5 panes, last one a sliver)", len(Hc) == 5 and Hc[4] <= 3, Hc)
    ev("() => { __v.vc.setSeriesVisible('obv-line', true); }"); settle()
    check("C: showing it expands the new pane", hs()[4] > 40, hs())
    ev("() => { __v.vc.removeSeries('obv-line'); }"); settle()
    check("C: removing its only series deletes the pane (back to 4 panes) but the logical slot stays",
          ev("__v.paneCount()") == 4 and ev("__v.controller.panes.order") == ["price", "volume", "rsi", "macd", "obv"], ev("__v.paneCount()"))

    Sbefore = ev("__v.stretch()")
    ev("() => { __v.vc.removeSeries('rsi-sma'); __v.vc.removeSeries('rsi'); }"); settle()
    check("R: removing every series of a pane deletes it; later panes shift down in the library", ev("__v.paneCount()") == 3 and ev("__v.lwIndex('macd')") == 2)
    ev("() => { __v.addLine('rsi', 'rsi', 50); }"); settle()
    check("R: re-adding returns the pane to its logical slot (index 2, macd back at 3)", ev("__v.lwIndex('rsi')") == 2 and ev("__v.lwIndex('macd')") == 3 and ev("__v.paneCount()") == 4)
    check("R: ...at the size the user had given it before removal (stretch factors identical)", ev("__v.stretch()") == Sbefore, (ev("__v.stretch()"), Sbefore))

    # ---- guards
    msgs = ev("""(() => { const t = (f) => { try { f(); return 'no throw'; } catch (e) { return e.message; } };
      return [t(() => __v.vc.setSeriesVisible('price', false)), t(() => __v.vc.removeSeries('price')), t(() => __v.vc.setSeriesVisible('ghost', true))]; })()""")
    check("price series cannot be hidden or removed; unknown ids are refused", "permanent" in msgs[0] and "protected" in msgs[1] and "Unknown series" in msgs[2], msgs)
    check("still exactly one chart and the price pane is intact", ev("__v.roots()") == 1 and ev("__v.vc.isPaneVisible('price')") is True)
    check("no page or console errors during the whole run", not errors, errors[:3])
    browser.close()

failed = [n for n, ok in results if not ok]
print(f"\n{len(results) - len(failed)}/{len(results)} checks passed")
sys.exit(1 if failed else 0)
