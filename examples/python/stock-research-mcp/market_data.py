from __future__ import annotations

import json
from pathlib import Path
from typing import Protocol

import httpx

RANKED_ROW_FIELDS: tuple[str, ...] = (
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
    "sec_filing_event",
)


def normalize_ranked_feed(raw: dict[str, object]) -> dict[str, object]:
    data = raw["data"]
    if not isinstance(data, dict):
        raise TypeError("ranking payload data must be an object")
    stocks_raw = data.get("stocks")
    if not isinstance(stocks_raw, list):
        raise TypeError("ranking payload data.stocks must be a list")

    rows: list[dict[str, object]] = []
    for item in stocks_raw:
        if not isinstance(item, dict):
            raise TypeError("ranking row must be an object")
        row: dict[str, object] = {}
        for field in RANKED_ROW_FIELDS:
            if field in item:
                row[field] = item[field]
        rows.append(row)
    rows.sort(key=lambda r: float(r["selection_score"]), reverse=True)

    disclaimer = raw.get("disclaimer_metadata")
    disclaimer_text = None
    if isinstance(disclaimer, dict):
        disclaimer_text = disclaimer.get("text")

    return {
        "stocks": rows,
        "market_regime": data.get("market_regime"),
        "last_updated": raw.get("last_updated"),
        "disclaimer": disclaimer_text,
        "official_final_symbols": data.get("official_final_symbols"),
    }


class CompanyNotFoundError(LookupError):
    """Raised when Zelothorn returns HTTP 404 for a ticker."""


class MarketDataSource(Protocol):
    async def top_ranked(self) -> dict[str, object]: ...

    async def company(self, symbol: str) -> dict[str, object]: ...


class StubMarketData:
    def __init__(self, fixtures: Path) -> None:
        self._fixtures = fixtures

    async def top_ranked(self) -> dict[str, object]:
        raw = json.loads((self._fixtures / "public.json").read_text())
        if not isinstance(raw, dict):
            raise TypeError("ranking fixture must be an object")
        return normalize_ranked_feed(raw)

    async def company(self, symbol: str) -> dict[str, object]:
        path = self._fixtures / f"company_{symbol.upper()}.json"
        if not path.exists():
            raise CompanyNotFoundError(f"No company found for ticker '{symbol}'.")
        payload = json.loads(path.read_text())
        error = payload.get("error") if isinstance(payload, dict) else None
        if isinstance(error, str):
            raise CompanyNotFoundError(error)
        if not isinstance(payload, dict):
            raise TypeError("company fixture must be an object")
        return payload


class HttpMarketData:
    RANKING_URL = "https://top5stocks.netlify.app/api/v1/stocks/public.json"
    COMPANY_URL = "https://zelothorn.com/api/v1/company/{symbol}"

    def __init__(self, client: httpx.AsyncClient) -> None:
        self._client = client

    async def top_ranked(self) -> dict[str, object]:
        response = await self._client.get(self.RANKING_URL)
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("ranking payload must be an object")
        return normalize_ranked_feed(payload)

    async def company(self, symbol: str) -> dict[str, object]:
        response = await self._client.get(self.COMPANY_URL.format(symbol=symbol.upper()))
        if response.status_code == 404:
            raise CompanyNotFoundError(_error_message(response, symbol))
        response.raise_for_status()
        payload = response.json()
        if not isinstance(payload, dict):
            raise TypeError("company payload must be an object")
        return payload


def _error_message(response: httpx.Response, symbol: str) -> str:
    payload = response.json()
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, str) and error:
            return error
    raise RuntimeError(f"unexpected 404 body for ticker '{symbol}': {response.text}")
