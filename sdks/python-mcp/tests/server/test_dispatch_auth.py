from __future__ import annotations

import base64
import json
import logging

from mcp.client import Client
from solvapay.facade import create_solvapay
from tests.server.recording_client import RecordingClient

from solvapay_mcp.register import reset_request_auth_header, set_request_auth_header
from solvapay_mcp.server.factory import create_solvapay_mcp_server
from solvapay_mcp.widget import RESOURCE_URI_META_KEY


def _bearer(*, customer_ref: str = "cus_live") -> str:
    body = (
        base64.urlsafe_b64encode(json.dumps({"customerRef": customer_ref}).encode())
        .rstrip(b"=")
        .decode()
    )
    return f"Bearer e30.{body}.sig"


def _widget_dispatch(payload: dict[str, object]) -> dict[str, object]:
    return {
        "kind": "rpc",
        "rpc": {
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "content": [{"type": "text", "text": "Opened your Demo account."}],
                "structuredContent": {"view": "account", "productRef": "prd_demo"},
                "_meta": {
                    "ui": {"resourceUri": "ui://solvapay/mcp-app.html"},
                    RESOURCE_URI_META_KEY: "ui://solvapay/mcp-app.html",
                },
            },
        },
    }


def _server(client: RecordingClient):
    return create_solvapay_mcp_server(
        solvapay=create_solvapay(api_client=client),
        product_ref="prd_demo",
        public_base_url="https://appmcp.example",
        api_base_url="https://api.example",
    )


async def test_manage_account_forwards_bearer_to_generated_mcp_dispatch() -> None:
    captured: list[dict[str, object]] = []

    def mcp_dispatch(payload: dict[str, object]) -> dict[str, object]:
        captured.append(payload)
        return _widget_dispatch(payload)

    backend = RecordingClient({"mcp_dispatch": mcp_dispatch})
    header = _bearer()
    token = set_request_auth_header(header)
    try:
        async with Client(_server(backend)) as mcp:
            result = await mcp.call_tool("manage_account", {})
    finally:
        reset_request_auth_header(token)

    assert captured, "generated mcpDispatch was not invoked"
    assert captured[0].get("authHeader") == header
    assert result.is_error is not True
    meta = result.meta or {}
    ui = meta.get("ui") if isinstance(meta, dict) else None
    assert isinstance(ui, dict)
    assert ui.get("resourceUri") == "ui://solvapay/mcp-app.html"
    assert meta.get(RESOURCE_URI_META_KEY) == "ui://solvapay/mcp-app.html"
    assert result.structured_content is not None
    assert result.structured_content["view"] == "account"


async def test_intent_tool_forces_ui_mode_unless_text() -> None:
    captured: list[dict[str, object]] = []

    def mcp_dispatch(payload: dict[str, object]) -> dict[str, object]:
        captured.append(payload)
        return _widget_dispatch(payload)

    backend = RecordingClient({"mcp_dispatch": mcp_dispatch})
    header = _bearer()
    token = set_request_auth_header(header)
    try:
        async with Client(_server(backend)) as mcp:
            await mcp.call_tool("upgrade", {"mode": "auto"})
    finally:
        reset_request_auth_header(token)

    assert captured, "generated mcpDispatch was not invoked"
    rpc = captured[0].get("rpc")
    assert isinstance(rpc, dict)
    params = rpc.get("params")
    assert isinstance(params, dict)
    arguments = params.get("arguments")
    assert isinstance(arguments, dict)
    assert arguments.get("mode") == "ui"


async def test_tool_call_logs_the_tool_name(caplog: logging.LogCaptureFixture) -> None:
    caplog.set_level(logging.INFO, logger="solvapay")
    backend = RecordingClient({"mcp_dispatch": _widget_dispatch})
    header = _bearer()
    token = set_request_auth_header(header)
    try:
        async with Client(_server(backend)) as mcp:
            await mcp.call_tool("upgrade", {})
    finally:
        reset_request_auth_header(token)
    assert "[solvapay] tools/call upgrade" in caplog.text
