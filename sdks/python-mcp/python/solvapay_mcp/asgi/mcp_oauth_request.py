"""Host-side `mcpOauthRequest`: discovery + OAuth proxy over one JSON contract."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict, TypeGuard

from solvapay_mcp.server.helpers import _invoke


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


def _is_record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict)


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


async def mcp_oauth_request(
    params: McpOauthRequestParams,
    client: object,
) -> McpOauthRequestResult:
    if client is None:
        raise RuntimeError("oauth_client is required for mcpOauthRequest")
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
