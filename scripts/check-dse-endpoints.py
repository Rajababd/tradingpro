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
            if rows and isinstance(rows[0], dict):
                print("First row keys: " + ", ".join(sorted(rows[0].keys())))
    except urllib.error.HTTPError as error:
        print(f"HTTP: {error.code}")
        print(f"Content-Type: {error.headers.get('Content-Type', '(missing)')}")
        print(f"Access-Control-Allow-Origin: {error.headers.get('Access-Control-Allow-Origin', '(missing)')}")
        print(f"Request failed: {error.reason}")
    except Exception as error:  # Network, TLS, timeout, or DNS failure.
        print(f"Request failed: {type(error).__name__}: {error}")
