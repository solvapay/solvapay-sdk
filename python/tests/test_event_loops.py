"""One async client used from several event loops.

httpx.AsyncClient keeps its connections on the loop that opened them, so a
SolvaPay instance created once and used from a second loop (asyncio.run()
twice, or a test client that starts a loop per request) must not reuse them.
This needs real sockets: a mocked transport has no connections to go stale.
"""

from __future__ import annotations

import asyncio
import json
import threading
from collections.abc import Iterator
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import httpx
import pytest

from solvapay import AsyncApiClient


class _Merchant(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"  # keep-alive, so the pool keeps a connection

    def do_GET(self) -> None:
        body = json.dumps({"displayName": "Acme", "legalName": "Acme Ltd"}).encode()
        self.send_response(200)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *args: object) -> None:
        pass


@pytest.fixture
def base_url() -> Iterator[str]:
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Merchant)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{server.server_address[1]}"
    server.shutdown()
    server.server_close()


def test_one_client_works_across_event_loops(base_url: str) -> None:
    api = AsyncApiClient(api_key="sk_sandbox_test", api_base_url=base_url)

    async def name() -> str:
        return (await api.get_merchant()).display_name

    assert asyncio.run(name()) == "Acme"
    assert asyncio.run(name()) == "Acme"  # a new loop: failed with "Event loop is closed"
    asyncio.run(api.aclose())


def test_a_client_passed_in_is_used_as_given(base_url: str) -> None:
    async def run() -> None:
        given = httpx.AsyncClient()
        api = AsyncApiClient(api_key="sk_sandbox_test", api_base_url=base_url, http_client=given)
        await api.get_merchant()
        await api.aclose()
        assert given.is_closed

    asyncio.run(run())
