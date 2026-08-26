from __future__ import annotations

import json
from collections.abc import Callable, Mapping
from urllib.parse import quote, urlencode

import httpx
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, RedirectResponse, Response
from starlette.routing import Mount, Route
from starlette.types import ASGIApp, Receive, Scope, Send

from solvapay_mcp.oauth.auth_bridge import build_auth_info_from_bearer
from solvapay_mcp.oauth.bearer import McpBearerAuthError
from solvapay_mcp.oauth.config_log import log_mcp_config_once
from solvapay_mcp.oauth.dcr_diagnostics import log_dcr_failure_diagnostic
from solvapay_mcp.oauth.discovery import (
    get_oauth_authorization_server_response,
    get_oauth_protected_resource_response,
    path_aware_protected_resource_path,
    resolve_oauth_paths,
    without_trailing_slash,
)
from solvapay_mcp.oauth.error_normalize import to_oauth_error_body
from solvapay_mcp.oauth.free_methods import McpAuthMode, requires_bearer_auth
from solvapay_mcp.register import reset_request_customer_ref, set_request_customer_ref
from solvapay_mcp.server.native import native_call

NATIVE_CLIENT_ORIGIN_SCHEMES = ("cursor:", "vscode:", "vscode-webview:", "claude:")
PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"
AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server"
OPENID_PATH = "/.well-known/openid-configuration"


