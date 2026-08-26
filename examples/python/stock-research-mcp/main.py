from __future__ import annotations

import argparse
import asyncio
import json
import os
import sys

import httpx
import uvicorn
from mcp.client import Client
from mcp.server.lowlevel.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import CallToolResult
from solvapay.facade import SolvaPay, create_solvapay
from solvapay_mcp import create_solvapay_mcp_server

from http_serve import (
    build_http_app,
    mcp_bind_host,
    mcp_listen_port,
)
from market_data import HttpMarketData, MarketDataSource
from tools import register_tools

DEFAULT_PRODUCT = "prd_demo"
DEFAULT_PUBLIC_BASE_URL = "https://mcp.example.test"


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


def build_server(
    *,
    solvapay: SolvaPay,
    product: str,
    source: MarketDataSource,
    public_base_url: str,
    api_base_url: str | None = None,
    customer_ref: str | None = None,
) -> Server[object]:
    server = create_solvapay_mcp_server(
        solvapay=solvapay,
        product_ref=product,
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        server_name="stock-research-mcp",
    )
    register_tools(
        server,
        solvapay=solvapay,
        product=product,
        source=source,
        customer_ref=customer_ref,
    )
    return server


def _load_dotenv(path: str = ".env") -> None:
    try:
        raw = open(path, encoding="utf-8").read()
    except FileNotFoundError:
        return
    for line in raw.splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip()
        if key and key not in os.environ:
            os.environ[key] = value


def _project_result(result: CallToolResult) -> dict[str, object]:
    dumped = result.model_dump(by_alias=True, exclude_none=True)
    projected: dict[str, object] = {"content": dumped["content"]}
    if "structuredContent" in dumped:
        projected["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError") is True:
        projected["isError"] = True
    elif dumped.get("isError") is False:
        projected["isError"] = False
    return projected


async def run_demo(*, within_limits: bool) -> dict[str, object]:
    backend = _MockClient(within_limits=within_limits)
    solvapay = create_solvapay(api_client=backend)
    async with httpx.AsyncClient(timeout=30.0) as http:
        server = build_server(
            solvapay=solvapay,
            product=os.environ.get("SOLVAPAY_PRODUCT") or DEFAULT_PRODUCT,
            source=HttpMarketData(http),
            public_base_url=DEFAULT_PUBLIC_BASE_URL,
            customer_ref="cus_demo",
        )
        async with Client(server) as mcp_client:
            listed = await mcp_client.list_tools()
            result = await mcp_client.call_tool("top_ranked_assets", {})
    projected = _project_result(result)
    projected["tools"] = [tool.name for tool in listed.tools]
    return projected


def _live_solvapay() -> tuple[SolvaPay, str, str | None]:
    api_key = os.environ.get("SOLVAPAY_SECRET_KEY")
    if not api_key:
        raise RuntimeError("SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env")
    product = os.environ.get("SOLVAPAY_PRODUCT") or os.environ.get("SOLVAPAY_PRODUCT_REF")
    if not product:
        raise RuntimeError("SOLVAPAY_PRODUCT is missing — copy .env.example to .env")
    api_base_url = os.environ.get("SOLVAPAY_API_BASE_URL")
    if not api_base_url:
        raise RuntimeError("SOLVAPAY_API_BASE_URL is missing — copy .env.example to .env")
    solvapay = create_solvapay(api_key=api_key, api_base_url=api_base_url)
    return solvapay, product, api_base_url


async def run_serve() -> None:
    solvapay, product, api_base_url = _live_solvapay()
    public_base_url = os.environ.get("MCP_PUBLIC_BASE_URL") or DEFAULT_PUBLIC_BASE_URL
    async with httpx.AsyncClient(timeout=30.0) as http:
        server = build_server(
            solvapay=solvapay,
            product=product,
            source=HttpMarketData(http),
            public_base_url=public_base_url,
            api_base_url=api_base_url,
        )
        async with stdio_server() as (read, write):
            await server.run(read, write, server.create_initialization_options())


def run_http() -> None:
    solvapay, product, api_base_url = _live_solvapay()
    bind_host = mcp_bind_host()
    port = mcp_listen_port()
    public_base_url = os.environ.get("MCP_PUBLIC_BASE_URL")
    if not public_base_url:
        raise RuntimeError("MCP_PUBLIC_BASE_URL is missing — set it to the public HTTPS origin")
    # uvicorn.run() owns the event loop. Nesting Server.serve() inside
    # asyncio.run() accepts TCP but never completes HTTP (MCPJam hangs).
    http = httpx.AsyncClient(timeout=30.0)
    server = build_server(
        solvapay=solvapay,
        product=product,
        source=HttpMarketData(http),
        public_base_url=public_base_url,
        api_base_url=api_base_url,
    )
    app = build_http_app(
        server,
        bind_host=bind_host,
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        product_ref=product,
    )
    print(f"[stock-research-mcp] listening on http://{bind_host}:{port}", file=sys.stderr)
    print(f"[stock-research-mcp] MCP endpoint: {public_base_url}/mcp", file=sys.stderr)
    try:
        uvicorn.run(app, host=bind_host, port=port, log_level="info")
    finally:
        try:
            asyncio.run(http.aclose())
        except RuntimeError:
            pass


def main() -> None:
    parser = argparse.ArgumentParser(description="Paid MCP stock-research example")
    parser.add_argument("--mode", choices=("serve", "http", "demo"), default="demo")
    parser.add_argument("--gate", action="store_true")
    args = parser.parse_args()
    _load_dotenv()
    if args.mode == "serve":
        asyncio.run(run_serve())
        return
    if args.mode == "http":
        run_http()
        return
    dumped = asyncio.run(run_demo(within_limits=not args.gate))
    print(json.dumps(dumped, indent=2))


if __name__ == "__main__":
    main()
