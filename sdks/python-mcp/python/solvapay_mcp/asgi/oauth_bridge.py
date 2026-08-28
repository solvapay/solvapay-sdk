from __future__ import annotations

import json
from collections.abc import Mapping
from urllib.parse import urlencode

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Mount
from starlette.types import ASGIApp, Receive, Scope, Send

from solvapay_mcp.asgi.mcp_oauth_request import (
    McpOauthRequestConfig,
    mcp_oauth_request,
)
from solvapay_mcp.oauth.auth_bridge import build_auth_info_from_bearer
from solvapay_mcp.oauth.auth_gate import mcp_auth_gate
from solvapay_mcp.oauth.bearer import McpBearerAuthError
from solvapay_mcp.oauth.config_log import log_mcp_config_once
from solvapay_mcp.oauth.discovery import (
    path_aware_protected_resource_path,
    resolve_oauth_paths,
    without_trailing_slash,
)
from solvapay_mcp.oauth.free_methods import McpAuthMode
from solvapay_mcp.register import (
    reset_request_auth_header,
    reset_request_customer_ref,
    reset_request_user_agent,
    set_request_auth_header,
    set_request_customer_ref,
    set_request_user_agent,
)
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
        oauth_client: object | None = None,
        oauth_paths: Mapping[str, str] | None = None,
    ) -> None:
        self.public_base_url = public_base_url
        self.api_base_url = without_trailing_slash(api_base_url)
        self.product_ref = product_ref
        self.mcp_path = mcp_path
        self.require_auth = require_auth
        self.auth_mode: McpAuthMode = auth_mode
        self.oauth_client = oauth_client
        self.paths = resolve_oauth_paths(oauth_paths)
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
        user_agent = None
        for key, value in scope.get("headers", []):
            if key == b"authorization":
                auth_header = value.decode("latin1")
            elif key == b"user-agent":
                user_agent = value.decode("latin1")
        auth_header_token = set_request_auth_header(auth_header)
        user_agent_token = set_request_user_agent(user_agent)
        try:
            rpc_method = _jsonrpc_method(parsed)
            if self._options.require_auth:
                gate = mcp_auth_gate(
                    public_base_url=self._options.public_base_url,
                    rpc_method=rpc_method,
                    auth_header=auth_header,
                    auth_mode=self._options.auth_mode,
                    mcp_path=self._options.mcp_path,
                    json_rpc_id=_jsonrpc_id(parsed),
                )
                if gate.get("kind") == "challenge":
                    body = gate.get("body")
                    status = gate.get("status")
                    response = JSONResponse(
                        body if isinstance(body, dict) else {"error": "Unauthorized"},
                        status_code=status if isinstance(status, int) else 401,
                    )
                    apply_native_cors(request, response)
                    headers = gate.get("headers")
                    if isinstance(headers, dict):
                        for key, value in headers.items():
                            if isinstance(value, str):
                                response.headers[str(key)] = value
                    await send_response(response)
                    return
            if not auth_header:
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
        finally:
            reset_request_auth_header(auth_header_token)
            reset_request_user_agent(user_agent_token)


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


def _oauth_config(options: McpOAuthBridgeOptions) -> McpOauthRequestConfig:
    config: McpOauthRequestConfig = {
        "publicBaseUrl": options.public_base_url,
        "productRef": options.product_ref,
        "apiBaseUrl": options.api_base_url,
        "mcpPath": options.mcp_path,
        "oauthPaths": {
            "register": options.paths["register"],
            "authorize": options.paths["authorize"],
            "token": options.paths["token"],
            "revoke": options.paths["revoke"],
        },
    }
    return config


def _response_from_result(result: Mapping[str, object]) -> Response:
    status = result.get("status")
    if not isinstance(status, int):
        raise RuntimeError("mcpOauthRequest returned a result without status")
    headers: dict[str, str] = {}
    raw_headers = result.get("headers")
    if isinstance(raw_headers, dict):
        for key, value in raw_headers.items():
            if isinstance(value, str):
                headers[str(key)] = value
    body = result.get("body")
    if body is None:
        return Response(status_code=status, headers=headers)
    if isinstance(body, str):
        return Response(body, status_code=status, headers=headers)
    return JSONResponse(body, status_code=status, headers=headers)


def _request_headers(request: Request) -> dict[str, str]:
    return {key.lower(): value for key, value in request.headers.items()}


async def _read_body(request: Request) -> str:
    if request.method in ("GET", "OPTIONS", "HEAD"):
        return ""
    content_type = request.headers.get("content-type", "application/json")
    raw = await request.body()
    if "application/x-www-form-urlencoded" in content_type:
        try:
            form = await request.form()
            return _serialize_form(dict(form))
        except Exception:
            return raw.decode("utf-8") if raw else ""
    return raw.decode("utf-8") if raw else ""


def _is_oauth_path(path: str, options: McpOAuthBridgeOptions) -> bool:
    if path in {OPENID_PATH, AUTHORIZATION_SERVER_PATH, PROTECTED_RESOURCE_PATH}:
        return True
    if path.startswith(f"{PROTECTED_RESOURCE_PATH}/"):
        return True
    if path.endswith(PROTECTED_RESOURCE_PATH):
        return True
    return path in {
        options.paths["register"],
        options.paths["authorize"],
        options.paths["token"],
        options.paths["revoke"],
    }


class OauthCatchAll:
    def __init__(self, app: ASGIApp, options: McpOAuthBridgeOptions) -> None:
        self.app = app
        self._options = options
        self._config = _oauth_config(options)

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        path = str(scope.get("path") or "")
        if scope["type"] != "http" or not _is_oauth_path(path, self._options):
            await self.app(scope, receive, send)
            return
        request = Request(scope, receive)
        query = request.url.query
        path = request.url.path
        full_path = f"{path}?{query}" if query else path
        result = await mcp_oauth_request(
            {
                "method": request.method,
                "path": full_path,
                "headers": _request_headers(request),
                "body": await _read_body(request),
                "config": self._config,
            },
            client=self._options.oauth_client,
        )
        response = _response_from_result(result)
        await response(scope, receive, send)


def mount_mcp_oauth_bridge(mcp_app: ASGIApp, options: McpOAuthBridgeOptions) -> ASGIApp:
    if isinstance(mcp_app, Starlette):
        mcp_app.add_middleware(McpAuthMiddleware, options=options)
        mcp_app.add_middleware(OauthCatchAll, options=options)
        return mcp_app
    outer = Starlette(routes=[Mount("/", app=mcp_app)])
    outer.add_middleware(McpAuthMiddleware, options=options)
    outer.add_middleware(OauthCatchAll, options=options)
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
    oauth_client: object | None = None,
    oauth_paths: Mapping[str, str] | None = None,
) -> ASGIApp:
    options = McpOAuthBridgeOptions(
        public_base_url=public_base_url,
        api_base_url=api_base_url,
        product_ref=product_ref,
        mcp_path=mcp_path,
        require_auth=require_auth,
        auth_mode=auth_mode,
        oauth_client=oauth_client,
        oauth_paths=oauth_paths,
    )
    return mount_mcp_oauth_bridge(mcp_app, options)
