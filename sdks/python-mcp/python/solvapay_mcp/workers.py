"""Interim Pyodide / Cloudflare Workers FFI over `@solvapay/server-wasm`.

The native `solvapay` package is a maturin/PyO3 cdylib. Pyodide cannot load that
`.so`. This module wraps the already-shipped workerd `WasmClient` (async
`str -> str` JSON envelopes) so Starlette can call the same methods
`facade_api_client` would.

Delete this module when the locally-built PyEmscripten wheel lands — see
`docs/contributing/pyodide-emscripten-wheel.md`.
"""

from __future__ import annotations

import inspect
import json
import re
from collections.abc import Mapping

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


def build_workers_http_app(
    js_client: object,
    *,
    product_ref: str,
    public_base_url: str,
    resource_uri: str = "ui://cloudflare-workers-mcp/mcp-app.html",
    mcp_path: str = "/mcp",
    hide_audiences: list[str] | None = None,
) -> ASGIApp:
    """Starlette app: `/mcp` via `mcpDispatch`, everything else via `mcpOauthRequest`.

    Custom Python payable handlers are not wired here — `invokeHandler` needs
    `mcpResume` on the host, which stays on the native path. Builtin tools and
    OAuth work through the wasm engine. The PyEmscripten wheel follow-up restores
    unmodified `create_mcp_oauth_starlette` / `build_http_app`.
    """
    client = wasm_facade_api_client(js_client)
    audiences = hide_audiences if hide_audiences is not None else ["ui"]

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
        config: dict[str, object] = {
            "productRef": product_ref,
            "publicBaseUrl": public_base_url,
            "resourceUri": resource_uri,
            "mcpPath": mcp_path,
            "hideAudiences": audiences,
        }
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
            return JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": rpc.get("id"),
                    "error": {
                        "code": -32603,
                        "message": (
                            "invokeHandler is not available on the interim wasm FFI path; "
                            "use builtin tools or the PyEmscripten wheel"
                        ),
                    },
                },
                status_code=200,
            )
        rpc_body = envelope.get("rpc") if kind == "rpc" else envelope
        status = envelope.get("status") if kind == "rpc" else None
        return JSONResponse(
            rpc_body,
            status_code=int(status) if isinstance(status, int) else 200,
        )

    async def handle_oauth(request: Request) -> Response:
        if request.method == "OPTIONS":
            return Response(status_code=204)
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
