from __future__ import annotations

import httpx

from market_data import CompanyNotFoundError, normalize_ranked_feed


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
