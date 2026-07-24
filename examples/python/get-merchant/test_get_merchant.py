"""Offline coverage for the get-merchant example against a local mock server."""

from __future__ import annotations

import threading
from http.server import BaseHTTPRequestHandler, HTTPServer

from solvapay._solvapay import SolvaPayClient

from get_merchant import run


class _Handler(BaseHTTPRequestHandler):
    paths: list[str] = []

    def do_GET(self) -> None:  # noqa: N802
        _Handler.paths.append(self.path)
        body = b'{"displayName":"Example Merchant","defaultCurrency":"usd"}'
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args: object) -> None:
        pass


def test_run_returns_get_merchant_fields() -> None:
    _Handler.paths = []
    server = HTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        client = SolvaPayClient("sk_test", f"http://127.0.0.1:{server.server_address[1]}")
        merchant = run(client)
    finally:
        server.shutdown()
        thread.join()
    assert merchant["displayName"] == "Example Merchant"
    assert merchant["defaultCurrency"] == "usd"
    assert _Handler.paths == ["/v1/sdk/merchant"]
