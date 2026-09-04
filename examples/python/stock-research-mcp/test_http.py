from __future__ import annotations

import json
from pathlib import Path

import pytest
from mcp.client import Client
from solvapay.facade import create_solvapay
from starlette.testclient import TestClient

from http_serve import build_http_app, is_public_mcp_origin, mcp_auth_mode
from main import _MockClient as _MainMockClient
from main import build_server
from market_data import StubMarketData

FIXTURES = Path(__file__).parent / "fixtures"
PRODUCT = "prd_demo"
PUBLIC = "https://mcp.example.test"
API = "https://api.test"


class _MockClient(_MainMockClient):
    def __init__(self) -> None:
        super().__init__(within_limits=True)
        self.limit_calls: list[dict[str, object]] = []

    def check_limits_blocking(self, args_json: str) -> str:
        payload = json.loads(args_json)
        self.limit_calls.append(payload)
        return super().check_limits_blocking(args_json)


def _server(backend: _MockClient | None = None):
    client = backend or _MockClient()
    solvapay = create_solvapay(api_client=client)
    return build_server(
        solvapay=solvapay,
        product=PRODUCT,
        source=StubMarketData(FIXTURES),
        public_base_url=PUBLIC,
        api_base_url=API,
    )


def _app(backend: _MockClient | None = None):
    return build_http_app(
        _server(backend),
        bind_host="127.0.0.1",
        public_base_url=PUBLIC,
        api_base_url=API,
        product_ref=PRODUCT,
    )


def test_mcp_auth_mode_defaults_to_tools_call(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("MCP_AUTH_MODE", raising=False)
    assert mcp_auth_mode() == "tools-call"


def test_mcp_auth_mode_rejects_unknown(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("MCP_AUTH_MODE", "sometimes")
    with pytest.raises(RuntimeError, match="MCP_AUTH_MODE"):
        mcp_auth_mode()


def test_is_public_mcp_origin() -> None:
    assert is_public_mcp_origin("https://appmcp.your-subdomain.ngrok.app") is True
    assert is_public_mcp_origin("https://stockmcp.local.your-subdomain.ngrok.app") is True
    assert is_public_mcp_origin("http://localhost:3031") is False
    assert is_public_mcp_origin("http://127.0.0.1:3031") is False
    assert is_public_mcp_origin(None) is False


def test_health_endpoint() -> None:
    with TestClient(_app()) as client:
        response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["server"] == "stock-research-mcp"


def test_health_responds_over_real_uvicorn_socket() -> None:
    import socket
    import threading
    import time

    import httpx as httpx_client
    import uvicorn

    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.bind(("127.0.0.1", 0))
    port = sock.getsockname()[1]
    sock.close()

    def _serve() -> None:
        uvicorn.run(_app(), host="127.0.0.1", port=port, log_level="warning")

    thread = threading.Thread(target=_serve, daemon=True)
    thread.start()
    deadline = time.time() + 8
    last_error = None
    while time.time() < deadline:
        try:
            response = httpx_client.get(f"http://127.0.0.1:{port}/health", timeout=1)
            assert response.status_code == 200
            assert response.json()["server"] == "stock-research-mcp"
            return
        except Exception as err:
            last_error = err
            time.sleep(0.1)
    raise AssertionError(f"uvicorn never served /health: {last_error}")


def test_root_path_points_at_the_mcp_endpoint() -> None:
    with TestClient(_app()) as client:
        response = client.post("/", json={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
    assert response.status_code == 404
    assert response.json()["mcpEndpoint"].endswith("/mcp")


def test_oauth_discovery_documents() -> None:
    with TestClient(_app()) as client:
        protected = client.get("/.well-known/oauth-protected-resource")
        path_aware = client.get("/.well-known/oauth-protected-resource/mcp")
        authorization = client.get("/.well-known/oauth-authorization-server")
    assert protected.status_code == 200
    assert protected.json()["resource"] == f"{PUBLIC}/mcp"
    assert path_aware.status_code == 200
    assert path_aware.json()["resource"] == f"{PUBLIC}/mcp"
    assert authorization.status_code == 200
    assert authorization.json()["authorization_endpoint"] == f"{PUBLIC}/oauth/authorize"


def test_unauthenticated_tools_call_is_challenged() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 3, "method": "tools/call", "params": {"name": "top_ranked_assets"}},
        )
    assert response.status_code == 401
    assert "resource_metadata=" in response.headers["www-authenticate"]
    assert response.json()["error"]["code"] == -32001


def test_initialize_returns_json_not_empty_sse() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            "/mcp",
            headers={
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            },
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "initialize",
                "params": {
                    "protocolVersion": "2025-03-26",
                    "capabilities": {},
                    "clientInfo": {"name": "probe", "version": "0"},
                },
            },
        )
    assert response.status_code == 200
    body = response.json()
    assert body["id"] == 1
    assert body["result"]["serverInfo"]["name"] == "stock-research-mcp"


def test_cors_preflight_allows_browser_mcp_clients() -> None:
    with TestClient(_app()) as client:
        response = client.options(
            "/mcp",
            headers={
                "Origin": "https://app.mcpjam.com",
                "Access-Control-Request-Method": "POST",
                "Access-Control-Request-Headers": "content-type,accept,mcp-protocol-version",
            },
        )
    assert response.status_code == 200
    assert response.headers.get("access-control-allow-origin") == "*"
    allow_headers = response.headers.get("access-control-allow-headers", "").lower()
    assert "content-type" in allow_headers or allow_headers == "*"


def test_cors_exposes_mcp_session_id() -> None:
    with TestClient(_app()) as client:
        response = client.post(
            "/mcp",
            headers={
                "Origin": "https://app.mcpjam.com",
                "Accept": "application/json, text/event-stream",
                "Content-Type": "application/json",
            },
            json={
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {"name": "top_ranked_assets"},
            },
        )
    assert response.status_code == 401
    assert response.headers.get("access-control-allow-origin") == "*"
    expose = response.headers.get("access-control-expose-headers", "").lower()
    assert "mcp-session-id" in expose
    assert "www-authenticate" in expose


@pytest.mark.asyncio
async def test_in_process_lists_builtins_and_bills_token_customer() -> None:
    from solvapay_mcp.register import reset_request_customer_ref, set_request_customer_ref

    backend = _MockClient()
    server = _server(backend)
    token = set_request_customer_ref("cus_from_token")
    try:
        async with Client(server) as mcp_client:
            listed = await mcp_client.list_tools()
            names = [tool.name for tool in listed.tools]
            assert "top_ranked_assets" in names
            assert "upgrade" in names
            result = await mcp_client.call_tool("top_ranked_assets", {})
    finally:
        reset_request_customer_ref(token)
    data = result.structured_content
    assert data is not None
    assert len(data["stocks"]) == 5
    assert backend.limit_calls[0]["customerRef"] == "cus_from_token"
    assert all(call["customerRef"] != "anonymous" for call in backend.limit_calls)
