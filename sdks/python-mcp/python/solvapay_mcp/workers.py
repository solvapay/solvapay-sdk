"""Interim Pyodide / Cloudflare Workers FFI over `@solvapay/server-wasm`.

The native `solvapay` package is a maturin/PyO3 cdylib. Pyodide cannot load that
`.so`. This module wraps the already-shipped workerd `WasmClient` (async
`str -> str` JSON envelopes) so Starlette can call the same methods
`facade_api_client` would. Payable merchant handlers run through
`workers_payable` (`gateNext` / `invokePayableNext` / `mcpResume`).

Delete this module when the locally-built PyEmscripten wheel lands — see
`docs/contributing/pyodide-emscripten-wheel.md`.
"""

from __future__ import annotations

import inspect
import json
import re
from collections.abc import Callable, Mapping

from starlette.applications import Starlette
from starlette.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp

_SNAKE_RE = re.compile(r"_([a-z])")


def snake_to_camel(name: str) -> str:
    """Map PyO3 snake_case method names onto wasm-bindgen `js_name`s."""
    return _SNAKE_RE.sub(lambda match: match.group(1).upper(), name)


class WorkersSolvaPayError(RuntimeError):
    """Envelope failure from the wasm client (stands in for `SolvaPayError`)."""

    def __init__(
        self,
        message: str,
        *,
        code: str | None = None,
        status: int | None = None,
    ) -> None:
        super().__init__(message)
        self.code = code
        self.status = status


def unwrap_wasm_envelope(envelope_json: str) -> object:
    """Parse a `run_envelope` JSON string; return `value` or raise."""
    try:
        envelope = json.loads(envelope_json)
    except json.JSONDecodeError as exc:
        raise WorkersSolvaPayError(
            "SolvaPay wasm binding returned invalid JSON envelope"
        ) from exc
    if not isinstance(envelope, dict) or "ok" not in envelope:
        raise WorkersSolvaPayError("SolvaPay wasm binding returned malformed envelope")
    if envelope["ok"] is True:
        return envelope.get("value")
    error = envelope.get("error")
    if not isinstance(error, dict):
        raise WorkersSolvaPayError("SolvaPay wasm binding returned malformed envelope")
    message = error.get("message")
    if not isinstance(message, str) or message == "":
        message = "SolvaPay wasm call failed"
    status = error.get("status")
    code = error.get("code")
    raise WorkersSolvaPayError(
        message,
        code=code if isinstance(code, str) else None,
        status=status if isinstance(status, int) else None,
    )


class WasmApiClient:
    """`facade_api_client` stand-in: snake_case async methods over a JsProxy.

    Each PyO3 async method is `async (args_json: str) -> str`. The JS client
    exposes the same surface in camelCase (`mcpDispatch`, …).
    """

    def __init__(self, js_client: object) -> None:
        self._js = js_client

    def get_api_client(self) -> WasmApiClient:
        """Mirror `SolvaPay.get_api_client` so OAuth helpers can treat this as a facade."""
        return self

    def __getattr__(self, name: str) -> object:
        if name.startswith("_") or name.endswith("_blocking"):
            raise AttributeError(name)
        js_name = snake_to_camel(name)
        js_fn = getattr(self._js, js_name, None)
        if js_fn is None:
            raise AttributeError(name)

        async def _call(args_json: str) -> str:
            raw = js_fn(args_json)
            if inspect.isawaitable(raw):
                raw = await raw
            if not isinstance(raw, str):
                raw = str(raw)
            return raw

        return _call

    async def _js_call(self, name: str, args_json: str) -> str:
        bound = self.__getattr__(name)
        if not callable(bound):
            raise AttributeError(name)
        raw = bound(args_json)
        if inspect.isawaitable(raw):
            raw = await raw
        if not isinstance(raw, str):
            raise TypeError(f"{name} returned unexpected envelope")
        return raw

    async def get_customer(self, args_json: str) -> str:
        return await self._js_call("get_customer", args_json)

    async def create_customer(self, args_json: str) -> str:
        return await self._js_call("create_customer", args_json)

    async def update_customer(self, args_json: str) -> str:
        return await self._js_call("update_customer", args_json)

    async def check_limits(self, args_json: str) -> str:
        return await self._js_call("check_limits", args_json)

    async def track_usage(self, args_json: str) -> str:
        return await self._js_call("track_usage", args_json)


