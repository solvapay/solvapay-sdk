from __future__ import annotations

from solvapay_mcp.oauth.free_methods import McpAuthMode


def mcp_auth_gate(
    *,
    public_base_url: str,
    rpc_method: str | None = None,
    auth_header: str | None = None,
    auth_mode: McpAuthMode = "tools-call",
    mcp_path: str | None = None,
    json_rpc_id: object = None,
    jwks_json: object | None = None,
    hs256_secret: str | None = None,
    expected_issuer: str | None = None,
    expected_audience: str | None = None,
    now_unix_secs: int | None = None,
) -> dict[str, object]:
    from solvapay_mcp.core import call

    payload: dict[str, object] = {
        "publicBaseUrl": public_base_url,
        "rpcMethod": rpc_method,
        "authHeader": auth_header,
        "authMode": auth_mode,
        "jsonRpcId": json_rpc_id,
    }
    if mcp_path is not None:
        payload["mcpPath"] = mcp_path
    if jwks_json is not None:
        payload["jwksJson"] = jwks_json
    if hs256_secret is not None:
        payload["hs256Secret"] = hs256_secret
    if expected_issuer is not None:
        payload["expectedIssuer"] = expected_issuer
    if expected_audience is not None:
        payload["expectedAudience"] = expected_audience
    if now_unix_secs is not None:
        payload["nowUnixSecs"] = now_unix_secs
    value = call("mcpAuthGate", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpAuthGate did not return an object")
    return {str(k): v for k, v in value.items()}
