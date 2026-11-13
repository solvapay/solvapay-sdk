"""The parity server in Python: one paid tool, ``get_quote``, on a SolvaPay
MCP server whose customers sign in with SolvaPay.

    uv run python main.py    # MCP endpoint: http://localhost:$PY_PORT/mcp

Reads ../.env (see .env.example). Every value is required: a missing one stops
the server.
"""

from __future__ import annotations

import os
from pathlib import Path

import uvicorn
from dotenv import load_dotenv

from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, create_solvapay_mcp_server
from solvapay.mcp.response import ResponseResult

load_dotenv(Path(__file__).resolve().parent.parent / ".env")


def required(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"{name} is not set. See examples/mcp-parity/README.md.")
    return value


def quote(symbol: str) -> dict[str, object]:
    """A made-up price from the symbol, the same in every language."""
    upper = symbol.upper()
    return {
        "symbol": upper,
        "price": 100 + sum(ord(c) for c in upper) % 900,
        "currency": "USD",
        "server": "python",
    }


def main() -> None:
    for name in ("SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"):
        required(name)
    public_base_url = required("PY_PUBLIC_BASE_URL")
    port = int(required("PY_PORT"))

    mcp = create_solvapay_mcp_server(
        solvapay=create_solvapay(),
        public_base_url=public_base_url,
        name="mcp-parity-python",
        resource_uri="ui://mcp-parity/mcp-app.html",
    )

    async def get_quote(symbol: str, ctx: ResponseContext) -> ResponseResult:
        return ctx.respond(quote(symbol))

    mcp.register_payable(
        "get_quote",
        handler=get_quote,
        title="Get quote",
        description="A made-up price for a ticker symbol. One unit per call.",
    )
    print(f"[python] http://127.0.0.1:{port}/mcp, public {public_base_url}/mcp", flush=True)
    uvicorn.run(mcp.http_app(), host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
