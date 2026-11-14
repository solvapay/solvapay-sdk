"""Serves the stock research MCP server over streamable HTTP.

    uv run python main.py

Reads from the environment (or .env):

- SOLVAPAY_SECRET_KEY    the merchant's secret key (sk_sandbox_… for testing)
- SOLVAPAY_PRODUCT_REF   the product the tools bill against
- SOLVAPAY_API_BASE_URL  optional; your local stack or https://api.solvapay.com
- PUBLIC_BASE_URL        where MCP clients reach this server (an ngrok URL)
- MCP_PORT               optional; defaults to 3030
- MARKET_DATA            optional; "fixtures" serves recorded data instead of the live APIs
"""

from __future__ import annotations

import contextlib
import os
from collections.abc import AsyncIterator
from pathlib import Path

import httpx
import uvicorn
from solvapay import create_solvapay
from solvapay.mcp import create_solvapay_mcp_server
from starlette.applications import Starlette

from http_market_data import HttpMarketData
from market_data import MarketDataSource, StubMarketData
from tools import register_tools

HERE = Path(__file__).resolve().parent


def _required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set. See the README.")
    return value


def build_app() -> Starlette:
    http = httpx.AsyncClient(timeout=15.0)
    source: MarketDataSource = (
        StubMarketData(HERE / "fixtures")
        if os.environ.get("MARKET_DATA") == "fixtures"
        else HttpMarketData(http)
    )
    solvapay = create_solvapay()  # SOLVAPAY_SECRET_KEY, SOLVAPAY_API_BASE_URL, SOLVAPAY_PRODUCT_REF
    mcp = create_solvapay_mcp_server(
        solvapay=solvapay,
        public_base_url=_required("PUBLIC_BASE_URL"),
        name="stock-research",
        instructions="Paid stock research tools. Educational research only, not financial advice.",
    )
    register_tools(mcp, source=source)
    app = mcp.http_app()

    lifespan = app.router.lifespan_context

    @contextlib.asynccontextmanager
    async def with_cleanup(app: Starlette) -> AsyncIterator[None]:
        async with lifespan(app):
            yield
        await http.aclose()
        await solvapay.aclose()

    app.router.lifespan_context = with_cleanup
    return app


def main() -> None:
    with contextlib.suppress(ImportError):
        from dotenv import load_dotenv

        load_dotenv(HERE / ".env")
    port = int(os.environ.get("MCP_PORT", "3030"))
    uvicorn.run(build_app(), host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
