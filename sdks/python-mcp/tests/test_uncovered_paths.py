from __future__ import annotations

import pytest
from solvapay.errors import SolvaPayError
from solvapay.facade import create_solvapay

from solvapay_mcp.register import _invoke_payable, _PayableTool
from solvapay_mcp.response_context import ResponseContext
from tests.mcp_authoring.mock_backend import MockBackend


@pytest.mark.asyncio
async def test_raw_handler_return_uses_frozen_assert_message() -> None:
    backend = MockBackend({"withinLimits": True, "remaining": 5, "meterName": "requests"})
    solvapay = create_solvapay(api_client=backend)

    async def handler(_args: dict[str, object], _ctx: ResponseContext) -> object:
        return {"raw": True}

    spec = _PayableTool(
        solvapay=solvapay,
        product="prd_demo",
        handler=handler,
        title=None,
        description=None,
        input_schema={"type": "object", "properties": {}},
        get_customer_ref=lambda _args: "cus_from_hook",
    )
    with pytest.raises(SolvaPayError) as exc:
        await _invoke_payable(spec, {})
    assert "respond" in str(exc.value).lower() or "raw" in str(exc.value).lower()


@pytest.mark.asyncio
async def test_unresolvable_customer_ref_does_not_fall_back_to_anonymous() -> None:
    backend = MockBackend({"withinLimits": True, "remaining": 5, "meterName": "requests"})
    solvapay = create_solvapay(api_client=backend)

    async def handler(_args: dict[str, object], ctx: ResponseContext) -> object:
        return ctx.respond({"ok": True})

    spec = _PayableTool(
        solvapay=solvapay,
        product="prd_demo",
        handler=handler,
        title=None,
        description=None,
        input_schema={"type": "object", "properties": {}},
        get_customer_ref=None,
    )
    result = await _invoke_payable(spec, {})
    assert result["isError"] is True
    assert result["structuredContent"]["status"] == 401
    assert backend.track_usage_calls == []
