#!/usr/bin/env python3
"""Read-only diagnostic for the six configured DSE history endpoints.

Reports HTTP reachability, response type/shape, and CORS headers without printing market values.
This is a network diagnostic, not a replacement for testing from the deployed browser origin.
"""
import json
import urllib.error
import urllib.request

ENDPOINTS = {
    "DWX": "https://dse.sy/index/index_graph/all/DWX",
    "AVOC": "https://dse.sy/issuer-company/graph/14/all/line",
    "ABC": "https://dse.sy/issuer-company/graph/95/all/line",
    "BBSY": "https://dse.sy/issuer-company/graph/84/all/line",
    "NIB": "https://dse.sy/issuer-company/graph/96/all/line",
    "AHT": "https://dse.sy/issuer-company/graph/1/all/line",
}


def extract_rows(payload):
    if isinstance(payload, list):
        return payload
    if not isinstance(payload, dict):
        return None
    for key in ("data", "value_and_date", "values", "rows"):
        value = payload.get(key)
        if isinstance(value, list):
            return value
        if isinstance(value, dict):
            for nested_key in ("value_and_date", "data", "values", "rows"):
                nested = value.get(nested_key)
                if isinstance(nested, list):
                    return nested
    return None


def ohlc_stats(rows):
    stats = {"valid": 0, "missing_or_unparseable": 0, "inconsistent": 0}
    def numeric(value):
        try:
            text = str(value).replace(",", "").strip()
            return float(text) if text else None
        except (TypeError, ValueError):
            return None
    def first_numeric(*values):
        for value in values:
            parsed = numeric(value)
            if parsed is not None:
                return parsed
        return None
    for row in rows or []:
        if not isinstance(row, dict):
            stats["missing_or_unparseable"] += 1
            continue
        date = row.get("date") or row.get("trading_date") or row.get("timestamp")
        open_price = first_numeric(row.get("open"), row.get("open_val"))
        high = first_numeric(row.get("high"), row.get("max_val"))
        low = first_numeric(row.get("low"), row.get("min_val"))
        close = first_numeric(row.get("close"), row.get("close_val"), row.get("value"), row.get("average_price"))
        if not isinstance(date, str) or len(date) < 10 or None in (open_price, high, low, close):
            stats["missing_or_unparseable"] += 1
            continue
        if high < max(open_price, close, low) or low > min(open_price, close):
            stats["inconsistent"] += 1
            continue
        stats["valid"] += 1
    return stats


for symbol, url in ENDPOINTS.items():
    print(f"\n[{symbol}] {url}")
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "application/json",
            "Origin": "https://tradingpro-check.invalid",
            "User-Agent": "TradingPro-DSE-diagnostic/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=20) as response:
            body = response.read()
            content_type = response.headers.get("Content-Type", "")
            allow_origin = response.headers.get("Access-Control-Allow-Origin", "(missing)")
            allow_methods = response.headers.get("Access-Control-Allow-Methods", "(missing)")
            print(f"HTTP: {response.status}")
            print(f"Content-Type: {content_type or '(missing)'}")
            print(f"Access-Control-Allow-Origin: {allow_origin}")
            print(f"Access-Control-Allow-Methods: {allow_methods}")
            try:
                payload = json.loads(body)
            except (json.JSONDecodeError, UnicodeDecodeError):
                print(f"JSON: invalid (body length {len(body)} bytes)")
                continue
            rows = extract_rows(payload)
            print(f"Root shape: {'array' if isinstance(payload, list) else type(payload).__name__}")
            print(f"Historical rows: {len(rows) if rows is not None else '(no recognized array)'}")
            stats = ohlc_stats(rows)
            print(f"OHLC rows: {stats['valid']} valid; {stats['missing_or_unparseable']} missing/unparseable; {stats['inconsistent']} internally inconsistent")
            if rows and isinstance(rows[0], dict):
                print("First row keys: " + ", ".join(sorted(rows[0].keys())))
            if stats["valid"] == 0:
                raise SystemExit(f"{symbol}: endpoint returned no parseable OHLC candles")
    except urllib.error.HTTPError as error:
        print(f"HTTP: {error.code}")
        print(f"Content-Type: {error.headers.get('Content-Type', '(missing)')}")
        print(f"Access-Control-Allow-Origin: {error.headers.get('Access-Control-Allow-Origin', '(missing)')}")
        print(f"Request failed: {error.reason}")
    except Exception as error:  # Network, TLS, timeout, or DNS failure.
        print(f"Request failed: {type(error).__name__}: {error}")
