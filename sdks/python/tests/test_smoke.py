"""Step 40 hello-world smoke: version, webhook, async + blocking client."""

from __future__ import annotations

import hashlib
import hmac
import json
import threading
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

import pytest

from solvapay import SolvaPayClient, SolvaPayError, verify_webhook, version

# Body matches the frozen Step-4 accept fixture; smoke signs with wall clock.
FIXTURE_BODY = (
    '{"type":"purchase.created","id":"evt_fixture_1","created":1782864000,'
    '"api_version":"2025-10-01","data":{"object":{"id":"pur_fixture_1"},'
    '"previous_attributes":null},"livemode":false,"request":{"id":null,'
    '"idempotency_key":null}}'
)
FIXTURE_SECRET = "whsec_test_fixture_secret"

MERCHANT_JSON = b'{"displayName":"Smoke Merchant","defaultCurrency":"USD"}'


def _sign(body: str, secret: str, now: int) -> str:
    signed = f"{now}.{body}".encode()
    digest = hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return f"t={now},v1={digest}"


def test_version_matches_crate() -> None:
    assert version() == "0.1.0"


def test_verify_webhook_accepts_fresh_signature() -> None:
    now = int(time.time())
    sig = _sign(FIXTURE_BODY, FIXTURE_SECRET, now)
    raw = verify_webhook(FIXTURE_BODY, sig, FIXTURE_SECRET)
    value = json.loads(raw)
    assert value["type"] == "purchase.created"
    assert value["id"] == "evt_fixture_1"


def test_verify_webhook_rejects_bad_signature() -> None:
    now = int(time.time())
    bad_sig = f"t={now},v1={'f' * 64}"
    with pytest.raises(SolvaPayError) as exc_info:
        verify_webhook(FIXTURE_BODY, bad_sig, FIXTURE_SECRET)
    err = exc_info.value
    assert getattr(err, "code", None) == "invalid_signature"


class _MerchantHandler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        if self.path.rstrip("/") == "/v1/sdk/merchant":
            self.send_response(200)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(MERCHANT_JSON)))
            self.end_headers()
            self.wfile.write(MERCHANT_JSON)
            return
        self.send_response(404)
        self.end_headers()

    def log_message(self, format: str, *args: object) -> None:  # noqa: A003
        return


@pytest.fixture()
def mock_api() -> str:
    server = HTTPServer(("127.0.0.1", 0), _MerchantHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    host, port = server.server_address
    base = f"http://{host}:{port}"
    try:
        yield base
    finally:
        server.shutdown()
        thread.join(timeout=2)


@pytest.mark.asyncio
async def test_get_merchant_async_round_trip(mock_api: str) -> None:
    client = SolvaPayClient("sk_test_smoke", mock_api)
    envelope = json.loads(await client.get_merchant("{}"))
    assert envelope["ok"] is True
    assert envelope["value"]["displayName"] == "Smoke Merchant"


def test_get_merchant_blocking_round_trip(mock_api: str) -> None:
    client = SolvaPayClient("sk_test_smoke", mock_api)
    envelope = json.loads(client.get_merchant_blocking("{}"))
    assert envelope["ok"] is True
    assert envelope["value"]["displayName"] == "Smoke Merchant"


@pytest.mark.asyncio
async def test_async_and_blocking_match(mock_api: str) -> None:
    client = SolvaPayClient("sk_test_smoke", mock_api)
    blocking = client.get_merchant_blocking("{}")
    async_env = await client.get_merchant("{}")
    assert json.loads(blocking) == json.loads(async_env)
