"""Customer sign-in for a SolvaPay MCP server.

Ported from ``@solvapay/mcp/fetch`` (``oauth-bridge.ts``, ``cors.ts``, ``handler.ts``),
``@solvapay/mcp`` (``internal/oauth-error-normalize.ts``) and ``@solvapay/mcp-core``
(``oauth-discovery.ts``, ``bearer.ts``, ``dcr-diagnostics.ts``).

MCP clients sign the customer in with OAuth. The server acts as the
authorization server they see, and forwards each step to SolvaPay:

- ``/.well-known/oauth-protected-resource`` and
  ``/.well-known/oauth-authorization-server``: this server, and its endpoints.
- ``/oauth/register``: dynamic client registration, for this product.
- ``/oauth/authorize``: a redirect to SolvaPay's sign-in.
- ``/oauth/token`` and ``/oauth/revoke``: forwarded as received; errors come back
  as RFC 6749 errors.

``SignInMiddleware`` guards the MCP endpoint: a request without a bearer token
whose payload names a customer gets a 401 that points at the protected-resource
document. Unlike the TypeScript SDK, which reads the customer from the token
without checking it, ``SolvaPayTokenVerifier`` then checks each token with
SolvaPay (``/v1/customer/auth/userinfo``): the customer a tool sees has been
verified by SolvaPay, never read from an unverified token.

CORS: only native MCP clients' origins (``cursor://``, ``vscode://``,
``vscode-webview://``, ``claude://``) are mirrored, never with credentials.
"""

from __future__ import annotations

import base64
import binascii
import json
import logging
import re
import time
from collections import OrderedDict
from collections.abc import MutableMapping
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server.auth.middleware.auth_context import auth_context_var
from mcp.server.auth.middleware.bearer_auth import AuthenticatedUser
from mcp.server.auth.provider import AccessToken
from starlette.authentication import AuthCredentials
from starlette.datastructures import Headers, MutableHeaders
from starlette.requests import Request
from starlette.responses import JSONResponse, PlainTextResponse, Response
from starlette.routing import Route
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..errors import SolvaPayError

logger = logging.getLogger("solvapay.mcp")

Json = dict[str, Any]

DEFAULT_OAUTH_PATHS = {
    "register": "/oauth/register",
    "authorize": "/oauth/authorize",
    "token": "/oauth/token",
    "revoke": "/oauth/revoke",
}
PROTECTED_RESOURCE_PATH = "/.well-known/oauth-protected-resource"
AUTHORIZATION_SERVER_PATH = "/.well-known/oauth-authorization-server"
OPENID_CONFIGURATION_PATH = "/.well-known/openid-configuration"
SCOPES = ["openid", "profile", "email"]
OAUTH_ERROR_CODES = frozenset(
    {
        "invalid_request",
        "invalid_client",
        "invalid_grant",
        "unauthorized_client",
        "unsupported_grant_type",
        "invalid_scope",
        "server_error",
        "temporarily_unavailable",
        "access_denied",
    }
)
CUSTOMER_CLAIMS = ("customerRef", "customer_ref", "sub")
ALL_METHODS = ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
_MISSING = object()
_NATIVE_CLIENT_ORIGIN = re.compile(r"^(cursor|vscode|vscode-webview|claude)://.+$")
# Hop-by-hop or re-encoded headers an upstream answer must not carry on.
_NOT_FORWARDED = frozenset(
    {"content-length", "content-encoding", "transfer-encoding", "connection"}
)


def _base(url: str) -> str:
    return url.removesuffix("/")


def protected_resource_metadata(public_base_url: str) -> Json:
    """``getOAuthProtectedResourceResponse``: this server is the resource and its own
    authorization server."""
    resource = _base(public_base_url)
    return {"resource": resource, "authorization_servers": [resource], "scopes_supported": SCOPES}


def authorization_server_metadata(public_base_url: str, paths: dict[str, str]) -> Json:
    """``getOAuthAuthorizationServerResponse``."""
    base = _base(public_base_url)
    return {
        "issuer": base,
        "authorization_endpoint": f"{base}{paths['authorize']}",
        "token_endpoint": f"{base}{paths['token']}",
        "registration_endpoint": f"{base}{paths['register']}",
        "revocation_endpoint": f"{base}{paths['revoke']}",
        "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
        "response_types_supported": ["code"],
        "grant_types_supported": ["authorization_code", "refresh_token"],
        "scopes_supported": SCOPES,
        "code_challenge_methods_supported": ["S256"],
    }


