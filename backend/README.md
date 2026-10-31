# TradingPro DSE proxy

The frontend calls this API only when the user presses **تحديث البيانات**:

- `GET /api/health` — health check
- `GET /api/market-data?symbol=DWX` — returns the original DSE JSON payload for an allowlisted symbol

The proxy deliberately does not accept arbitrary URLs. It uses the fixed endpoint allowlist in `app.py`, a 20-second upstream timeout, an 8 MiB response limit, and JSON shape validation. It forwards no browser cookies or credentials.

## Local development

Requires Python 3.10+.

```sh
python -m venv .venv
. .venv/bin/activate
pip install -r backend/requirements.txt
python backend/app.py
```

In a second terminal, run `npm install` and `npm run dev`. Vite proxies `/api/*` to `http://127.0.0.1:5000`.

## Deploying the API separately

1. Deploy `backend/app.py` to a Python web host that supports Flask/WSGI, installing `backend/requirements.txt`.
2. Configure the WSGI entry point to import `app` from `backend/app.py` (add the repository root to `sys.path` first if the host requires it).
3. Set `TRADINGPRO_ALLOWED_ORIGINS` to the comma-separated frontend origins, for example `https://your-frontend.example`. Leave it unset only if the endpoint is intentionally public and read-only.
4. Check `https://your-api.example/api/health` returns JSON.
5. Build the frontend with `VITE_DSE_API_BASE_URL=https://your-api.example/api/market-data`. The value is baked into the frontend build; rebuild after changing it.
6. In a browser, press **تحديث البيانات** and verify all six symbols individually. The GitHub Actions diagnostic checks DSE upstream availability, but only a request through the deployed proxy and frontend verifies the whole path.

Do not expose an arbitrary URL-forwarding endpoint. Keep the symbol allowlist fixed. This service returns historical daily data; it is not a live/intraday market feed.
