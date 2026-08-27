"""Host-side `mcpOauthRequest`: discovery + OAuth proxy over one JSON contract.

When a native client implements the composite op, that path is used. Unit
tests inject an `httpx.AsyncClient` and stay on the local contract so they
can stub upstream without a SolvaPayClient.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from typing import TypedDict, TypeGuard
from urllib.parse import quote

import httpx

from solvapay_mcp.oauth.dcr_diagnostics import log_dcr_failure_diagnostic
from solvapay_mcp.oauth.discovery import (
    OAuthBridgePaths,
    get_oauth_authorization_server_response,
    get_oauth_protected_resource_response,
    without_trailing_slash,
)
from solvapay_mcp.oauth.error_normalize import to_oauth_error_body
from solvapay_mcp.server.helpers import _invoke

NATIVE_CLIENT_ORIGIN_SCHEMES = ("cursor:", "vscode:", "vscode-webview:", "claude:")


class McpOauthRequestConfig(TypedDict, total=False):
    publicBaseUrl: str
    productRef: str
    apiBaseUrl: str
    mcpPath: str
    oauthPaths: dict[str, str]


class McpOauthRequestParams(TypedDict):
    method: str
    path: str
    headers: Mapping[str, str]
    body: str
    config: McpOauthRequestConfig


class McpOauthRequestResult(TypedDict):
    status: int
    headers: dict[str, str]
    body: object


def _is_protected_resource_path(path: str) -> bool:
    return (
        path == "/.well-known/oauth-protected-resource"
        or path.startswith("/.well-known/oauth-protected-resource/")
        or path.endswith("/.well-known/oauth-protected-resource")
    )


def _path_only(path: str) -> str:
    return path.split("?", 1)[0]


def _query_suffix(path: str) -> str:
    if "?" not in path:
        return ""
    return path.split("?", 1)[1]


def _is_native_origin(origin: str) -> bool:
    return any(origin.startswith(scheme) for scheme in NATIVE_CLIENT_ORIGIN_SCHEMES)


def _native_cors_headers(origin: str | None) -> dict[str, str]:
    if not origin or not _is_native_origin(origin):
        return {}
    return {"access-control-allow-origin": origin, "vary": "Origin"}


def _json_result(
    status: int, body: object, extra: Mapping[str, str] | None = None
) -> McpOauthRequestResult:
    headers = {"content-type": "application/json", **dict(extra or {})}
    return {"status": status, "headers": headers, "body": body}


def _is_record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict)


def _client_method(client: object, name: str) -> object | None:
    bound = getattr(type(client), name, None)
    if not callable(bound):
        return None
    method: object = getattr(client, name)
    return method


def _as_oauth_result(value: object) -> McpOauthRequestResult:
    if not _is_record(value):
        raise RuntimeError("mcpOauthRequest returned a result without status")
    status = value.get("status")
    if not isinstance(status, int):
        raise RuntimeError("mcpOauthRequest returned a result without status")
    headers: dict[str, str] = {}
    raw_headers = value.get("headers")
    if isinstance(raw_headers, dict):
        for key, header in raw_headers.items():
            if isinstance(header, str):
                headers[str(key)] = header
    return {"status": status, "headers": headers, "body": value.get("body")}


async def _proxy_customer_auth(
    params: McpOauthRequestParams,
    upstream_path: str,
    normalize_errors: bool,
    http: httpx.AsyncClient,
) -> McpOauthRequestResult:
    api = without_trailing_slash(str(params["config"].get("apiBaseUrl") or ""))
    origin = params["headers"].get("origin")
    cors = _native_cors_headers(origin if isinstance(origin, str) else None)
    content_type = params["headers"].get("content-type", "application/json")
    headers = {"content-type": content_type}
    authorization = params["headers"].get("authorization")
    if authorization:
        headers["authorization"] = authorization
    try:
        upstream = await http.request(
            "POST",
            f"{api}{upstream_path}",
            headers=headers,
            content=params["body"],
        )
    except httpx.HTTPError:
        return _json_result(502, {"error": "upstream_unreachable"}, cors)
    text = upstream.text
    if upstream.status_code == 204 and text == "":
        return {"status": 204, "headers": dict(cors), "body": None}
    if upstream_path.startswith("/v1/customer/auth/register") and not upstream.is_success:
        log_dcr_failure_diagnostic(
            product_ref=str(params["config"].get("productRef") or ""),
            api_base_url=api,
            status=upstream.status_code,
            body_text=text,
        )
    parsed: object
    try:
        parsed = json.loads(text) if text else {}
    except json.JSONDecodeError:
        parsed = text
    payload = (
        to_oauth_error_body(parsed, text, upstream.status_code)
        if normalize_errors and not upstream.is_success and upstream.status_code != 204
        else parsed
    )
    content_type_out = (
        "application/json"
        if normalize_errors
        else upstream.headers.get("content-type", "application/json")
    )
    return {
        "status": upstream.status_code,
        "headers": {"content-type": content_type_out, **cors},
        "body": payload,
    }


async def mcp_oauth_request_local(
    params: McpOauthRequestParams,
    http: httpx.AsyncClient,
) -> McpOauthRequestResult:
    method = params["method"].upper()
    path = _path_only(params["path"])
    origin = params["headers"].get("origin")
    cors = _native_cors_headers(origin if isinstance(origin, str) else None)
    config = params["config"]

    if method == "OPTIONS":
        requested_method = params["headers"].get("access-control-request-method", "POST")
        requested_headers = params["headers"].get(
            "access-control-request-headers", "authorization, content-type"
        )
        return {
            "status": 204,
            "headers": {
                **cors,
                "access-control-allow-methods": f"{requested_method}, OPTIONS",
                "access-control-allow-headers": requested_headers,
                "access-control-max-age": "600",
            },
            "body": None,
        }

    if path == "/.well-known/openid-configuration":
        if method != "GET":
            return _json_result(405, {"error": "method_not_allowed"}, cors)
        return {"status": 404, "headers": dict(cors), "body": None}

    if _is_protected_resource_path(path):
        if method != "GET":
            return _json_result(405, {"error": "method_not_allowed"}, cors)
        mcp_path = config.get("mcpPath")
        return _json_result(
            200,
            get_oauth_protected_resource_response(
                str(config.get("publicBaseUrl") or ""),
                mcp_path=mcp_path if isinstance(mcp_path, str) else None,
            ),
            cors,
        )

    if path == "/.well-known/oauth-authorization-server":
        if method != "GET":
            return _json_result(405, {"error": "method_not_allowed"}, cors)
        oauth_paths = config.get("oauthPaths")
        paths: OAuthBridgePaths | None = None
        if isinstance(oauth_paths, dict):
            paths = {
                "register": str(oauth_paths.get("register", "")),
                "authorize": str(oauth_paths.get("authorize", "")),
                "token": str(oauth_paths.get("token", "")),
                "revoke": str(oauth_paths.get("revoke", "")),
            }
        return _json_result(
            200,
            get_oauth_authorization_server_response(
                str(config.get("publicBaseUrl") or ""),
                paths,
            ),
            cors,
        )

    if path == "/oauth/authorize" or path.endswith("/oauth/authorize"):
        qs = _query_suffix(params["path"])
        api = without_trailing_slash(str(config.get("apiBaseUrl") or ""))
        location = f"{api}/v1/customer/auth/authorize"
        if qs:
            location = f"{location}?{qs}"
        return {"status": 302, "headers": {"location": location, **cors}, "body": None}

    if method != "POST":
        return _json_result(405, {"error": "method_not_allowed"}, cors)

    if path == "/oauth/register" or path.endswith("/oauth/register"):
        encoded = quote(str(config.get("productRef") or ""), safe="")
        return await _proxy_customer_auth(
            params, f"/v1/customer/auth/register?product_ref={encoded}", False, http
        )
    if path == "/oauth/token" or path.endswith("/oauth/token"):
        return await _proxy_customer_auth(params, "/v1/customer/auth/token", True, http)
    if path == "/oauth/revoke" or path.endswith("/oauth/revoke"):
        return await _proxy_customer_auth(params, "/v1/customer/auth/revoke", True, http)

    return _json_result(404, {"error": "not_found"}, cors)


async def mcp_oauth_request(
    params: McpOauthRequestParams,
    client: object | None = None,
    http_client: httpx.AsyncClient | None = None,
) -> McpOauthRequestResult:
    path = _path_only(params["path"])
    # The composite rust op historically omits `mcpPath` from this document.
    # Hosts must stay on the path-aware sync discovery op so the resource
    # identifier agrees with `mcpAuthGate`.
    if _is_protected_resource_path(path):
        owns = http_client is None
        http = http_client if http_client is not None else httpx.AsyncClient()
        try:
            return await mcp_oauth_request_local(params, http)
        finally:
            if owns:
                await http.aclose()

    if client is not None and _client_method(client, "mcp_oauth_request") is not None:
        config = dict(params["config"])
        config.pop("apiBaseUrl", None)
        envelope = await _invoke(
            client,
            "mcp_oauth_request",
            {
                "method": params["method"],
                "path": params["path"],
                "headers": dict(params["headers"]),
                "body": params["body"],
                "config": config,
            },
        )
        return _as_oauth_result(envelope)

    owns = http_client is None
    http = http_client if http_client is not None else httpx.AsyncClient()
    try:
        return await mcp_oauth_request_local(params, http)
    finally:
        if owns:
            await http.aclose()
