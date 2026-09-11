from __future__ import annotations

import json

import httpx
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay
from starlette.applications import Starlette

from solvapay_mcp.asgi.mcp_engine import create_mcp_engine_route
from solvapay_mcp.register import register_payable_tool
from solvapay_mcp.response_context import ResponseContext
from solvapay_mcp.server.engine import bind_engine
from solvapay_mcp.widget import default_mcp_app_html
from tests.server.recording_client import RecordingClient


async def test_starlette_engine_returns_mcp_dispatch_rpc() -> None:
    client = RecordingClient(
        {
            "mcp_dispatch": {
                "kind": "rpc",
                "rpc": {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}},
            }
        }
    )
    solvapay = create_solvapay(api_client=client)
    server: Server[object] = Server("engine")
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        resource_uri="ui://widget.html",
    )
    app = Starlette(routes=[create_mcp_engine_route(server)])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
    assert response.status_code == 200
    assert response.json() == {"jsonrpc": "2.0", "id": 1, "result": {"ok": True}}
    assert client.calls[0][0] == "mcp_dispatch"
    payload = client.calls[0][1]
    assert payload["rpc"]["method"] == "tools/list"
    assert json.dumps(payload["config"]["payableTools"]) == "[]"


async def test_starlette_engine_forwards_payable_descriptors() -> None:
    client = RecordingClient(
        {
            "mcp_dispatch": {
                "kind": "rpc",
                "rpc": {"jsonrpc": "2.0", "id": 1, "result": {"tools": []}},
            }
        }
    )
    solvapay = create_solvapay(api_client=client)
    server: Server[object] = Server("engine")
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        resource_uri="ui://widget.html",
    )

    async def handler(args: dict[str, object], ctx: ResponseContext) -> object:
        del args, ctx
        return {"ok": True}

    register_payable_tool(
        server,
        "echo_paid",
        solvapay=solvapay,
        product="prd_demo",
        title="Echo paid",
        description="Echo arguments after a paid gate",
        input_schema={"type": "object", "properties": {"n": {"type": "number"}}},
        handler=handler,
    )
    app = Starlette(routes=[create_mcp_engine_route(server)])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
    assert response.status_code == 200
    payload = client.calls[0][1]
    assert payload["config"]["payableTools"] == [
        {
            "name": "echo_paid",
            "title": "Echo paid",
            "description": "Echo arguments after a paid gate",
            "inputSchema": {"type": "object", "properties": {"n": {"type": "number"}}},
        }
    ]


async def test_starlette_engine_resources_read_returns_widget_html() -> None:
    client = RecordingClient(
        {
            "mcp_dispatch": {
                "kind": "rpc",
                "rpc": {"jsonrpc": "2.0", "id": 1, "result": {"contents": []}},
            }
        }
    )
    solvapay = create_solvapay(api_client=client)
    server: Server[object] = Server("engine")
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        resource_uri="ui://widget.html",
    )
    app = Starlette(routes=[create_mcp_engine_route(server)])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": {"uri": "ui://widget.html"},
            },
        )
    assert response.status_code == 200
    text = response.json()["result"]["contents"][0]["text"]
    assert text.strip().startswith("<")
    assert text == default_mcp_app_html()
    csp = response.json()["result"]["contents"][0]["_meta"]["ui"]["csp"]
    assert "resourceDomains" in csp
    assert client.calls == []


async def test_starlette_engine_resources_read_stamps_modern_catalog_envelope() -> None:
    client = RecordingClient(
        {
            "mcp_dispatch": {
                "kind": "rpc",
                "rpc": {"jsonrpc": "2.0", "id": 1, "result": {"contents": []}},
            }
        }
    )
    solvapay = create_solvapay(api_client=client)
    server: Server[object] = Server("engine")
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref="prd_demo",
        public_base_url="https://mcp.example",
        resource_uri="ui://widget.html",
    )
    app = Starlette(routes=[create_mcp_engine_route(server)])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": {
                    "uri": "ui://widget.html",
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {},
                    },
                },
            },
        )
    assert response.status_code == 200
    result = response.json()["result"]
    assert result["resultType"] == "complete"
    assert result["ttlMs"] == 60_000
    assert result["cacheScope"] == "public"
    assert result["contents"][0]["text"] == default_mcp_app_html()
    assert client.calls == []


async def test_starlette_engine_never_returns_stack_trace() -> None:
    server: Server[object] = Server("unbound")
    app = Starlette(routes=[create_mcp_engine_route(server)])
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="https://mcp.example") as http:
        response = await http.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}},
        )
    assert response.status_code == 200
    assert "application/json" in response.headers["content-type"]
    body = response.json()
    assert body["error"]["code"] == -32603
    assert "/Users/" not in response.text
    assert "solvapay_mcp" not in response.text