class McpOAuthBridgeOptions:
    def __init__(
        self,
        *,
        public_base_url: str,
        api_base_url: str,
        product_ref: str,
        mcp_path: str = "/mcp",
        require_auth: bool = True,
        auth_mode: McpAuthMode = "tools-call",
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self.public_base_url = public_base_url
        self.api_base_url = without_trailing_slash(api_base_url)
        self.product_ref = product_ref
        self.mcp_path = mcp_path
        self.require_auth = require_auth
        self.auth_mode = auth_mode
        self.http_client = http_client
        self.paths = resolve_oauth_paths()
        native_call(
            "assert_valid_product_ref",
            {"productRef": product_ref, "context": "create_mcp_oauth_starlette"},
        )
        log_mcp_config_once(
            api_base_url=self.api_base_url,
            product_ref=product_ref,
            public_base_url=public_base_url,
        )


def _is_native_origin(origin: str) -> bool:
    return any(origin.startswith(scheme) for scheme in NATIVE_CLIENT_ORIGIN_SCHEMES)


def apply_native_cors(request: Request, response: Response) -> None:
    origin = request.headers.get("origin")
    if origin and _is_native_origin(origin):
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"


def _preflight(request: Request) -> Response:
    requested_method = request.headers.get("access-control-request-method", "POST")
    requested_headers = request.headers.get(
        "access-control-request-headers", "authorization, content-type"
    )
    response = Response(status_code=204)
    apply_native_cors(request, response)
    response.headers["Access-Control-Allow-Methods"] = f"{requested_method}, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = requested_headers
    response.headers["Access-Control-Max-Age"] = "600"
    return response


def _method_not_allowed() -> JSONResponse:
    response = JSONResponse({"error": "method_not_allowed"}, status_code=405)
    response.headers["Allow"] = "POST, OPTIONS"
    return response


def _jsonrpc_id(body: object) -> str | int | None:
    if isinstance(body, dict) and "id" in body:
        raw = body["id"]
        if isinstance(raw, str | int) or raw is None:
            return raw
    return None


def _jsonrpc_method(body: object) -> str | None:
    if isinstance(body, dict):
        method = body.get("method")
        if isinstance(method, str):
            return method
    return None


class McpAuthMiddleware:
    def __init__(self, app: ASGIApp, options: McpOAuthBridgeOptions) -> None:
        self.app = app
        self._options = options

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        path = scope.get("path", "")
        method = scope.get("method", "")
        if path != self._options.mcp_path:
            await self.app(scope, receive, send)
            return

        async def send_response(response: Response) -> None:
            await response(scope, receive, send)

        if method not in ("POST", "OPTIONS"):
            response = JSONResponse({"error": "method_not_allowed"}, status_code=405)
            response.headers["Allow"] = "POST, OPTIONS"
            request = Request(scope, receive)
            apply_native_cors(request, response)
            await send_response(response)
            return

        chunks: list[bytes] = []
        more = True
        while more:
            message = await receive()
            chunks.append(message.get("body", b""))
            more = bool(message.get("more_body", False))
        body_bytes = b"".join(chunks)
        consumed = False

        async def replay_receive() -> dict[str, object]:
            nonlocal consumed
            if consumed:
                return {"type": "http.request", "body": b"", "more_body": False}
            consumed = True
            return {"type": "http.request", "body": body_bytes, "more_body": False}

        request = Request(scope, replay_receive)
        if method == "OPTIONS":
            await self.app(scope, replay_receive, send)
            return

        parsed: object = None
        try:
            parsed = json.loads(body_bytes.decode("utf-8") or "null")
        except (json.JSONDecodeError, UnicodeDecodeError):
            parsed = None

        auth_header = None
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                auth_header = value.decode("latin1")
                break
        rpc_method = _jsonrpc_method(parsed)
        gated = requires_bearer_auth(rpc_method, self._options.auth_mode)
        if not auth_header and (not self._options.require_auth or not gated):
            await self.app(scope, replay_receive, send)
            return

        token = set_request_customer_ref(None)
        try:
            auth = build_auth_info_from_bearer(auth_header)
            if auth is None:
                raise McpBearerAuthError("Missing bearer token")
            extra = auth.get("extra")
            ref = extra.get("customer_ref") if isinstance(extra, dict) else None
            if isinstance(ref, str) and ref.strip():
                reset_request_customer_ref(token)
                token = set_request_customer_ref(ref.strip())
            scope["solvapay_auth"] = auth
            await self.app(scope, replay_receive, send)
        except (McpBearerAuthError, ValueError, json.JSONDecodeError):
            response = JSONResponse(
                {
                    "jsonrpc": "2.0",
                    "id": _jsonrpc_id(parsed),
                    "error": {"code": -32001, "message": "Unauthorized"},
                },
                status_code=401,
            )
            apply_native_cors(request, response)
            response.headers["Access-Control-Expose-Headers"] = "WWW-Authenticate"
            public = without_trailing_slash(self._options.public_base_url)
            metadata_path = path_aware_protected_resource_path(self._options.mcp_path)
            response.headers["WWW-Authenticate"] = (
                f'Bearer resource_metadata="{public}{metadata_path}"'
            )
            await send_response(response)
        finally:
            reset_request_customer_ref(token)


def _serialize_form(body: object) -> str:
    if isinstance(body, str):
        return body
    if isinstance(body, Mapping):
        params: list[tuple[str, str]] = []
        for key, value in body.items():
            if value is None:
                continue
            if isinstance(value, list):
                params.extend((str(key), str(item)) for item in value)
            else:
                params.append((str(key), str(value)))
        return urlencode(params)
    return ""


async def _upstream_json(
    client: httpx.AsyncClient,
    method: str,
    url: str,
    *,
    headers: dict[str, str],
    content: str,
    oauth_normalize: bool,
    on_failure: Callable[[int, str], None] | None = None,
) -> Response:
    try:
        upstream = await client.request(method, url, headers=headers, content=content)
    except httpx.HTTPError:
        return JSONResponse({"error": "upstream_unreachable"}, status_code=502)
    text = upstream.text
    if on_failure is not None and not upstream.is_success:
        on_failure(upstream.status_code, text)
    parsed: object
    try:
        parsed = json.loads(text) if text else {}
    except json.JSONDecodeError:
        parsed = text
    if oauth_normalize and not upstream.is_success and upstream.status_code != 204:
        parsed = to_oauth_error_body(parsed, text, upstream.status_code)
    if upstream.status_code == 204 and text == "":
        return Response(status_code=204)
    content_type = upstream.headers.get("content-type", "application/json")
    response: Response
    if isinstance(parsed, dict | list):
        response = JSONResponse(parsed, status_code=upstream.status_code)
    else:
        response = Response(text, status_code=upstream.status_code, media_type=content_type)
    return response


def create_oauth_routes(options: McpOAuthBridgeOptions) -> list[Route]:
    api = options.api_base_url
    product = options.product_ref
    paths = options.paths

    async def client() -> httpx.AsyncClient:
        if options.http_client is not None:
            return options.http_client
        return httpx.AsyncClient()

    async def openid(_request: Request) -> Response:
        return Response(status_code=404)

    async def protected_resource(_request: Request) -> JSONResponse:
        return JSONResponse(
            get_oauth_protected_resource_response(
                options.public_base_url,
                mcp_path=options.mcp_path,
            )
        )

    async def authorization_server(_request: Request) -> JSONResponse:
        return JSONResponse(
            get_oauth_authorization_server_response(options.public_base_url, paths)
        )

    async def register(request: Request) -> Response:
        if request.method == "OPTIONS":
            return _preflight(request)
        if request.method != "POST":
            return _method_not_allowed()
        raw = await request.body()
        http = await client()
        owns = options.http_client is None
        try:
            response = await _upstream_json(
                http,
                "POST",
                f"{api}/v1/customer/auth/register?product_ref={quote(product, safe='')}",
                headers={"content-type": "application/json"},
                content=raw.decode("utf-8") if raw else "{}",
                oauth_normalize=False,
                on_failure=lambda status, body_text: log_dcr_failure_diagnostic(
                    product_ref=product,
                    api_base_url=api,
                    status=status,
                    body_text=body_text,
                ),
            )
        finally:
            if owns:
                await http.aclose()
        apply_native_cors(request, response)
        return response

    async def authorize(request: Request) -> Response:
        if request.method == "OPTIONS":
            return _preflight(request)
        query = request.url.query
        location = f"{api}/v1/customer/auth/authorize"
        if query:
            location = f"{location}?{query}"
        return RedirectResponse(location, status_code=302)

    async def proxy_tokenish(request: Request, upstream_path: str) -> Response:
        if request.method == "OPTIONS":
            return _preflight(request)
        if request.method != "POST":
            return _method_not_allowed()
        content_type = request.headers.get("content-type", "application/x-www-form-urlencoded")
        raw = await request.body()
        if "application/x-www-form-urlencoded" in content_type:
            try:
                form = await request.form()
                content = _serialize_form(dict(form))
            except Exception:
                content = raw.decode("utf-8")
        else:
            content = raw.decode("utf-8") if raw else ""
        headers = {"content-type": content_type}
        authorization = request.headers.get("authorization")
        if authorization:
            headers["authorization"] = authorization
        http = await client()
        owns = options.http_client is None
        try:
            response = await _upstream_json(
                http,
                "POST",
                f"{api}{upstream_path}",
                headers=headers,
                content=content,
                oauth_normalize=True,
            )
        finally:
            if owns:
                await http.aclose()
        apply_native_cors(request, response)
        return response

    async def token(request: Request) -> Response:
        return await proxy_tokenish(request, "/v1/customer/auth/token")

    async def revoke(request: Request) -> Response:
        return await proxy_tokenish(request, "/v1/customer/auth/revoke")

    metadata_paths: list[str] = []
    for candidate in (
        PROTECTED_RESOURCE_PATH,
        path_aware_protected_resource_path(options.mcp_path),
        f"{without_trailing_slash(options.mcp_path)}{PROTECTED_RESOURCE_PATH}",
    ):
        if candidate and candidate not in metadata_paths:
            metadata_paths.append(candidate)
    return [
        Route(OPENID_PATH, openid, methods=["GET"]),
        *[Route(path, protected_resource, methods=["GET"]) for path in metadata_paths],
        Route(AUTHORIZATION_SERVER_PATH, authorization_server, methods=["GET"]),
        Route(paths["register"], register, methods=["POST", "OPTIONS"]),
        Route(paths["authorize"], authorize, methods=["GET", "OPTIONS"]),
        Route(paths["token"], token, methods=["POST", "OPTIONS"]),
        Route(paths["revoke"], revoke, methods=["POST", "OPTIONS"]),
    ]


def mount_mcp_oauth_bridge(mcp_app: ASGIApp, options: McpOAuthBridgeOptions) -> ASGIApp:
    if isinstance(mcp_app, Starlette):
        for route in reversed(create_oauth_routes(options)):
            mcp_app.routes.insert(0, route)
        mcp_app.add_middleware(McpAuthMiddleware, options=options)
        return mcp_app
    outer = Starlette(routes=[*create_oauth_routes(options), Mount("/", app=mcp_app)])
    outer.add_middleware(McpAuthMiddleware, options=options)
    return outer


def create_mcp_oauth_starlette(
    mcp_app: ASGIApp,
    *,
    public_base_url: str,
    api_base_url: str,
    product_ref: str,
    mcp_path: str = "/mcp",
    require_auth: bool = True,
    auth_mode: McpAuthMode = "tools-call",
    http_client: httpx.AsyncClient | None = None,
) -> ASGIApp:
    options = McpOAuthBridgeOptions(
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        product_ref=product_ref,
        mcp_path=mcp_path,
        require_auth=require_auth,
        auth_mode=auth_mode,
        http_client=http_client,
    )
    return mount_mcp_oauth_bridge(mcp_app, options)
