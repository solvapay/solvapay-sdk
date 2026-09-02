from __future__ import annotations

import json
import time
from collections.abc import Mapping
from weakref import WeakKeyDictionary

from mcp.server.lowlevel.server import Server
from solvapay._native import unwrap_envelope
from solvapay.facade import SolvaPay

from solvapay_mcp.core import call
from solvapay_mcp.widget import widget_html_rpc

_ENGINE: WeakKeyDictionary[Server[object], _EngineBinding] = WeakKeyDictionary()
_JWKS_CACHE: dict[str, tuple[object, float]] = {}
_JWKS_TTL_SECS = 600.0


class _EngineBinding:
    def __init__(
        self,
        *,
        solvapay: SolvaPay,
        product_ref: str,
        public_base_url: str,
        resource_uri: str,
        mcp_path: str,
        views: list[str] | None,
        hide_audiences: list[str] | None,
        csp: dict[str, list[str]] | None = None,
        api_base_url: str | None = None,
        hs256_secret: str | None = None,
        jwks_json: object | None = None,
    ) -> None:
        self.solvapay = solvapay
        self.product_ref = product_ref
        self.public_base_url = public_base_url
        self.resource_uri = resource_uri
        self.mcp_path = mcp_path
        self.csp = csp
        self.api_base_url = api_base_url
        self.views = views
        self.hide_audiences = hide_audiences
        self.hs256_secret = hs256_secret
        self.jwks_json = jwks_json


def bind_engine(
    server: Server[object],
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    resource_uri: str,
    mcp_path: str = "/mcp",
    views: list[str] | None = None,
    hide_audiences: list[str] | None = None,
    csp: dict[str, list[str]] | None = None,
    api_base_url: str | None = None,
    hs256_secret: str | None = None,
    jwks_json: object | None = None,
) -> None:
    _ENGINE[server] = _EngineBinding(
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
        resource_uri=resource_uri,
        mcp_path=mcp_path,
        views=views,
        hide_audiences=hide_audiences,
        csp=csp,
        api_base_url=api_base_url,
        hs256_secret=hs256_secret,
        jwks_json=jwks_json,
    )


def engine_for(server: Server[object]) -> _EngineBinding | None:
    return _ENGINE.get(server)


async def dispatch_rpc(
    server: Server[object],
    rpc: Mapping[str, object],
    *,
    auth_header: str | None = None,
    user_agent: str | None = None,
    protocol_version_header: str | None = None,
) -> dict[str, object]:
    from solvapay_mcp.register import _REGISTRIES, _invoke_payable

    binding = _ENGINE.get(server)
    if binding is None:
        raise RuntimeError("mcp engine is not bound on this server")
    html = widget_html_rpc(
        rpc,
        resource_uri=binding.resource_uri,
        public_base_url=binding.public_base_url,
        product_ref=binding.product_ref,
        csp=binding.csp,
        api_base_url=binding.api_base_url,
        views=binding.views,
    )
    if html is not None:
        return {"kind": "rpc", "rpc": html}
    registry = _REGISTRIES.get(server) or {}
    payable_tools = [
        {
            "name": name,
            **({"title": spec.title} if spec.title is not None else {}),
            **({"description": spec.description} if spec.description is not None else {}),
            "inputSchema": spec.input_schema,
        }
        for name, spec in sorted(registry.items(), key=lambda item: item[0])
    ]
    config: dict[str, object] = {
        "productRef": binding.product_ref,
        "publicBaseUrl": binding.public_base_url,
        "resourceUri": binding.resource_uri,
        "payableTools": payable_tools,
        "mcpPath": binding.mcp_path,
    }
    if binding.views is not None:
        config["views"] = binding.views
    if binding.hide_audiences is not None:
        config["hideAudiences"] = binding.hide_audiences
    if binding.csp is not None:
        config["csp"] = binding.csp
    if binding.api_base_url is not None:
        config["apiBaseUrl"] = binding.api_base_url
    if user_agent is not None:
        config["userAgent"] = user_agent
    if binding.hs256_secret is not None:
        config["hs256Secret"] = binding.hs256_secret
    jwks = await _resolved_jwks(binding, auth_header)
    if jwks is not None:
        config["jwksJson"] = jwks
    config["nowUnixSecs"] = int(time.time())
    payload: dict[str, object] = {"rpc": dict(rpc), "config": config}
    if auth_header:
        payload["authHeader"] = auth_header
    if protocol_version_header:
        payload["mcpProtocolVersionHeader"] = protocol_version_header
    raw = await binding.solvapay.get_api_client().mcp_dispatch(json.dumps(payload))  # type: ignore[attr-defined]
    envelope = unwrap_envelope(raw)
    if not isinstance(envelope, dict):
        raise TypeError("mcpDispatch returned a non-object envelope")
    kind = envelope.get("kind")
    if kind == "invokeHandler":
        tool = str(envelope.get("tool") or "")
        token = str(envelope.get("token") or "")
        spec = (_REGISTRIES.get(server) or {}).get(tool)
        if spec is None:
            raise ValueError(f"unknown payable tool: {tool}")
        args_raw = envelope.get("args")
        args = dict(args_raw) if isinstance(args_raw, dict) else {}
        ref = envelope.get("customerRef")
        if isinstance(ref, str) and "customer_ref" not in args:
            args["customer_ref"] = ref
        handler_envelope = await _invoke_payable(spec, args)
        resumed = call("mcpResume", {"token": token, "handlerEnvelope": handler_envelope})
        if not isinstance(resumed, dict):
            raise TypeError("mcpResume did not return an object")
        return {"kind": "rpc", "rpc": resumed.get("rpc", resumed)}
    return {str(k): v for k, v in envelope.items()}


async def _resolved_jwks(binding: _EngineBinding, auth_header: str | None) -> object | None:
    if binding.jwks_json is not None:
        return binding.jwks_json
    if binding.hs256_secret is not None:
        return None
    if not auth_header:
        return None
    client = binding.solvapay.get_api_client()
    fetch = getattr(client, "fetch_jwks", None)
    if fetch is None:
        return None
    url = f"{binding.public_base_url.rstrip('/')}/.well-known/jwks.json"
    now = time.time()
    hit = _JWKS_CACHE.get(url)
    if hit is not None and hit[1] > now:
        return hit[0]
    raw = await fetch(json.dumps({"jwksUrl": url}))
    document: object = unwrap_envelope(raw)
    _JWKS_CACHE[url] = (document, now + _JWKS_TTL_SECS)
    return document
