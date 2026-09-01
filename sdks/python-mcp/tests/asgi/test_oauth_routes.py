from __future__ import annotations

from collections.abc import AsyncIterator
from unittest.mock import patch

import httpx
import pytest
from solvapay.errors import SolvaPayError
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.routing import Route

from solvapay_mcp.asgi.oauth_bridge import create_mcp_oauth_starlette
from tests.server.recording_client import RecordingClient


def _oauth_recording() -> RecordingClient:
    def respond(payload: dict[str, object]) -> dict[str, object]:
        path = str(payload.get("path") or "").split("?", 1)[0]
        method = str(payload.get("method") or "GET").upper()
        headers = payload.get("headers") if isinstance(payload.get("headers"), dict) else {}
        origin = headers.get("origin") if isinstance(headers, dict) else None
        cors: dict[str, str] = {}
        if isinstance(origin, str) and origin.startswith("cursor:"):
            cors = {"access-control-allow-origin": origin, "vary": "Origin"}
        if method == "OPTIONS":
            return {
                "status": 204,
                "headers": {
                    **cors,
                    "access-control-allow-methods": "GET, POST, OPTIONS",
                    "access-control-allow-headers": "authorization, content-type",
                    "access-control-max-age": "600",
                },
                "body": None,
            }
        if path == "/.well-known/openid-configuration":
            return {"status": 404, "headers": cors, "body": None}
        if "oauth-protected-resource" in path:
            return {
                "status": 200,
                "headers": {"content-type": "application/json", **cors},
                "body": {
                    "resource": "https://mcp.example.com/mcp",
                    "authorization_servers": ["https://mcp.example.com"],
                    "bearer_methods_supported": ["header"],
                },
            }
        if path == "/.well-known/oauth-authorization-server":
            return {
                "status": 200,
                "headers": {"content-type": "application/json", **cors},
                "body": {"issuer": "https://mcp.example.com"},
            }
        if path.startswith("/oauth/authorize"):
            qs = str(payload.get("path") or "").split("?", 1)
            suffix = f"?{qs[1]}" if len(qs) == 2 else ""
            return {
                "status": 302,
                "headers": {"location": f"https://api.test/v1/customer/auth/authorize{suffix}", **cors},
                "body": None,
            }
        if path.endswith("/oauth/register"):
            return {"status": 201, "headers": {"content-type": "application/json", **cors}, "body": {"client_id": "cid"}}
        if path.endswith("/oauth/token"):
            return {
                "status": 200,
                "headers": {"content-type": "application/json", **cors},
                "body": {"access_token": "tok"},
            }
        if path.endswith("/oauth/revoke"):
            return {"status": 204, "headers": cors, "body": None}
        return {"status": 404, "headers": cors, "body": {"error": "not_found"}}

    return RecordingClient(responses={"mcp_oauth_request": respond})


async def _mcp(request: Request) -> JSONResponse:
    body = await request.json()
    return JSONResponse({"jsonrpc": "2.0", "id": body.get("id"), "result": {"ok": True}})


@pytest.fixture
def upstream_calls() -> list[dict[str, object]]:
    return []


