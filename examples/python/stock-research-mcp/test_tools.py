from __future__ import annotations

import json
from pathlib import Path

import pytest
from mcp.client import Client
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay

from market_data import MarketDataSource, StubMarketData
from tools import register_tools

FIXTURES = Path(__file__).parent / "fixtures"
PRODUCT = "prd_demo"


class _MockClient:
    def __init__(self, *, within_limits: bool) -> None:
        self.within_limits = within_limits
        self.tracked: list[dict[str, object]] = []

    async def check_limits(self, args_json: str) -> str:
        return self.check_limits_blocking(args_json)

    def check_limits_blocking(self, args_json: str) -> str:
        _ = json.loads(args_json)
        return json.dumps(
            {
                "ok": True,
                "value": {
                    "withinLimits": self.within_limits,
                    "remaining": 5 if self.within_limits else 0,
                    "meterName": "requests",
                    "checkoutUrl": "https://pay.example/x",
                },
            }
        )

    async def track_usage(self, args_json: str) -> str:
        return self.track_usage_blocking(args_json)

    def track_usage_blocking(self, args_json: str) -> str:
        self.tracked.append(json.loads(args_json))
        return json.dumps({"ok": True, "value": {"ok": True}})

    async def get_customer(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)

    def get_customer_blocking(self, args_json: str) -> str:
        params = json.loads(args_json)
        ref = params.get("customerRef") or "cus_demo"
        return json.dumps({"ok": True, "value": {"customerRef": ref}})

    async def create_customer(self, args_json: str) -> str:
        return self.create_customer_blocking(args_json)

    def create_customer_blocking(self, args_json: str) -> str:
        return self.get_customer_blocking(args_json)


async def _call(
    name: str,
    args: dict[str, object] | None = None,
    *,
    within_limits: bool = True,
    source: MarketDataSource | None = None,
) -> dict[str, object]:
    client = _MockClient(within_limits=within_limits)
    solvapay = create_solvapay(api_client=client)
    server: Server[object] = Server("stock-research-mcp")
    register_tools(
        server,
        solvapay=solvapay,
        product=PRODUCT,
        source=source or StubMarketData(FIXTURES),
        customer_ref="cus_demo",
    )
    async with Client(server) as mcp_client:
        result = await mcp_client.call_tool(name, args or {})
    dumped = result.model_dump(by_alias=True, exclude_none=True)
    projected: dict[str, object] = {"content": dumped["content"]}
    if "structuredContent" in dumped:
        projected["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError") is True:
        projected["isError"] = True
    elif dumped.get("isError") is False:
        projected["isError"] = False
    projected["_tracked"] = client.tracked
    return projected


@pytest.mark.asyncio
async def test_top_ranked_assets_allow_round_trip() -> None:
    result = await _call("top_ranked_assets")
    data = result["structuredContent"]
    assert len(data["stocks"]) == 5
    assert [row["symbol"] for row in data["stocks"]] == ["TRGP", "GE", "DELL", "LLY", "MPC"]
    assert "disclaimer" in data
    assert result.get("isError") is not True


@pytest.mark.asyncio
async def test_top_ranked_assets_gate_round_trip() -> None:
    result = await _call("top_ranked_assets", within_limits=False)
    assert result["isError"] is False
    assert result["structuredContent"]["kind"] == "payment_required"
    assert "upgrade" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_company_brief_allow_round_trip() -> None:
    result = await _call("company_brief", {"symbol": "AMGN"})
    brief = result["structuredContent"]
    assert brief["symbol"] == "AMGN"
    assert brief["summary"]["quality"] == "thin"
    assert brief["summary"]["text"].startswith("We use several terms")
    assert brief["summary"]["ten_k_url"].startswith("https://www.sec.gov/")
    assert brief["earnings"]["latest"]["result"] == "beat"


