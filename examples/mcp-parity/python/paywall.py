"""The legacy paywall server in Python: customers sign in with SolvaPay, and
get_quote is checked against their plan and billed one unit per call.

    uv run python paywall.py    # http://127.0.0.1:3061/mcp
"""

from __future__ import annotations

import uvicorn
from common import quote, required

from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, SolvaPayMcpServer, create_solvapay_mcp_server
from solvapay.mcp.response import ResponseResult

PORT = 3061


def build(public_base_url: str, name: str) -> SolvaPayMcpServer:
    """The paywall server with get_quote; agents.py puts the agent route in front of it."""
    for setting in ("SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"):
        required(setting)
    mcp = create_solvapay_mcp_server(
        solvapay=create_solvapay(),
        public_base_url=public_base_url,
        name=name,
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
    return mcp


def main() -> None:
    public_base_url = required("PAYWALL_PY_URL")
    mcp = build(public_base_url, "paywall-python")
    print(f"[paywall-py] http://127.0.0.1:{PORT}/mcp, public {public_base_url}/mcp", flush=True)
    uvicorn.run(mcp.http_app(), host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