@pytest.fixture
async def client(upstream_calls: list[dict[str, object]]) -> AsyncIterator[httpx.AsyncClient]:
    async def register(request: Request) -> JSONResponse:
        upstream_calls.append(
            {
                "path": request.url.path,
                "query": str(request.url.query),
                "body": await request.json(),
            }
        )
        return JSONResponse({"client_id": "cid"}, status_code=201)

    async def token(request: Request) -> JSONResponse:
        upstream_calls.append({"path": request.url.path, "body": (await request.body()).decode()})
        return JSONResponse({"access_token": "tok"})

    async def revoke(request: Request) -> Response:
        upstream_calls.append({"path": request.url.path})
        return Response(status_code=204)

    upstream = Starlette(
        routes=[
            Route("/v1/customer/auth/register", register, methods=["POST"]),
            Route("/v1/customer/auth/token", token, methods=["POST"]),
            Route("/v1/customer/auth/revoke", revoke, methods=["POST"]),
        ]
    )
    transport = httpx.ASGITransport(app=upstream)
    async with httpx.AsyncClient(transport=transport, base_url="https://api.test") as http:
        mcp_app = Starlette(routes=[Route("/mcp", _mcp, methods=["POST", "OPTIONS", "GET"])])
        app = create_mcp_oauth_starlette(
            mcp_app,
            public_base_url="https://mcp.example.com",
            api_base_url="https://api.test",
            product_ref="prd_demo",
            oauth_client=_oauth_recording(),
        )
        asgi = httpx.ASGITransport(app=app)
        async with httpx.AsyncClient(
            transport=asgi, base_url="https://mcp.example.com"
        ) as test_client:
            yield test_client


@pytest.fixture
async def strict_client() -> AsyncIterator[httpx.AsyncClient]:
    mcp_app = Starlette(routes=[Route("/mcp", _mcp, methods=["POST", "OPTIONS", "GET"])])
    app = create_mcp_oauth_starlette(
        mcp_app,
        public_base_url="https://mcp.example.com",
        api_base_url="https://api.test",
        product_ref="prd_demo",
        auth_mode="all",
    )
    asgi = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=asgi, base_url="https://mcp.example.com"
    ) as test_client:
        yield test_client


_MCP_CHALLENGE = (
    'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource/mcp"'
)


@pytest.mark.asyncio
async def test_register_forwards_to_upstream(
    client: httpx.AsyncClient, upstream_calls: list[dict[str, object]]
) -> None:
    response = await client.post("/oauth/register", json={"client_name": "jam"})
    assert response.status_code == 201
    assert response.json() == {"client_id": "cid"}


@pytest.mark.asyncio
async def test_authorize_redirects_preserving_query(client: httpx.AsyncClient) -> None:
    response = await client.get("/oauth/authorize?code_challenge=abc", follow_redirects=False)
    assert response.status_code == 302
    assert response.headers["location"] == (
        "https://api.test/v1/customer/auth/authorize?code_challenge=abc"
    )


