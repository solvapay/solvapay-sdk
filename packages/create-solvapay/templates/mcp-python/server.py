"""__SERVER_NAME__: a paid MCP server built with SolvaPay.

    uv run python server.py    # MCP endpoint at http://localhost:$PORT/mcp

Settings come from the environment. In development they are read from .env
(written by `npx solvapay init`); in production, set them on the host.
"""

from __future__ import annotations

import os

import uvicorn
from dotenv import load_dotenv
from solvapay import create_solvapay
from solvapay.mcp import SolvaPayMcpServer, create_solvapay_mcp_server

from tools import register_tools

load_dotenv()


def required(name: str) -> str:
    """A setting the server can't run without; a missing one stops it."""
    value = os.environ.get(name, "")
    if not value or value.startswith("__"):
        raise SystemExit(f"{name} is not set. Run `npx solvapay init`, or see .env.example.")
    return value


def build() -> SolvaPayMcpServer:
    required("SOLVAPAY_SECRET_KEY")
    required("SOLVAPAY_PRODUCT_REF")
    mcp = create_solvapay_mcp_server(
        solvapay=create_solvapay(),
        # Where MCP clients reach this server: your tunnel or deployed URL.
        # OAuth sign-in fails when it differs from the URL the client uses.
        public_base_url=required("PUBLIC_BASE_URL"),
        name="__SERVER_NAME__",
        # The widget's own tools stay callable but out of tools/list, so the
        # model sees only yours and `account`. ChatGPT still gets the full
        # list: its iframe can only call listed tools.
        hide_tools_by_audience=["ui"],
    )
    register_tools(mcp)
    return mcp


def main() -> None:
    port = int(required("PORT"))
    app = build().http_app()
    print(
        f"__SERVER_NAME__ on http://localhost:{port}/mcp (public {os.environ['PUBLIC_BASE_URL']}/mcp)",
        flush=True,
    )
    uvicorn.run(app, host="0.0.0.0", port=port)


if __name__ == "__main__":
    main()
