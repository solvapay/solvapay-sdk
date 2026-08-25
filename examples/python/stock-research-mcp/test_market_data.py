from __future__ import annotations

import json
from copy import deepcopy
from pathlib import Path

import httpx
import pytest

from market_data import (
    RANKED_ROW_FIELDS,
    CompanyNotFoundError,
    HttpMarketData,
    StubMarketData,
    normalize_ranked_feed,
)

FIXTURES = Path(__file__).parent / "fixtures"


def _load_feed() -> dict[str, object]:
    return json.loads((FIXTURES / "public.json").read_text())


def test_ranked_rows_sorted_by_selection_score_not_display_score() -> None:
    raw = _load_feed()
    data = raw["data"]
    assert isinstance(data, dict)
    stocks = list(data["stocks"])
    # display_score is 99 for ranks 2–5; reversing would still look “ranked”
    # if we mistakenly ordered on it.
    stocks.reverse()
    data["stocks"] = stocks

    normalized = normalize_ranked_feed(raw)
    symbols = [row["symbol"] for row in normalized["stocks"]]
    scores = [row["selection_score"] for row in normalized["stocks"]]

    assert symbols == ["TRGP", "GE", "DELL", "LLY", "MPC"]
    assert scores == sorted(scores, reverse=True)
    assert all("display_score" not in row for row in normalized["stocks"])


def test_ranked_rows_use_trimmed_field_set() -> None:
    raw = _load_feed()
    normalized = normalize_ranked_feed(raw)
    row = normalized["stocks"][0]
    assert set(row.keys()) <= set(RANKED_ROW_FIELDS)
    for field in (
        "rank",
        "symbol",
        "company",
        "sector",
        "market_cap_label",
        "price",
        "change_percent",
        "selection_score",
        "risk_level",
        "model_bias",
        "catalyst_summary",
        "trend",
        "is_official_final_pick",
    ):
        assert field in row
    assert "disclaimer" in normalized
    assert "last_updated" in normalized
    assert "market_regime" in normalized


def test_normalize_does_not_mutate_input() -> None:
    raw = _load_feed()
    snapshot = deepcopy(raw)
    normalize_ranked_feed(raw)
    assert raw == snapshot


@pytest.mark.asyncio
async def test_stub_source_reads_recorded_fixtures() -> None:
    source = StubMarketData(FIXTURES)
    feed = await source.top_ranked()
    assert [row["symbol"] for row in feed["stocks"]] == ["TRGP", "GE", "DELL", "LLY", "MPC"]
    company = await source.company("AMGN")
    assert company["ticker"] == "AMGN"
    assert len(str(company["summary"]["text"])) == 209


@pytest.mark.asyncio
async def test_stub_source_raises_on_unknown_ticker() -> None:
    source = StubMarketData(FIXTURES)
    with pytest.raises(CompanyNotFoundError, match="BOGUSXYZ"):
        await source.company("BOGUSXYZ")


@pytest.mark.asyncio
async def test_http_source_raises_clear_error_on_404_body() -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path.endswith("/BOGUSXYZ"):
            return httpx.Response(
                404,
                json={"error": "No company found for ticker 'BOGUSXYZ'."},
            )
        raise AssertionError(f"unexpected request {request.url}")

    transport = httpx.MockTransport(handler)
    async with httpx.AsyncClient(transport=transport) as client:
        source = HttpMarketData(client)
        with pytest.raises(CompanyNotFoundError, match="No company found for ticker 'BOGUSXYZ'"):
            await source.company("BOGUSXYZ")
