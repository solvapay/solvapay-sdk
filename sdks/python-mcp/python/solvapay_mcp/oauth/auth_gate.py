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
    value = call("mcpAuthGate", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpAuthGate did not return an object")
    return {str(k): v for k, v in value.items()}
