import json
import unittest
from unittest.mock import patch, Mock

from backend.app import app


class DseProxyTests(unittest.TestCase):
    def setUp(self):
        self.client = app.test_client()

    def test_health_is_available_and_cors_enabled(self):
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json["ok"])
        self.assertEqual(response.headers.get("Access-Control-Allow-Origin"), "*")

    @patch("backend.app.urllib.request.urlopen")
    def test_unknown_symbol_is_rejected_without_upstream_request(self, urlopen):
        response = self.client.get("/api/market-data?symbol=https://example.com")
        self.assertEqual(response.status_code, 400)
        urlopen.assert_not_called()

    @patch("backend.app.urllib.request.urlopen")
    def test_known_symbol_returns_upstream_json(self, urlopen):
        payload = {"value_and_date": [{"date": "2026-01-02", "close_val": "100"}]}
        upstream = Mock()
        upstream.__enter__ = Mock(return_value=upstream)
        upstream.__exit__ = Mock(return_value=False)
        upstream.read.return_value = json.dumps(payload).encode("utf-8")
        urlopen.return_value = upstream

        response = self.client.get("/api/market-data?symbol=DWX")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json, payload)
        requested = urlopen.call_args.args[0]
        self.assertEqual(requested.full_url, "https://dse.sy/index/index_graph/all/DWX")

    @patch("backend.app.urllib.request.urlopen")
    def test_invalid_upstream_json_becomes_gateway_error(self, urlopen):
        upstream = Mock()
        upstream.__enter__ = Mock(return_value=upstream)
        upstream.__exit__ = Mock(return_value=False)
        upstream.read.return_value = b"<html>not json</html>"
        urlopen.return_value = upstream

        response = self.client.get("/api/market-data?symbol=DWX")
        self.assertEqual(response.status_code, 502)
        self.assertIn("invalid JSON", response.json["error"])

    def test_options_preflight(self):
        response = self.client.options("/api/market-data")
        self.assertEqual(response.status_code, 204)
        self.assertIn("GET", response.headers["Access-Control-Allow-Methods"])


if __name__ == "__main__":
    unittest.main()