@pytest.mark.asyncio
async def test_token_and_revoke_proxy(client: httpx.AsyncClient) -> None:
    token = await client.post(
        "/oauth/token",
        content="grant_type=authorization_code",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert token.status_code == 200
    revoke = await client.post(
        "/oauth/revoke",
        content="token=tok",
        headers={"content-type": "application/x-www-form-urlencoded"},
    )
    assert revoke.status_code == 204


@pytest.mark.asyncio
async def test_unauthenticated_tools_call_returns_401_challenge(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 7, "method": "tools/call", "params": {"name": "upgrade"}},
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == _MCP_CHALLENGE
    assert response.json() == {
        "jsonrpc": "2.0",
        "id": 7,
        "error": {"code": -32001, "message": "Unauthorized"},
    }


@pytest.mark.asyncio
async def test_unexpected_bearer_build_failure_is_not_a_401(
    client: httpx.AsyncClient,
) -> None:
    with patch(
        "solvapay_mcp.asgi.oauth_bridge.build_auth_info_from_bearer",
        side_effect=RuntimeError("jwks exploded"),
    ):
        try:
            response = await client.post(
                "/mcp",
                json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                headers={"authorization": "Bearer not-a-token"},
            )
        except RuntimeError as err:
            assert "jwks exploded" in str(err)
            return
        assert response.status_code != 401


@pytest.mark.asyncio
async def test_unauthenticated_initialize_is_allowed(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert response.status_code == 200
    assert response.json()["result"] == {"ok": True}


@pytest.mark.asyncio
async def test_strict_auth_challenges_unauthenticated_initialize(
    strict_client: httpx.AsyncClient,
) -> None:
    response = await strict_client.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
    )
    assert response.status_code == 401
    assert response.headers["www-authenticate"] == _MCP_CHALLENGE
    assert response.json() == {
        "jsonrpc": "2.0",
        "id": 1,
        "error": {"code": -32001, "message": "Unauthorized"},
    }


@pytest.mark.asyncio
async def test_native_scheme_cors_on_401(client: httpx.AsyncClient) -> None:
    response = await client.post(
        "/mcp",
        headers={"origin": "cursor://anysphere.cursor-mcp"},
        json={"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "upgrade"}},
    )
    assert response.status_code == 401
    assert response.headers["access-control-allow-origin"] == "cursor://anysphere.cursor-mcp"
    assert response.headers["access-control-expose-headers"] == "WWW-Authenticate"


@pytest.mark.asyncio
async def test_path_aware_protected_resource_matches_mcp_url(
    client: httpx.AsyncClient,
) -> None:
    path_aware = await client.get("/.well-known/oauth-protected-resource/mcp")
    root = await client.get("/.well-known/oauth-protected-resource")
    appended = await client.get("/mcp/.well-known/oauth-protected-resource")
    for response in (path_aware, root, appended):
        assert response.status_code == 200
        assert response.json()["resource"] == "https://mcp.example.com/mcp"
        assert response.json()["authorization_servers"] == ["https://mcp.example.com"]
        assert response.json()["bearer_methods_supported"] == ["header"]


@pytest.mark.asyncio
async def test_openid_configuration_is_404(client: httpx.AsyncClient) -> None:
    response = await client.get("/.well-known/openid-configuration")
    assert response.status_code == 404


@pytest.mark.asyncio
async def test_mcp_get_is_405_with_allow_post_options(client: httpx.AsyncClient) -> None:
    response = await client.get("/mcp")
    assert response.status_code == 405
    allow = {part.strip() for part in response.headers["allow"].split(",")}
    assert allow == {"POST", "OPTIONS"}


def test_oauth_bridge_keeps_starlette_so_uvicorn_runs_lifespan() -> None:
    inner = Starlette(routes=[Route("/mcp", _mcp, methods=["POST", "OPTIONS", "GET"])])
    app = create_mcp_oauth_starlette(
        inner,
        public_base_url="https://mcp.example.com",
        api_base_url="https://api.test",
        product_ref="prd_demo",
    )
    assert app is inner
    assert isinstance(app, Starlette)


@pytest.mark.asyncio
async def test_register_400_relays_oauth_client_result() -> None:
    rec = RecordingClient(
        responses={
            "mcp_oauth_request": {
                "status": 400,
                "headers": {"content-type": "application/json"},
                "body": {
                    "message": (
                        "Invalid identifier. Use mcp_server_id for Managed MCP, "
                        "or product_ref for SDK-integrated MCP."
                    )
                },
            }
        }
    )
    mcp_app = Starlette(routes=[Route("/mcp", _mcp, methods=["POST"])])
    app = create_mcp_oauth_starlette(
        mcp_app,
        public_base_url="https://mcp.example.com",
        api_base_url="https://api.test",
        product_ref="prd_missing",
        oauth_client=rec,
    )
    asgi = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(
        transport=asgi, base_url="https://mcp.example.com"
    ) as test_client:
        response = await test_client.post("/oauth/register", json={"client_name": "jam"})
    assert response.status_code == 400
    assert rec.calls
    assert rec.calls[0][0] == "mcp_oauth_request"


@pytest.mark.parametrize("product_ref", ["", "__SOLVAPAY_PRODUCT_REF__"])
def test_bridge_raises_on_invalid_product_ref(product_ref: str) -> None:
    inner = Starlette(routes=[Route("/mcp", _mcp, methods=["POST"])])
    with pytest.raises(SolvaPayError):
        create_mcp_oauth_starlette(
            inner,
            public_base_url="https://mcp.example.com",
            api_base_url="https://api.test",
            product_ref=product_ref,
        )
