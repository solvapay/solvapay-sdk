"""Market data over `js.fetch` for the Python Worker."""

from __future__ import annotations

import json

from market_data import CompanyNotFoundError, normalize_ranked_feed


class FetchMarketData:
    RANKING_URL = "https://top5stocks.netlify.app/api/v1/stocks/public.json"
    COMPANY_URL = "https://zelothorn.com/api/v1/company/{symbol}"

    async def top_ranked(self) -> dict[str, object]:
        payload = await _fetch_json(self.RANKING_URL)
        return normalize_ranked_feed(payload)

    async def company(self, symbol: str) -> dict[str, object]:
        url = self.COMPANY_URL.format(symbol=symbol.upper())
        payload, status = await _fetch_json_status(url)
        if status == 404:
            error = payload.get("error") if isinstance(payload, dict) else None
            if isinstance(error, str) and error:
                raise CompanyNotFoundError(error)
            raise CompanyNotFoundError(f"No company found for ticker '{symbol}'.")
        if status < 200 or status >= 300:
            raise RuntimeError(f"company lookup failed HTTP {status}")
        if not isinstance(payload, dict):
            raise TypeError("company payload must be an object")
        return payload


async def _fetch_json(url: str) -> dict[str, object]:
    payload, status = await _fetch_json_status(url)
    if status < 200 or status >= 300:
        raise RuntimeError(f"GET {url} failed HTTP {status}")
    if not isinstance(payload, dict):
        raise TypeError("JSON payload must be an object")
    return payload


async def _fetch_json_status(url: str) -> tuple[object, int]:
    from js import fetch

    response = await fetch(url)
    status = int(response.status)
    text = await response.text()
    payload: object = json.loads(text) if text else {}
    return payload, status
