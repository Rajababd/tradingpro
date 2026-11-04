"""End-to-end acceptance tests for portable backups and additive market-data imports."""
import json
import sys
from datetime import date, timedelta
from playwright.sync_api import sync_playwright

URL = "http://127.0.0.1:5173/"
failures = []

def check(name, ok, detail=""):
    print(("PASS " if ok else "FAIL ") + name + (f" [{detail}]" if detail and not ok else ""))
    if not ok: failures.append(name)

with sync_playwright() as p:
    browser = p.chromium.launch()
    context = browser.new_context(viewport={"width": 390, "height": 844}, is_mobile=True, has_touch=True, accept_downloads=True)
    page = context.new_page()
    daily = []
    start = date(2025, 1, 1)
    for i in range(400):
        opening = 100 + i
        daily.append({
            "date": (start + timedelta(days=i)).isoformat(),
            "open": str(opening), "high": str(opening + 2), "low": str(opening - 1),
            "close": str(opening + 1), "volume_traded": "1000", "value_traded": "100000",
        })
    requested = []
    def mock_dse(route):
        requested.append(route.request.url)
        payload = daily
        if "symbol=DWX" in route.request.url:
            payload = {"value_and_date": [{
                "date": r["date"], "open_val": r["open"], "max_val": r["high"],
                "min_val": r["low"], "close_val": r["close"], "traded_volume": r["volume_traded"],
                "value_traded": r["value_traded"],
            } for r in daily]}
        route.fulfill(status=200, content_type="application/json", body=json.dumps(payload))
    page.route("**/api/market-data**", mock_dse)
    page.goto(URL)
    page.get_by_role("button", name="تحديث البيانات").click()
    page.wait_for_function("window.__tradingpro?.service.getState().status === 'ready' && window.__tradingpro.service.candles.length > 0", timeout=30000)
    page.locator(".topbar select").select_option("BBSY")
    page.wait_for_function("window.__tradingpro?.service.getState().status === 'ready' && window.__tradingpro.service.candles.length > 0", timeout=10000)

    # Export only drawings and check the generated file's self-describing format.
    page.get_by_role("button", name="تصدير البيانات").click()
    switches = page.get_by_role("switch")
    check("export dialog exposes two independent toggles", switches.count() == 2)
    switches.nth(0).uncheck()
    with page.expect_download() as download_info:
        page.get_by_role("button", name="تصدير", exact=True).click()
    download = download_info.value
    path = "/tmp/" + download.suggested_filename
    download.save_as(path)
    with open(path, encoding="utf-8") as f: drawing_export = json.load(f)
    check("drawing export is a versioned JSON file", drawing_export.get("format") == "tradingpro-drawings" and drawing_export.get("version") == 1)

    page.get_by_role("button", name="تصدير البيانات").click()
    with page.expect_download() as market_download_info:
        page.get_by_role("button", name="تصدير", exact=True).click()
    market_download = market_download_info.value
    market_path = "/tmp/" + market_download.suggested_filename
    market_download.save_as(market_path)
    with open(market_path, encoding="utf-8") as f: market_export = json.load(f)
    check("market export is a versioned database containing all six symbols",
          market_export.get("format") == "tradingpro-market-database" and
          set(market_export.get("symbols", {})) == {"DWX", "AVOC", "ABC", "BBSY", "NIB", "AHT"})

    # Import a duplicate date with a conflicting close plus one genuinely new date.
    import_payload = {
        "format": "tradingpro-market-database", "version": 1, "exportedAt": "2026-11-04T00:00:00.000Z",
        "symbols": {"BBSY": [
            {"date": daily[0]["date"], "open": 101, "high": 1001, "low": 100, "close": 999,
             "volume": 999, "valueTraded": 999},
            {"date": "2027-01-01", "open": 200, "high": 202, "low": 199, "close": 201,
             "volume": 10, "valueTraded": 2000},
        ]},
    }
    page.get_by_role("button", name="استيراد البيانات").click()
    page.get_by_role("button", name="استيراد بيانات الأسهم").click()
    page.get_by_role("button", name="تأكيد واختيار الملف").click()
    page.locator("input[type=file]").nth(0).set_input_files({
        "name": "update.json", "mimeType": "application/json", "buffer": json.dumps(import_payload).encode(),
    })
    page.wait_for_function("""() => {
      const rows = JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY') || '[]');
      return rows.some(r => r.date === '2027-01-01');
    }""", timeout=10000)
    cached = page.evaluate("JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY'))")
    duplicate = next(r for r in cached if r["date"] == daily[0]["date"])
    check("update import adds a date absent from the existing database", any(r["date"] == "2027-01-01" for r in cached))
    check("update import does not overwrite a duplicate date", duplicate["close"] == float(daily[0]["close"]), duplicate)

    # Top-bar network refresh must use the exact same additive date policy.
    page.get_by_role("button", name="تحديث البيانات").click()
    page.wait_for_function("window.__tradingpro?.service.getState().status === 'ready'", timeout=30000)
    page.wait_for_function("""() => {
      const rows = JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY') || '[]');
      return rows.some(r => r.date === '2027-01-01');
    }""", timeout=10000)
    after_refresh = page.evaluate("JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY'))")
    duplicate_after_refresh = next(r for r in after_refresh if r["date"] == daily[0]["date"])
    check("top-bar refresh preserves imported dates not returned by the server", any(r["date"] == "2027-01-01" for r in after_refresh))
    check("top-bar refresh also leaves duplicate-date candles unchanged", duplicate_after_refresh["close"] == float(daily[0]["close"]))

    # Restore drawings from a plain-text JSON file.
    drawing_payload = {
        "format": "tradingpro-drawings", "version": 1, "exportedAt": "2026-11-04T00:00:00.000Z",
        "drawings": [{"symbol": "BBSY", "timeframe": "1D", "items": [{
            "id": "restored-trendline", "type": "trend-line", "seriesId": "price", "paneIndex": 0,
            "anchors": [{"time": 1735689600, "price": 100}, {"time": 1735776000, "price": 105}],
            "style": {}, "options": {},
        }]}],
    }
    page.get_by_role("button", name="استيراد البيانات").click()
    page.get_by_role("button", name="استيراد الأشكال المرسومة").click()
    page.locator("input[type=file]").nth(1).set_input_files({
        "name": "drawings.txt", "mimeType": "text/plain", "buffer": json.dumps(drawing_payload).encode(),
    })
    page.wait_for_function("window.__tradingpro.chart.drawings.export().some(d => d.id === 'restored-trendline')", timeout=10000)
    check("drawing text import restores the active chart drawing", True)

    # Replace the full reference database with a one-row BBSY database.
    replacement = {
        "format": "tradingpro-market-database", "version": 1,
        "symbols": {"BBSY": [{"date": "2030-01-01", "open": 50, "high": 52, "low": 49, "close": 51,
                              "volume": 1, "valueTraded": 51}]},
    }
    page.get_by_role("button", name="استيراد البيانات").click()
    page.get_by_role("button", name="استيراد بيانات الأسهم").click()
    page.get_by_role("radio", name="جلب قاعدة بيانات").check()
    page.get_by_role("button", name="تأكيد واختيار الملف").click()
    page.locator("input[type=file]").nth(0).set_input_files({
        "name": "reference.json", "mimeType": "application/json", "buffer": json.dumps(replacement).encode(),
    })
    page.wait_for_function("""() => {
      const rows = JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY') || '[]');
      return rows.length === 1 && rows[0].date === '2030-01-01';
    }""", timeout=10000)
    check("get database replaces the local reference history", page.evaluate("JSON.parse(localStorage.getItem('tradingpro:dse:daily:v1:BBSY')).length") == 1)
    check("get database removes symbols absent from the supplied reference file", page.evaluate("localStorage.getItem('tradingpro:dse:daily:v1:DWX') === null"))

    context.close()
    browser.close()

sys.exit(1 if failures else 0)
