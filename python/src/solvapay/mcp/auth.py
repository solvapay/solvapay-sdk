"""Customer sign-in for a SolvaPay MCP server.

MCP clients sign the customer in with OAuth. The server acts as the
authorization server they see, and forwards each step to SolvaPay:

- ``/.well-known/oauth-authorization-server``: endpoints on this server.
- ``/oauth/register``: dynamic client registration, for this product.
- ``/oauth/authorize``: a redirect to SolvaPay's sign-in.
- ``/oauth/token`` and ``/oauth/revoke``: forwarded as received.

``SolvaPayTokenVerifier`` checks each bearer token with SolvaPay
(``/v1/customer/auth/userinfo``): the customer a tool sees has been verified
by SolvaPay, never read from an unverified token.
"""

from __future__ import annotations

import time
from collections import OrderedDict
from typing import Any
from urllib.parse import quote

import httpx
from mcp.server.auth.provider import AccessToken
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from ..errors import SolvaPayError

Json = dict[str, Any]

DEFAULT_OAUTH_PATHS = {
    "register": "/oauth/register",
    "authorize": "/oauth/authorize",
    "token": "/oauth/token",
    "revoke": "/oauth/revoke",
}
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


def _base(url: str) -> str:
    return url.rstrip("/")


def authorization_server_metadata(public_base_url: str, paths: dict[str, str]) -> Json:
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


def _cors(request: Request, response: Response) -> Response:
    origin = request.headers.get("origin")
    if origin:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Vary"] = "Origin"
        response.headers["Access-Control-Allow-Credentials"] = "true"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = (
        "Authorization, Content-Type, mcp-protocol-version"
    )
    return response


def _oauth_error_body(status: int, body: Any, text: str) -> Json:
    if isinstance(body, dict) and body.get("error") in OAUTH_ERROR_CODES:
        return body
    if status in (401, 403):
        code = "invalid_client"
    elif status >= 500:
        code = "server_error"
    else:
        code = "invalid_request"
    description = body.get("message") if isinstance(body, dict) else text
    if isinstance(description, list):
        description = "; ".join(str(part) for part in description)
    return {"error": code, "error_description": str(description or f"Upstream status {status}")}


def oauth_bridge_routes(
    *,
    public_base_url: str,
    api_base_url: str,
    product_ref: str,
    paths: dict[str, str] | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> list[Route]:
    """The routes that let MCP clients sign a customer in through this server."""
    if not product_ref:
        raise SolvaPayError("The OAuth bridge needs a product reference", code="missing_product")
    resolved = {**DEFAULT_OAUTH_PATHS, **(paths or {})}
    api = _base(api_base_url)
    client = http_client or httpx.AsyncClient(timeout=30.0)
    metadata = authorization_server_metadata(public_base_url, resolved)

    async def preflight(request: Request) -> Response:
        return _cors(request, Response(status_code=204))

    async def authorization_server(request: Request) -> Response:
        return _cors(request, JSONResponse(metadata))

    async def openid_configuration(request: Request) -> Response:
        return _cors(request, Response(status_code=404))

    async def forward(request: Request, url: str, *, normalize_errors: bool) -> Response:
        if request.method == "OPTIONS":
            return await preflight(request)
        # The raw body, so `+` and `%20` in a PKCE verifier reach SolvaPay unchanged.
        body = await request.body()
        headers = {"content-type": request.headers.get("content-type", "application/json")}
        if "authorization" in request.headers:
            headers["authorization"] = request.headers["authorization"]
        try:
            upstream = await client.post(url, content=body, headers=headers)
        except httpx.TransportError:
            return _cors(request, JSONResponse({"error": "upstream_unreachable"}, status_code=502))
        if normalize_errors and upstream.status_code >= 400:
            try:
                parsed: Any = upstream.json()
            except ValueError:
                parsed = None
            return _cors(
                request,
                JSONResponse(
                    _oauth_error_body(upstream.status_code, parsed, upstream.text),
                    status_code=upstream.status_code,
                ),
            )
        response = Response(
            content=upstream.content,
            status_code=upstream.status_code,
            media_type=upstream.headers.get("content-type"),
        )
        for name in ("cache-control", "pragma"):
            if name in upstream.headers:
                response.headers[name] = upstream.headers[name]
        return _cors(request, response)

    async def register(request: Request) -> Response:
        url = f"{api}/v1/customer/auth/register?product_ref={quote(product_ref, safe='')}"
        return await forward(request, url, normalize_errors=False)

    async def authorize(request: Request) -> Response:
        if request.method == "OPTIONS":
            return await preflight(request)
        query = f"?{request.url.query}" if request.url.query else ""
        return _cors(
            request,
            Response(
                status_code=302, headers={"Location": f"{api}/v1/customer/auth/authorize{query}"}
            ),
        )

    async def token(request: Request) -> Response:
        return await forward(request, f"{api}/v1/customer/auth/token", normalize_errors=True)

    async def revoke(request: Request) -> Response:
        return await forward(request, f"{api}/v1/customer/auth/revoke", normalize_errors=True)

    return [
        Route("/.well-known/oauth-authorization-server", authorization_server, methods=["GET"]),
        Route("/.well-known/openid-configuration", openid_configuration, methods=["GET"]),
        Route(resolved["register"], register, methods=["POST", "OPTIONS"]),
        Route(resolved["authorize"], authorize, methods=["GET", "OPTIONS"]),
        Route(resolved["token"], token, methods=["POST", "OPTIONS"]),
        Route(resolved["revoke"], revoke, methods=["POST", "OPTIONS"]),
    ]
