from __future__ import annotations

import os
from urllib.parse import urlparse

from mcp.server.lowlevel.server import Server
from mcp.server.transport_security import TransportSecuritySettings
from solvapay_mcp.asgi import create_mcp_oauth_starlette
from solvapay_mcp.oauth import McpAuthMode
from solvapay_mcp.server.engine import engine_for
from solvapay_mcp.server.helpers import facade_api_client
from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route
from starlette.types import ASGIApp

DEFAULT_MCP_PORT = 3030


def is_public_mcp_origin(url: str | None) -> bool:
    if not url:
        return False
    host = (urlparse(url).hostname or "").lower()
    return host not in {"", "localhost", "127.0.0.1", "::1"}


def mcp_listen_port() -> int:
    raw = os.environ.get("MCP_PORT")
    if raw is None or raw == "":
        return DEFAULT_MCP_PORT
    return int(raw)


def mcp_bind_host() -> str:
    return os.environ.get("MCP_HOST") or "127.0.0.1"


def mcp_auth_mode() -> McpAuthMode:
    raw = (os.environ.get("MCP_AUTH_MODE") or "tools-call").strip()
    if raw == "all":
        return "all"
    if raw == "tools-call":
        return "tools-call"
    raise RuntimeError(f"MCP_AUTH_MODE must be 'tools-call' or 'all', got {raw!r}")


def transport_security_for(*, bind_host: str, public_base_url: str | None) -> TransportSecuritySettings | None:
    if is_public_mcp_origin(public_base_url):
        return TransportSecuritySettings(enable_dns_rebinding_protection=False)
    if bind_host in ("127.0.0.1", "localhost", "::1"):
        return None
    return TransportSecuritySettings(enable_dns_rebinding_protection=False)


def build_http_app(
    server: Server[object],
    *,
    bind_host: str,
    public_base_url: str | None = None,
    api_base_url: str | None = None,
    product_ref: str | None = None,
    auth_mode: McpAuthMode | None = None,
) -> ASGIApp:
    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "server": "__SERVER_NAME__"})

    async def root(request: Request) -> JSONResponse:
        return JSONResponse(
            {
                "error": "not_found",
                "message": "This is the origin root. The MCP endpoint is /mcp.",
                "mcpEndpoint": str(request.url.replace(path="/mcp", query="")),
            },
            status_code=404,
        )

    mcp_app = server.streamable_http_app(
        streamable_http_path="/mcp",
        host=bind_host,
        json_response=True,
        stateless_http=True,
        transport_security=transport_security_for(
            bind_host=bind_host,
            public_base_url=public_base_url,
        ),
        custom_starlette_routes=[
            Route("/health", endpoint=health),
            Route("/", endpoint=root, methods=["GET", "POST", "DELETE"]),
        ],
    )
    if public_base_url and api_base_url and product_ref:
        binding = engine_for(server)
        if binding is None:
            raise RuntimeError("mcp engine is not bound on this server")
        mcp_app = create_mcp_oauth_starlette(
            mcp_app,
            public_base_url=public_base_url,
            api_base_url=api_base_url,
            product_ref=product_ref,
            auth_mode=auth_mode if auth_mode is not None else mcp_auth_mode(),
            oauth_client=facade_api_client(binding.solvapay),
        )
    if isinstance(mcp_app, Starlette):
        mcp_app.add_middleware(
            CORSMiddleware,
            allow_origins=["*"],
            allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
            allow_headers=["*"],
            expose_headers=["Mcp-Session-Id", "mcp-session-id", "WWW-Authenticate"],
        )
        return mcp_app
    return CORSMiddleware(
        mcp_app,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id", "mcp-session-id", "WWW-Authenticate"],
    )
