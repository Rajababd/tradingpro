#!/usr/bin/env python3
"""Exercise the actual local Flask proxy against each live DSE endpoint."""
import json
import urllib.request

SYMBOLS = ("DWX", "AVOC", "ABC", "BBSY", "NIB", "AHT")
BASE = "http://127.0.0.1:5000/api/market-data?symbol="


def rows_from(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return []
    for key in ("data", "value_and_date", "values", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested_key in ("value_and_date", "data", "values", "rows"):
                if isinstance(value.get(nested_key), list):
                    return value[nested_key]
    return []


def numeric(*values):
    for value in values:
        try:
            text = str(value).replace(",", "").strip()
            if text:
                return float(text)
        except (TypeError, ValueError):
            pass
    return None


def valid_ohlc(row):
    if not isinstance(row, dict):
        return False
    date = row.get("date") or row.get("trading_date") or row.get("timestamp")
    if not isinstance(date, str) or len(date) < 10:
        return False
    opening = numeric(row.get("open"), row.get("open_val"))
    high = numeric(row.get("high"), row.get("max_val"))
    low = numeric(row.get("low"), row.get("min_val"))
    close = numeric(row.get("close"), row.get("close_val"), row.get("value"), row.get("average_price"))
    if None in (opening, high, low, close) or min(opening, high, low, close) <= 0:
        return False
    return high >= max(opening, close, low) and low <= min(opening, close)


with urllib.request.urlopen("http://127.0.0.1:5000/api/health", timeout=5) as response:
    if response.status != 200 or not json.loads(response.read()).get("ok"):
        raise SystemExit("Local proxy health check failed")

for symbol in SYMBOLS:
    request = urllib.request.Request(BASE + symbol, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=30) as response:
        if response.status != 200:
            raise SystemExit(f"{symbol}: proxy returned HTTP {response.status}")
        payload = json.loads(response.read())
    rows = rows_from(payload)
    count = sum(1 for row in rows if valid_ohlc(row))
    print(f"{symbol}: proxy HTTP 200; {len(rows)} source rows; {count} valid OHLC candles")
    if count == 0:
        raise SystemExit(f"{symbol}: proxy returned no valid OHLC candles")