# ---- bearer tokens (bearer.ts) ---------------------------------------------------


def extract_bearer_token(authorization: str | None) -> str | None:
    """``extractBearerToken``: the token after ``Bearer `` (case-sensitive), trimmed."""
    if not authorization or not authorization.startswith("Bearer "):
        return None
    return authorization[7:].strip() or None


def decode_jwt_payload(token: str) -> Json | None:
    """``decodeJwtPayload`` without the signature check: the claims, or None when the
    token is not a JWT with a JSON object payload."""
    parts = token.split(".")
    if len(parts) < 2:
        return None
    segment = parts[1]
    try:
        raw = base64.urlsafe_b64decode(segment + "=" * (-len(segment) % 4))
        payload = json.loads(raw.decode("utf-8"))
    except (binascii.Error, ValueError):
        return None
    return payload if isinstance(payload, dict) else None


def customer_ref_claim(payload: Json) -> str | None:
    """``getCustomerRefFromJwtPayload``: the first non-blank of customerRef, customer_ref, sub."""
    for claim in CUSTOMER_CLAIMS:
        value = payload.get(claim)
        if isinstance(value, str) and value.strip():
            return value.strip()
    return None


class SolvaPayTokenVerifier:
    """Verifies a customer's bearer token with SolvaPay. Valid tokens are cached briefly."""

    def __init__(
        self,
        *,
        api_base_url: str,
        cache_seconds: float = 60.0,
        max_entries: int = 1000,
        http_client: httpx.AsyncClient | None = None,
    ) -> None:
        self._userinfo = f"{_base(api_base_url)}/v1/customer/auth/userinfo"
        self._cache: OrderedDict[str, tuple[float, AccessToken]] = OrderedDict()
        self._cache_seconds = cache_seconds
        self._max_entries = max_entries
        self._client = http_client or httpx.AsyncClient(timeout=10.0)

    async def verify_token(self, token: str) -> AccessToken | None:
        cached = self._cache.get(token)
        now = time.monotonic()
        if cached and now - cached[0] < self._cache_seconds:
            return cached[1]
        try:
            response = await self._client.get(
                self._userinfo, headers={"Authorization": f"Bearer {token}"}
            )
        except httpx.TransportError as error:
            raise SolvaPayError(
                f"Could not reach SolvaPay to verify the token: {error}", code="network_error"
            ) from error
        if response.status_code in (401, 403):
            self._cache.pop(token, None)
            return None
        if response.status_code != 200:
            raise SolvaPayError(
                f"SolvaPay answered {response.status_code} when verifying a token",
                code="token_verification_failed",
                status=response.status_code,
            )
        claims = response.json()
        subject = claims.get("sub")
        if not isinstance(subject, str) or not subject:
            raise SolvaPayError(
                "SolvaPay's userinfo has no customer (sub)", code="token_verification_failed"
            )
        access = AccessToken(
            token=token,
            client_id=str(claims.get("client_id") or "solvapay"),
            scopes=SCOPES,
            subject=subject,
            claims={**claims, "customer_ref": subject},
        )
        self._cache[token] = (now, access)
        self._cache.move_to_end(token)
        while len(self._cache) > self._max_entries:
            self._cache.popitem(last=False)
        return access


# ---- CORS (cors.ts) -------------------------------------------------------------


def is_native_client_origin(origin: str | None) -> bool:
    """``isNativeClientOrigin``: a native MCP client's scheme, mirrored instead of ``*``."""
    return bool(origin) and _NATIVE_CLIENT_ORIGIN.match(origin or "") is not None


def apply_native_cors(request_headers: Headers, response_headers: MutableHeaders) -> None:
    """``applyNativeCors``: mirror a native client's origin. Web origins get nothing, and
    credentials are never allowed."""
    origin = request_headers.get("origin")
    if origin and is_native_client_origin(origin):
        response_headers["Access-Control-Allow-Origin"] = origin
        response_headers.append("Vary", "Origin")


def _cors(request: Request, response: Response) -> Response:
    apply_native_cors(request.headers, response.headers)
    return response