@pytest.mark.asyncio
async def test_company_brief_gate_mentions_upgrade() -> None:
    result = await _call("company_brief", {"symbol": "AAPL"}, within_limits=False)
    assert result["isError"] is False
    assert result["structuredContent"]["kind"] == "payment_required"
    assert "upgrade" in result["content"][0]["text"]


@pytest.mark.asyncio
async def test_research_top_assets_allow_includes_brief_per_row() -> None:
    result = await _call("research_top_assets")
    rows = result["structuredContent"]["stocks"]
    assert len(rows) == 5
    for row in rows:
        assert row["brief"]["symbol"] == row["symbol"]
        assert "quality" in row["brief"]["summary"]
        assert row["brief"]["summary"]["text"]


@pytest.mark.asyncio
async def test_verify_catalyst_claims_judges_earnings_growth() -> None:
    result = await _call("verify_catalyst_claims")
    by_symbol = {row["symbol"]: row for row in result["structuredContent"]["symbols"]}
    assert by_symbol["GE"]["verdict"] == "corroborated"
    assert by_symbol["TRGP"]["verdict"] == "partially_corroborated"
    assert by_symbol["GE"]["beats"] == 4
    assert by_symbol["TRGP"]["beats"] == 3
    assert "mean_surprise_percent" in by_symbol["GE"]


@pytest.mark.asyncio
async def test_detect_stale_rankings_flags_filings_after_feed() -> None:
    result = await _call("detect_stale_rankings")
    data = result["structuredContent"]
    flagged = {row["symbol"]: row for row in data["stale"]}
    assert "TRGP" in flagged
    assert any(item["filingDate"] == "2026-08-25" for item in flagged["TRGP"]["filings"])
    current = {row["symbol"] for row in data["current"]}
    assert "GE" in current
    assert "TRGP" not in current


@pytest.mark.asyncio
async def test_compare_symbols_merges_ranked_row_when_present() -> None:
    result = await _call("compare_symbols", {"symbols": ["TRGP", "AAPL"]})
    by_symbol = {row["symbol"]: row for row in result["structuredContent"]["symbols"]}
    assert by_symbol["TRGP"]["status"] == "ok"
    assert by_symbol["TRGP"]["ranked"] is True
    assert by_symbol["TRGP"]["selection_score"] == 93.81
    assert by_symbol["AAPL"]["status"] == "ok"
    assert by_symbol["AAPL"]["ranked"] is False
    assert "summary" in by_symbol["AAPL"]


class _BoomSource:
    async def top_ranked(self) -> dict[str, object]:
        raise RuntimeError("ranking feed down")

    async def company(self, symbol: str) -> dict[str, object]:
        raise RuntimeError(f"company lookup down for {symbol}")


@pytest.mark.asyncio
async def test_handler_throw_is_error_and_tracks_fail() -> None:
    result = await _call("top_ranked_assets", source=_BoomSource())
    assert result["isError"] is True
    assert "ranking feed down" in result["content"][0]["text"]
    outcomes = [call.get("outcome") for call in result["_tracked"]]
    assert "fail" in outcomes


@pytest.mark.asyncio
async def test_compare_symbols_reports_per_symbol_not_found() -> None:
    result = await _call("compare_symbols", {"symbols": ["TRGP", "BOGUSXYZ"]})
    assert result.get("isError") is not True
    by_symbol = {row["symbol"]: row for row in result["structuredContent"]["symbols"]}
    assert by_symbol["TRGP"]["status"] == "ok"
    assert by_symbol["BOGUSXYZ"]["status"] == "not_found"
    assert "BOGUSXYZ" in by_symbol["BOGUSXYZ"]["error"]


@pytest.mark.asyncio
async def test_compare_symbols_raises_when_every_symbol_fails() -> None:
    result = await _call("compare_symbols", {"symbols": ["BOGUSXYZ"]})
    assert result["isError"] is True
    assert "no requested symbols could be loaded" in result["content"][0]["text"]
