from __future__ import annotations

import json

import httpx
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay
from starlette.applications import Starlette

from solvapay_mcp.asgi.mcp_engine import create_mcp_engine_route
from solvapay_mcp.server.engine import bind_engine
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