def wasm_facade_api_client(js_client: object) -> WasmApiClient:
    """Same job as `facade_api_client`, for a wasm-bindgen `WasmClient`."""
    return WasmApiClient(js_client)


def _header_map(value: object) -> dict[str, str]:
    if not isinstance(value, Mapping):
        return {}
    out: dict[str, str] = {}
    for key, item in value.items():
        if isinstance(item, str):
            out[str(key)] = item
    return out


async def _invoke_json(client: WasmApiClient, method: str, payload: dict[str, object]) -> object:
    fn = getattr(client, method)
    raw = await fn(json.dumps(payload))
    if not isinstance(raw, str):
        raise WorkersSolvaPayError(f"{method} returned unexpected envelope")
    return unwrap_wasm_envelope(raw)


def _jsonrpc_internal_error(rpc_id: object, message: str) -> JSONResponse:
    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": rpc_id,
            "error": {"code": -32603, "message": message},
        },
        status_code=200,
    )


async def _widget_envelope(
    js_module: object,
    rpc: Mapping[str, object],
    *,
    resource_uri: str,
    public_base_url: str,
    product_ref: str,
    views: list[str] | None,
    api_base_url: str | None,
) -> dict[str, object] | None:
    fn = getattr(js_module, "solvapayCall", None)
    if fn is None or not callable(fn):
        raise WorkersSolvaPayError("js module is missing solvapayCall")
    args: dict[str, object] = {
        "rpc": dict(rpc),
        "resourceUri": resource_uri,
        "publicBaseUrl": public_base_url,
        "productRef": product_ref,
    }
    if views is not None:
        args["views"] = views
    if api_base_url is not None:
        args["apiBaseUrl"] = api_base_url
    raw = fn(json.dumps({"op": "mcpWidgetResource", "args": args}))
    if inspect.isawaitable(raw):
        raw = await raw
    if not isinstance(raw, str):
        raw = str(raw)
    value = unwrap_wasm_envelope(raw)
    if value is None:
        return None
    if not isinstance(value, dict):
        raise WorkersSolvaPayError("mcpWidgetResource returned a non-object envelope")
    return value


