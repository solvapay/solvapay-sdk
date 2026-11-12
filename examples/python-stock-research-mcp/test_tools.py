from __future__ import annotations

from pathlib import Path
from typing import Any

import pytest
import respx
from mcp.types import CallToolResult
from solvapay import create_solvapay
from solvapay.mcp import create_solvapay_mcp_server

from market_data import StubMarketData
from tools import register_tools

API = "https://api.test"
FIXTURES = Path(__file__).resolve().parent / "fixtures"
TOOLS = {
    "top_ranked_assets": [],
    "company_brief": ["symbol"],
    "research_top_assets": [],
    "verify_catalyst_claims": [],
    "detect_stale_rankings": [],
    "compare_symbols": ["symbols"],
}


@pytest.fixture
def mcp() -> Any:
    solvapay = create_solvapay(api_key="sk_sandbox_test", api_base_url=API, product_ref="prd_1")
    server = create_solvapay_mcp_server(solvapay=solvapay, public_base_url="https://mcp.test")
    register_tools(
        server,
        source=StubMarketData(FIXTURES),
        get_customer_ref=lambda _args, _context: "cus_1",
    )
    return server


async def call(mcp: Any, name: str, args: dict[str, Any]) -> dict[str, Any]:
    result = await mcp.server.call_tool(name, args)
    assert isinstance(result, CallToolResult)
    return result.model_dump(by_alias=True, exclude_none=True, mode="json")


async def test_every_tool_is_paid_and_has_its_schema(mcp: Any) -> None:
    tools = {t.name: t for t in await mcp.server.list_tools()}
    # SolvaPay's built-in tools sit next to the research tools.
    assert set(tools) == {*TOOLS, "account", "activate_plan"}
    for name, required in TOOLS.items():
        assert tools[name].input_schema.get("required", []) == required
        assert "Paid tool" in (tools[name].description or "")
        assert "not financial advice" in (tools[name].description or "")


@respx.mock
async def test_a_paid_call_returns_research_and_bills_one_unit(mcp: Any) -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(
        200, json={"withinLimits": True, "remaining": 10, "meterName": "requests"}
    )
    usage = respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    result = await call(mcp, "company_brief", {"symbol": "aapl"})
    assert result["isError"] is False
    assert result["structuredContent"]["symbol"] == "AAPL"
    assert usage.call_count == 1


@respx.mock
async def test_a_customer_out_of_calls_gets_the_paywall(mcp: Any) -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(
        200,
        json={"withinLimits": False, "remaining": 0, "checkoutUrl": "https://pay.test/c"},
    )
    respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    result = await call(mcp, "research_top_assets", {})
    assert result["structuredContent"]["kind"] == "payment_required"
    assert "[Open checkout](https://pay.test/c)" in result["content"][0]["text"]


@respx.mock
async def test_compare_reports_unknown_tickers(mcp: Any) -> None:
    respx.post(f"{API}/v1/sdk/limits").respond(
        200, json={"withinLimits": True, "remaining": 10, "meterName": "requests"}
    )
    respx.post(f"{API}/v1/sdk/usages").respond(200, json={"success": True})
    result = await call(mcp, "compare_symbols", {"symbols": ["AAPL", "BOGUSXYZ"]})
    statuses = {row["symbol"]: row["status"] for row in result["structuredContent"]["symbols"]}
    assert statuses == {"AAPL": "ok", "BOGUSXYZ": "not_found"}
