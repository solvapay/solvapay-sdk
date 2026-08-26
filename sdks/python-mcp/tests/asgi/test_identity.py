from __future__ import annotations

import json

from mcp.client import Client
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay
from tests.mcp_authoring.mock_backend import MockBackend

from solvapay_mcp.register import (
    register_payable_tool,
    reset_request_customer_ref,
    set_request_customer_ref,
)
from solvapay_mcp.response_context import ResponseContext


class RecordingBackend(MockBackend):
    def __init__(self) -> None:
        super().__init__(
            {
                "withinLimits": True,
                "remaining": 5,
                "meterName": "requests",
                "checkoutUrl": "https://pay.example/x",
            }
        )
        self.limit_calls: list[dict[str, object]] = []

    def check_limits_blocking(self, args_json: str) -> str:
        payload = json.loads(args_json)
        self.limit_calls.append(payload)
        return super().check_limits_blocking(args_json)


async def _echo(_args: dict[str, object], ctx: ResponseContext) -> object:
    return ctx.respond({"ok": True, "customer": ctx.customer["ref"]})


async def test_bearer_authenticated_tools_call_bills_token_customer() -> None:
    backend = RecordingBackend()
    solvapay = create_solvapay(api_client=backend)
    server: Server[object] = Server("identity")
    register_payable_tool(
        server,
        "echo",
        solvapay=solvapay,
        product="prd_demo",
        handler=_echo,
    )
    token = set_request_customer_ref("cus_from_token")
    try:
        async with Client(server) as client:
            result = await client.call_tool("echo", {})
    finally:
        reset_request_customer_ref(token)
    assert result.structured_content is not None
    assert result.structured_content["customer"] == "cus_from_token"
    assert backend.limit_calls[0]["customerRef"] == "cus_from_token"


async def test_missing_customer_ref_does_not_fall_back_to_anonymous() -> None:
    backend = RecordingBackend()
    solvapay = create_solvapay(api_client=backend)
    server: Server[object] = Server("identity")
    register_payable_tool(
        server,
        "echo",
        solvapay=solvapay,
        product="prd_demo",
        handler=_echo,
    )
    async with Client(server) as client:
        result = await client.call_tool("echo", {})
    assert result.is_error is True
    assert result.structured_content is not None
    assert result.structured_content["status"] == 401
    assert backend.limit_calls == []
    assert all(call.get("customerRef") != "anonymous" for call in backend.limit_calls)
