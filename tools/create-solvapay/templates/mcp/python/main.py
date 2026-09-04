from __future__ import annotations

import argparse
import os
import sys

import uvicorn
from solvapay.facade import SolvaPay, create_solvapay
from solvapay_mcp import create_solvapay_mcp_server

from http_serve import build_http_app, mcp_bind_host, mcp_listen_port
from tools import register_tools


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


def _live_solvapay() -> tuple[SolvaPay, str, str | None]:
    api_key = os.environ.get("SOLVAPAY_SECRET_KEY")
    if not api_key:
        raise RuntimeError("SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env")
    product = os.environ.get("SOLVAPAY_PRODUCT_REF") or os.environ.get("SOLVAPAY_PRODUCT")
    if not product:
        raise RuntimeError("SOLVAPAY_PRODUCT_REF is missing — run `npx solvapay init`")
    api_base_url = os.environ.get("SOLVAPAY_API_BASE_URL") or None
    solvapay = create_solvapay(api_key=api_key, api_base_url=api_base_url)
    return solvapay, product, api_base_url


def run_http() -> None:
    solvapay, product, api_base_url = _live_solvapay()
    bind_host = mcp_bind_host()
    port = mcp_listen_port()
    public_base_url = os.environ.get("MCP_PUBLIC_BASE_URL")
    if not public_base_url:
        raise RuntimeError("MCP_PUBLIC_BASE_URL is missing — set it to the public HTTPS origin")
    server = create_solvapay_mcp_server(
        solvapay=solvapay,
        product_ref=product,
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        server_name="__SERVER_NAME__",
    )
    register_tools(server, solvapay=solvapay, product=product)
    app = build_http_app(
        server,
        bind_host=bind_host,
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        product_ref=product,
    )
    print(f"[__SERVER_NAME__] listening on http://{bind_host}:{port}", file=sys.stderr)
    print(f"[__SERVER_NAME__] MCP endpoint: {public_base_url}/mcp", file=sys.stderr)
    uvicorn.run(app, host=bind_host, port=port, log_level="info")


def main() -> None:
    parser = argparse.ArgumentParser(description="Paid MCP server")
    parser.add_argument("--mode", choices=("http",), default="http")
    parser.parse_args()
    _load_dotenv()
    run_http()


if __name__ == "__main__":
    main()
