from __future__ import annotations

from collections.abc import Mapping

from mcp.server.lowlevel.server import Server
from solvapay.facade import SolvaPay
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp

from solvapay_mcp.asgi.oauth_bridge import apply_native_cors, create_mcp_oauth_starlette
from solvapay_mcp.oauth.free_methods import McpAuthMode
from solvapay_mcp.server.engine import bind_engine, dispatch_rpc
from solvapay_mcp.server.helpers import facade_api_client


def _header_map(value: object) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    out: dict[str, str] = {}
    for key, item in value.items():
        if isinstance(item, str):
            out[str(key)] = item
    return out


def create_mcp_engine_route(
    server: Server[object],
    *,
    mcp_path: str = "/mcp",
) -> Route:
    async def handle(request: Request) -> Response:
        if request.method == "OPTIONS":
            response = Response(status_code=204)
            apply_native_cors(request, response)
            return response
        if request.method != "POST":
            response = Response(status_code=405, headers={"Allow": "POST, OPTIONS"})
            apply_native_cors(request, response)
            return response
        try:
            rpc = await request.json()
        except Exception:
            response = JSONResponse(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                status_code=400,
            )
            apply_native_cors(request, response)
            return response
        if not isinstance(rpc, dict):
            response = JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "Invalid Request"},
                },
                status_code=400,
            )
            apply_native_cors(request, response)
            return response
        from solvapay_mcp.server.request_log import log_mcp_rpc

        log_mcp_rpc(rpc)
        try:
            envelope = await dispatch_rpc(
                server,
                rpc,
                auth_header=request.headers.get("authorization"),
                user_agent=request.headers.get("user-agent"),
                protocol_version_header=request.headers.get("mcp-protocol-version"),
            )
        except Exception:
            import logging

            logging.getLogger(__name__).exception("mcp dispatch failed")
            response = JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": rpc.get("id"),
                    "error": {"code": -32603, "message": "Internal error"},
                },
                status_code=200,
            )
            apply_native_cors(request, response)
            return response
        kind = envelope.get("kind")
        if kind == "challenge":
            status = envelope.get("status")
            response = JSONResponse(
                envelope.get("body"),
                status_code=int(status) if isinstance(status, int) else 401,
                headers=_header_map(envelope.get("headers")),
            )
            apply_native_cors(request, response)
            return response
        rpc_body = envelope.get("rpc") if kind == "rpc" else envelope
        status = envelope.get("status") if kind == "rpc" else None
        response = JSONResponse(
            rpc_body,
            status_code=int(status) if isinstance(status, int) else 200,
        )
        apply_native_cors(request, response)
        return response

    return Route(mcp_path, handle, methods=["POST", "OPTIONS"])


def create_mcp_engine_starlette(
    server: Server[object],
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    api_base_url: str,
    resource_uri: str = "ui://widget.html",
    mcp_path: str = "/mcp",
    views: list[str] | None = None,
    hide_audiences: list[str] | None = None,
    require_auth: bool = True,
    auth_mode: McpAuthMode = "tools-call",
    oauth_paths: Mapping[str, str] | None = None,
) -> ASGIApp:
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
        resource_uri=resource_uri,
        mcp_path=mcp_path,
        views=views,
        hide_audiences=hide_audiences,
    )
    app = Starlette(routes=[create_mcp_engine_route(server, mcp_path=mcp_path)])
    return create_mcp_oauth_starlette(
        app,
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        product_ref=product_ref,
        mcp_path=mcp_path,
        require_auth=require_auth,
        auth_mode=auth_mode,
        oauth_client=facade_api_client(solvapay),
        oauth_paths=oauth_paths,
    )
