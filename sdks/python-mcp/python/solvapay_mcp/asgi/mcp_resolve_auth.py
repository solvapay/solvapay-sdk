"""Host-side `mcpResolveAuth`: one JSON contract for MCP bearer decisions."""

from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict, TypeGuard

from solvapay_mcp.server.helpers import _invoke


class McpResolveAuthParams(TypedDict, total=False):
    rpcMethod: str | None
    authHeader: str | None
    authMode: str
    publicBaseUrl: str
    mcpPath: str
    jsonRpcId: str | int | None
    hs256Secret: str
    jwksJson: object


def _is_record(value: object) -> TypeGuard[dict[str, object]]:
    return isinstance(value, dict)


async def mcp_resolve_auth(params: Mapping[str, object], client: object) -> dict[str, object]:
    if client is None:
        raise RuntimeError("oauth_client is required for mcpResolveAuth")
    envelope = await _invoke(client, "mcp_resolve_auth", dict(params))
    if not _is_record(envelope):
        raise RuntimeError("mcpResolveAuth returned a non-object envelope")
    kind = envelope.get("kind")
    if kind not in {"allow", "challenge", "error"}:
        raise RuntimeError(f"mcpResolveAuth returned unexpected kind: {kind!r}")
    return envelope