def cors_preflight(request_headers: Headers) -> Response:
    """``corsPreflight``: 204, the requested method and headers echoed, a 600 s max age."""
    method = request_headers.get("access-control-request-method", "POST")
    allowed = request_headers.get("access-control-request-headers", "authorization, content-type")
    response = Response(status_code=204)
    apply_native_cors(request_headers, response.headers)
    response.headers["Access-Control-Allow-Methods"] = f"{method}, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = allowed
    response.headers["Access-Control-Max-Age"] = "600"
    return response


def auth_challenge(request_headers: Headers, public_base_url: str, json_rpc_id: Any) -> Response:
    """``authChallenge``: 401, a JSON-RPC -32001 error, and ``WWW-Authenticate`` pointing at
    the protected-resource document."""
    response = JSONResponse(
        {"jsonrpc": "2.0", "id": json_rpc_id, "error": {"code": -32001, "message": "Unauthorized"}},
        status_code=401,
    )
    apply_native_cors(request_headers, response.headers)
    response.headers["Access-Control-Expose-Headers"] = "WWW-Authenticate"
    response.headers["WWW-Authenticate"] = (
        f'Bearer resource_metadata="{_base(public_base_url)}{PROTECTED_RESOURCE_PATH}"'
    )
    return response


def not_found() -> Response:
    """What the TypeScript handler answers for a path or method nothing claims."""
    return PlainTextResponse("not_found", status_code=404)


# ---- OAuth error bodies (oauth-error-normalize.ts) ------------------------------


def _validation_errors(body: Json) -> list[Json]:
    errors = body.get("errors")
    if not isinstance(errors, list):
        return []
    return [error for error in errors if isinstance(error, dict)]


def _touches(errors: list[Json], field: str) -> Json | None:
    for error in errors:
        path = error.get("path")
        if isinstance(path, list) and field in path:
            return error
    return None


def derive_oauth_error_code(status: int, body: Json) -> str:
    """``deriveOAuthErrorCode``: by status first, then by the validation error's field."""
    if status in (401, 403):
        return "invalid_client"
    if status >= 500:
        return "server_error"
    errors = _validation_errors(body)
    grant_type = _touches(errors, "grant_type")
    if grant_type is not None:
        # A missing `received` is JavaScript's undefined; JSON null is not.
        received = grant_type.get("received", _MISSING)
        if received is not _MISSING and received not in ("undefined", ""):
            return "unsupported_grant_type"
        return "invalid_request"
    if _touches(errors, "code") or _touches(errors, "refresh_token"):
        return "invalid_grant"
    if _touches(errors, "scope"):
        return "invalid_scope"
    if _touches(errors, "client_id") or _touches(errors, "client_secret"):
        return "invalid_client"
    return "invalid_request"


def build_error_description(body: Json) -> str | None:
    """``buildErrorDescription``: ``path: message; …`` from validation errors, else the
    message (a list joined with ``; ``)."""
    parts = []
    for error in _validation_errors(body):
        path = error.get("path")
        message = error.get("message")
        path_text = (
            ".".join(p for p in path if isinstance(p, str)) if isinstance(path, list) else ""
        )
        message_text = message if isinstance(message, str) else ""
        part = (
            f"{path_text}: {message_text}"
            if path_text and message_text
            else path_text or message_text
        )
        if part:
            parts.append(part)
    if parts:
        return "; ".join(parts)
    message = body.get("message")
    if isinstance(message, str):
        return message
    if isinstance(message, list):
        strings = [m for m in message if isinstance(m, str)]
        if strings:
            return "; ".join(strings)
    return None


def to_oauth_error_body(body: Any, text: str, status: int) -> Json:
    """``toOAuthErrorBody``: a body with a token error code passes through; any other is
    mapped."""
    if isinstance(body, dict) and body.get("error") in OAUTH_ERROR_CODES:
        return body
    if isinstance(body, (dict, list)):
        # Any JSON object (an array too, as in JavaScript) is read as NestJS's shape.
        fields = body if isinstance(body, dict) else {}
        code = derive_oauth_error_code(status, fields)
        description = build_error_description(fields)
        return {"error": code, "error_description": description} if description else {"error": code}
    fallback = "server_error" if status >= 500 else "invalid_request"
    if text and len(text) < 500:
        return {"error": fallback, "error_description": text}
    return {"error": fallback}


