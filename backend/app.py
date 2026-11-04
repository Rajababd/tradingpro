"""Small allowlisted proxy for the public DSE historical market-data endpoints.

Deploy this Flask app separately (for example on PythonAnywhere) and configure
VITE_DSE_API_BASE_URL in the frontend build to point to /api/market-data on it.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from flask import Flask, jsonify, request, make_response

app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = 1 * 1024 * 1024

SOURCES = {
    "DWX": "https://dse.sy/index/index_graph/all/DWX",
    "AVOC": "https://dse.sy/issuer-company/graph/14/all/line",
    "ABC": "https://dse.sy/issuer-company/graph/95/all/line",
    "BBSY": "https://dse.sy/issuer-company/graph/84/all/line",
    "NIB": "https://dse.sy/issuer-company/graph/96/all/line",
    "AHT": "https://dse.sy/issuer-company/graph/1/all/line",
}
MAX_UPSTREAM_BYTES = 8 * 1024 * 1024
ALLOWED_ORIGINS = {
    origin.strip()
    for origin in os.environ.get("TRADINGPRO_ALLOWED_ORIGINS", "").split(",")
    if origin.strip()
}


@app.after_request
def cors_headers(response):
    origin = request.headers.get("Origin")
    # Public, read-only market data: wildcard is safe here because no credentials
    # are accepted or forwarded. Set TRADINGPRO_ALLOWED_ORIGINS for production.
    if not ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = "*"
    elif origin in ALLOWED_ORIGINS:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
    response.headers["Access-Control-Allow-Methods"] = "GET, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Accept, Content-Type"
    response.headers["Cache-Control"] = "no-store"
    return response


@app.get("/api/health")
def health():
    return jsonify({"ok": True, "service": "TradingPro DSE proxy"})


@app.route("/api/market-data", methods=["GET", "OPTIONS"])
def market_data():
    if request.method == "OPTIONS":
        return make_response("", 204)

    symbol = request.args.get("symbol", "").strip().upper()
    upstream_url = SOURCES.get(symbol)
    if upstream_url is None:
        return jsonify({"error": "Unsupported symbol. Allowed symbols: " + ", ".join(SOURCES)}), 400

    upstream_request = urllib.request.Request(
        upstream_url,
        headers={
            "Accept": "application/json",
            "User-Agent": "TradingPro-MarketData/1.0",
        },
        method="GET",
    )
    try:
        with urllib.request.urlopen(upstream_request, timeout=20) as upstream:
            body = upstream.read(MAX_UPSTREAM_BYTES + 1)
            if len(body) > MAX_UPSTREAM_BYTES:
                return jsonify({"error": "DSE response exceeded the 8 MiB safety limit."}), 502
            payload = json.loads(body.decode("utf-8"))
    except urllib.error.HTTPError as error:
        return jsonify({"error": f"DSE returned HTTP {error.code}."}), 502
    except (urllib.error.URLError, TimeoutError, OSError):
        return jsonify({"error": "Could not reach the DSE upstream endpoint. Try again later."}), 502
    except (json.JSONDecodeError, UnicodeDecodeError):
        return jsonify({"error": "DSE returned an invalid JSON response."}), 502

    if not isinstance(payload, (list, dict)):
        return jsonify({"error": "DSE returned an unsupported JSON shape."}), 502
    return jsonify(payload)


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=5000, debug=False)
