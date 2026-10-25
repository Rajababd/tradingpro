"""App-level browser check (dev server on :5173): legend on hover/touch, one chart under StrictMode, no errors."""
import re, sys
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
LEGEND = re.compile(r"^(\d{4}-\d{2}-\d{2})  O (\d+\.\d\d)  H (\d+\.\d\d)  L (\d+\.\d\d)  C (\d+\.\d\d)$")
fails = []
def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail}]" if detail and not ok else ""))
    if not ok: fails.append(name)

def sane(text):
    m = LEGEND.match(text)
    if not m: return False
    o, h, l, c = map(float, m.groups()[1:])
    return h >= max(o, c) and l <= min(o, c)

with sync_playwright() as p:
    b = p.chromium.launch()
    for name, args in {"desktop": dict(viewport={"width": 1280, "height": 800}),
                       "phone": dict(viewport={"width": 390, "height": 844}, device_scale_factor=2, is_mobile=True, has_touch=True)}.items():
        page = b.new_context(locale="en-US", **args).new_page()
        errors = []
        page.on("pageerror", lambda e, errs=errors: errs.append(str(e)))
        page.on("console", lambda m, errs=errors: errs.append(m.text) if m.type == "error" and "willReadFrequently" not in m.text else None)
        page.goto(URL)
        page.wait_for_function("document.querySelector('.status')?.textContent.includes('candles')", timeout=15000)
        page.wait_for_timeout(300)
        page.wait_for_timeout(1500)  # long enough for any spurious startup request to show up
        status = lambda: page.evaluate("document.querySelector('.status').textContent")
        count = lambda: int((re.search(r"(\d+) candles", status()) or [0, "0"])[1])
        check(f"{name}: startup loads exactly 300 candles (no spurious paging)", count() == 300, status())
        check(f"{name}: simulated data is flagged and never called Live",
              page.evaluate("!!document.querySelector('.badge-simulated')") and "Live" not in status(), status())
        check(f"{name}: exactly one chart under StrictMode", page.evaluate("document.querySelectorAll('.tv-lightweight-charts').length") == 1)
        check(f"{name}: legend never intercepts pointer events", page.evaluate("getComputedStyle(document.querySelector('[data-testid=legend]')).pointerEvents") == "none")
        check(f"{name}: legend empty before any pointer interaction", page.evaluate("document.querySelector('[data-testid=legend]').textContent") == "")

        box = page.evaluate("(() => { const r = document.querySelector('[data-testid=chart]').getBoundingClientRect(); return {x:r.left,y:r.top,w:r.width,h:r.height}; })()")
        x, y = box["x"] + box["w"] * 0.5, box["y"] + box["h"] * 0.5
        if name == "desktop":
            ok = page.wait_for_function("document.querySelector('.status').textContent.includes('Simulated feed')", timeout=8000)
            t1 = re.search(r"updated (\d\d:\d\d:\d\d)", status())
            page.wait_for_timeout(3500)
            t2 = re.search(r"updated (\d\d:\d\d:\d\d)", status())
            check("desktop: feed shows 'Simulated feed · updated HH:MM:SS' and the time advances", bool(t1 and t2 and t1[1] != t2[1]), (status(), t1 and t1[1], t2 and t2[1]))
            c0 = count()
            try:
                page.wait_for_function("parseInt(document.querySelector('.status').textContent) > %d" % c0, timeout=25000)
                grew = True
            except Exception:
                grew = False
            check("desktop: a simulated bar rolled over and the candle count grew while live", grew, (c0, status()))
            page.mouse.move(x, y); page.wait_for_timeout(150)
            text = page.evaluate("document.querySelector('[data-testid=legend]').textContent")
            check("desktop: legend shows a sane OHLC readout on hover", sane(text), repr(text))
            print(f"      legend: {text!r}")
            page.screenshot(path="/mnt/user-data/outputs/phase2_desktop.png")
            page.mouse.move(x + 60, y); page.wait_for_timeout(150)
            text2 = page.evaluate("document.querySelector('[data-testid=legend]').textContent")
            check("desktop: legend follows the pointer", sane(text2) and text2 != text, (text, text2))
            page.mouse.move(box["x"] + box["w"] + 20, y); page.wait_for_timeout(200)
            check("desktop: legend clears when the pointer leaves the chart", page.evaluate("document.querySelector('[data-testid=legend]').textContent") == "")
        else:
            # Raw touch events (Playwright's touchscreen only offers tap). Lightweight Charts enters its
            # touch crosshair on press-and-hold; a quick tap does nothing and a quick drag pans.
            cdp = page.context.new_cdp_session(page)
            legend = lambda: page.evaluate("document.querySelector('[data-testid=legend]').textContent")
            def touch(kind, px=None, py=None):
                cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [] if kind == "touchEnd" else [{"x": px, "y": py}]})
            chart_shot = lambda: page.locator("[data-testid=chart]").screenshot()

            before = chart_shot()
            touch("touchStart", x, y)
            for i in range(1, 8):
                touch("touchMove", x + i * 12, y); page.wait_for_timeout(16)
            touch("touchEnd"); page.wait_for_timeout(400)
            check("phone: a quick drag pans the chart", chart_shot() != before)
            check("phone: a quick drag does not trigger the inspect crosshair", legend() == "", repr(legend()))
            page.wait_for_timeout(1000)
            check("phone: a touch drag toward the past pages in older history (touch counts as a user gesture)", count() >= 450, status())

            touch("touchStart", x, y); page.wait_for_timeout(60); touch("touchEnd"); page.wait_for_timeout(250)
            check("phone: a quick tap shows nothing (library design)", legend() == "", repr(legend()))

            touch("touchStart", x, y); page.wait_for_timeout(600)
            held = legend()
            check("phone: press-and-hold shows a sane OHLC readout", sane(held), repr(held))
            print(f"      legend: {held!r}")
            touch("touchMove", x + 70, y); page.wait_for_timeout(150)
            slid = legend()
            check("phone: sliding while holding updates the readout", sane(slid) and slid != held, (held, slid))
            page.screenshot(path="/mnt/user-data/outputs/phase2_phone.png")
            touch("touchEnd")
        if name == "desktop":
            before = count()
            for _ in range(10):
                page.mouse.move(box["x"] + 200, y); page.mouse.down(); page.mouse.move(box["x"] + 600, y, steps=8); page.mouse.up()
                page.wait_for_timeout(500)
                if count() >= 500: break
            page.wait_for_timeout(800)
            check("desktop: dragging toward the past pages in older history", count() > before and count() >= 500, (before, status()))
            check("desktop: the older-candles loader is idle again afterwards", "Loading older" not in status() and "Could not load older" not in status(), status())
            check("desktop: still exactly one chart after paging", page.evaluate("document.querySelectorAll('.tv-lightweight-charts').length") == 1)
        check(f"{name}: no page or console errors", not errors, errors)
        page.context.close()
    b.close()
sys.exit(1 if fails else 0)