def _parse_upstream(text: str) -> Any:
    if not text:
        return {}
    try:
        return json.loads(text)
    except ValueError:
        return text


def log_dcr_failure(product_ref: str, api_base_url: str, status: int, body: str) -> None:
    """``logDcrFailureDiagnostic``: name the likely cause of a refused registration."""
    unresolved = re.search(r"invalid identifier", body, re.IGNORECASE) or (
        re.search(r"product_ref", body, re.IGNORECASE)
        and re.search(r"mcp_server_id", body, re.IGNORECASE)
    )
    hint = (
        "The platform could not resolve this product_ref (often a wrong or missing product, "
        "or an API base URL mismatch). A 400 'Invalid identifier' here means the product did "
        "not resolve, not that the registration body was malformed."
        if unresolved
        else "SolvaPay rejected the registration."
    )
    logger.warning(
        "OAuth dynamic client registration failed (%s) product_ref=%s api_base_url=%s. %s "
        "Check SOLVAPAY_PRODUCT_REF and SOLVAPAY_API_BASE_URL.",
        status,
        product_ref,
        api_base_url,
        hint,
    )


# ---- the bridge (oauth-bridge.ts) -----------------------------------------------


def oauth_bridge_routes(
    *,
    public_base_url: str,
    api_base_url: str,
    product_ref: str,
    paths: dict[str, str] | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> list[Route]:
    """The routes that let MCP clients sign a customer in through this server.

    Each answers every method: one it does not serve is a 404 ``not_found``, as the
    TypeScript handler answers a request no route claims.
    """
    if not product_ref:
        raise SolvaPayError("The OAuth bridge needs a product reference", code="missing_product")
    resolved = {**DEFAULT_OAUTH_PATHS, **(paths or {})}
    api = _base(api_base_url)
    client = http_client or httpx.AsyncClient(timeout=30.0)
    resource = protected_resource_metadata(public_base_url)
    metadata = authorization_server_metadata(public_base_url, resolved)

    def document(body: Json) -> Any:
        async def endpoint(request: Request) -> Response:
            if request.method != "GET":
                return not_found()
            return _cors(request, JSONResponse(body))

        return endpoint

    async def openid_configuration(request: Request) -> Response:
        if request.method != "GET":
            return not_found()
        return _cors(request, Response(status_code=404))

    def passthrough(request: Request, upstream: httpx.Response) -> Response:
        response = Response(content=upstream.content, status_code=upstream.status_code)
        for name, value in upstream.headers.multi_items():
            if name.lower() not in _NOT_FORWARDED:
                response.headers.append(name, value)
        return _cors(request, response)

    def unreachable(request: Request) -> Response:
        return _cors(request, JSONResponse({"error": "upstream_unreachable"}, status_code=502))

    async def register(request: Request) -> Response:
        if request.method == "OPTIONS":
            return cors_preflight(request.headers)
        if request.method != "POST":
            return not_found()
        url = f"{api}/v1/customer/auth/register?product_ref={quote(product_ref, safe='')}"
        content_type = request.headers.get("content-type", "application/json")
        try:
            upstream = await client.post(
                url, content=await request.body(), headers={"content-type": content_type}
            )
        except httpx.TransportError:
            return unreachable(request)
        if not upstream.is_success:
            log_dcr_failure(product_ref, api, upstream.status_code, upstream.text)
        return passthrough(request, upstream)

    async def authorize(request: Request) -> Response:
        if request.method == "OPTIONS":
            return cors_preflight(request.headers)
        if request.method != "GET":
            return not_found()
        query = f"?{request.url.query}" if request.url.query else ""
        return _cors(
            request,
            Response(
                status_code=302, headers={"Location": f"{api}/v1/customer/auth/authorize{query}"}
            ),
        )

    def form_endpoint(url: str) -> Any:
        async def endpoint(request: Request) -> Response:
            if request.method == "OPTIONS":
                return cors_preflight(request.headers)
            if request.method != "POST":
                return not_found()
            # The raw body, so `+` and `%20` in a PKCE verifier reach SolvaPay unchanged.
            headers = {
                "content-type": request.headers.get(
                    "content-type", "application/x-www-form-urlencoded"
                )
            }
            if "authorization" in request.headers:
                headers["authorization"] = request.headers["authorization"]
            try:
                upstream = await client.post(url, content=await request.body(), headers=headers)
            except httpx.TransportError:
                return unreachable(request)
            if upstream.is_success:
                return passthrough(request, upstream)
            body = to_oauth_error_body(
                _parse_upstream(upstream.text), upstream.text, upstream.status_code
            )
            return _cors(request, JSONResponse(body, status_code=upstream.status_code))

        return endpoint

    return [
        Route(OPENID_CONFIGURATION_PATH, openid_configuration, methods=ALL_METHODS),
        Route(PROTECTED_RESOURCE_PATH, document(resource), methods=ALL_METHODS),
        Route(AUTHORIZATION_SERVER_PATH, document(metadata), methods=ALL_METHODS),
        Route(resolved["register"], register, methods=ALL_METHODS),
        Route(resolved["authorize"], authorize, methods=ALL_METHODS),
        Route(
            resolved["token"], form_endpoint(f"{api}/v1/customer/auth/token"), methods=ALL_METHODS
        ),
        Route(
            resolved["revoke"], form_endpoint(f"{api}/v1/customer/auth/revoke"), methods=ALL_METHODS
        ),
    ]


# ---- the MCP endpoint (handler.ts) ----------------------------------------------


def _json_rpc_id(body: bytes) -> Any:
    try:
        message = json.loads(body)
    except ValueError:
        return None
    return message.get("id") if isinstance(message, dict) else None


class SignInMiddleware:
    """Guards the MCP endpoint at ``mcp_path``, as the TypeScript fetch handler does.

    ``OPTIONS`` is a CORS preflight; any method but ``POST`` is a 405. A request
    without a bearer token whose payload names a customer, or whose token SolvaPay
    does not accept, gets ``auth_challenge``. A verified request reaches the MCP
    endpoint as that customer (``get_access_token()``), with native CORS on its answer.
    """

    def __init__(
        self,
        app: ASGIApp,
        *,
        mcp_path: str,
        public_base_url: str,
        verifier: SolvaPayTokenVerifier,
    ) -> None:
        self.app = app
        self.mcp_path = mcp_path
        self.public_base_url = public_base_url
        self.verifier = verifier

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http" or scope["path"] != self.mcp_path:
            await self.app(scope, receive, send)
            return
        headers = Headers(scope=scope)
        method = scope["method"]
        if method == "OPTIONS":
            await cors_preflight(headers)(scope, receive, send)
            return
        if method != "POST":
            response = Response(status_code=405, headers={"Allow": "POST, OPTIONS"})
            apply_native_cors(headers, response.headers)
            await response(scope, receive, send)
            return

        body = await _read_body(receive)
        token = extract_bearer_token(headers.get("authorization"))
        payload = decode_jwt_payload(token) if token else None
        access = (
            await self.verifier.verify_token(token)
            if token and payload is not None and customer_ref_claim(payload)
            else None
        )
        if access is None:
            challenge = auth_challenge(headers, self.public_base_url, _json_rpc_id(body))
            await challenge(scope, receive, send)
            return

        user = AuthenticatedUser(access)
        scope = {**scope, "user": user, "auth": AuthCredentials(access.scopes)}

        async def send_with_cors(message: Message) -> None:
            if message["type"] == "http.response.start":
                apply_native_cors(headers, MutableHeaders(scope=message))
            await send(message)

        context = auth_context_var.set(user)
        try:
            await self.app(scope, _replay(body, receive), send_with_cors)
        finally:
            auth_context_var.reset(context)


async def _read_body(receive: Receive) -> bytes:
    chunks = []
    while True:
        message = await receive()
        if message["type"] != "http.request":
            break
        chunks.append(message.get("body", b""))
        if not message.get("more_body", False):
            break
    return b"".join(chunks)


def _replay(body: bytes, receive: Receive) -> Receive:
    """The body already read, then whatever the client sends next (its disconnect)."""
    sent = False

    async def replay() -> MutableMapping[str, Any]:
        nonlocal sent
        if not sent:
            sent = True
            return {"type": "http.request", "body": body, "more_body": False}
        return await receive()

    return replay