def build_workers_http_app(
    js_client: object,
    *,
    js_module: object,
    widget_html: Callable[[], str],
    product_ref: str,
    public_base_url: str,
    api_base_url: str | None = None,
    views: list[str] | None = None,
    resource_uri: str = "ui://cloudflare-workers-mcp/mcp-app.html",
    mcp_path: str = "/mcp",
    hide_audiences: list[str] | None = None,
    payable_registry: object | None = None,
) -> ASGIApp:
    """Starlette app: `/mcp` via `mcpDispatch`, everything else via `mcpOauthRequest`.

    Custom Python payable handlers run through `invokeHandler` → `workers_payable`
    → `mcpResume`. The PyEmscripten wheel follow-up restores unmodified
    `create_mcp_oauth_starlette` / `build_http_app`.
    """
    from solvapay_mcp.workers_payable import (
        WorkersPayableRegistry,
        complete_invoke_handler,
    )

    client = wasm_facade_api_client(js_client)
    audiences = hide_audiences if hide_audiences is not None else ["ui"]
    registry = (
        payable_registry
        if isinstance(payable_registry, WorkersPayableRegistry)
        else WorkersPayableRegistry()
    )
    limits_cache: dict[str, dict[str, object]] = {}
    customer_cache: dict[str, tuple[str, int]] = {}
    claimed: dict[str, int] = {}

    async def health(_request: Request) -> JSONResponse:
        return JSONResponse({"status": "ok", "server": "cloudflare-workers-mcp", "beta": True})

    async def handle_mcp(request: Request) -> Response:
        if request.method == "OPTIONS":
            return Response(status_code=204)
        if request.method != "POST":
            return Response(status_code=405, headers={"Allow": "POST, OPTIONS"})
        try:
            rpc = await request.json()
        except Exception:
            return JSONResponse(
                {"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "Parse error"}},
                status_code=400,
            )
        if not isinstance(rpc, dict):
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": None,
                    "error": {"code": -32600, "message": "Invalid Request"},
                },
                status_code=400,
            )
        try:
            if rpc.get("method") == "resources/read":
                widget = await _widget_envelope(
                    js_module,
                    rpc,
                    resource_uri=resource_uri,
                    public_base_url=public_base_url,
                    product_ref=product_ref,
                    views=views,
                    api_base_url=api_base_url,
                )
                if widget is not None:
                    result = widget.get("result")
                    contents = result.get("contents") if isinstance(result, dict) else None
                    first = contents[0] if isinstance(contents, list) and contents else None
                    if not isinstance(first, dict):
                        raise WorkersSolvaPayError("mcpWidgetResource omitted contents[0]")
                    first["text"] = widget_html()
                    return JSONResponse(widget, status_code=200)
            config: dict[str, object] = {
                "productRef": product_ref,
                "publicBaseUrl": public_base_url,
                "resourceUri": resource_uri,
                "mcpPath": mcp_path,
                "hideAudiences": audiences,
                "payableTools": registry.dispatch_tools(),
            }
            if views is not None:
                config["views"] = views
            if api_base_url is not None:
                config["apiBaseUrl"] = api_base_url
            payload: dict[str, object] = {"rpc": rpc, "config": config}
            auth = request.headers.get("authorization")
            if auth:
                payload["authHeader"] = auth
            protocol = request.headers.get("mcp-protocol-version")
            if protocol:
                payload["mcpProtocolVersionHeader"] = protocol
            ua = request.headers.get("user-agent")
            if ua:
                config["userAgent"] = ua
            envelope = await _invoke_json(client, "mcp_dispatch", payload)
            if not isinstance(envelope, dict):
                raise WorkersSolvaPayError("mcpDispatch returned a non-object envelope")
            kind = envelope.get("kind")
            if kind == "challenge":
                status = envelope.get("status")
                return JSONResponse(
                    envelope.get("body"),
                    status_code=int(status) if isinstance(status, int) else 401,
                    headers=_header_map(envelope.get("headers")),
                )
            if kind == "invokeHandler":
                resumed = await complete_invoke_handler(
                    envelope,
                    registry=registry,
                    client=client,
                    js_module=js_module,
                    limits_cache=limits_cache,
                    customer_cache=customer_cache,
                    claimed=claimed,
                )
                rpc_body = resumed.get("rpc")
                return JSONResponse(rpc_body, status_code=200)
            rpc_body = envelope.get("rpc") if kind == "rpc" else envelope
            status = envelope.get("status") if kind == "rpc" else None
            return JSONResponse(
                rpc_body,
                status_code=int(status) if isinstance(status, int) else 200,
            )
        except WorkersSolvaPayError as exc:
            return _jsonrpc_internal_error(rpc.get("id"), str(exc))

    async def handle_oauth(request: Request) -> Response:
        if request.method == "OPTIONS":
            return Response(status_code=204)
        try:
            body = (await request.body()).decode("utf-8")
            headers = {key.lower(): value for key, value in request.headers.items()}
            path = request.url.path
            if request.url.query:
                path = f"{path}?{request.url.query}"
            envelope = await _invoke_json(
                client,
                "mcp_oauth_request",
                {
                    "method": request.method,
                    "path": path,
                    "headers": headers,
                    "body": body,
                    "config": {
                        "publicBaseUrl": public_base_url,
                        "productRef": product_ref,
                        "mcpPath": mcp_path,
                    },
                },
            )
            if not isinstance(envelope, dict):
                raise WorkersSolvaPayError("mcpOauthRequest returned a non-object envelope")
            status = envelope.get("status")
            return JSONResponse(
                envelope.get("body"),
                status_code=int(status) if isinstance(status, int) else 500,
                headers=_header_map(envelope.get("headers")),
            )
        except WorkersSolvaPayError as exc:
            return JSONResponse({"error": str(exc)}, status_code=exc.status or 500)

    app = Starlette(
        routes=[
            Route("/health", endpoint=health),
            Route(mcp_path, endpoint=handle_mcp, methods=["POST", "OPTIONS"]),
            Route(
                "/{path:path}",
                endpoint=handle_oauth,
                methods=["GET", "POST", "DELETE", "OPTIONS"],
            ),
        ]
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["GET", "POST", "DELETE", "OPTIONS"],
        allow_headers=["*"],
        expose_headers=["Mcp-Session-Id", "mcp-session-id", "WWW-Authenticate"],
    )
    return app
