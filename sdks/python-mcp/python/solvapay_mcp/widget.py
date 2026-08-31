from __future__ import annotations

from collections.abc import Mapping
from importlib.resources import files

MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
RESOURCE_URI_META_KEY = "ui/resourceUri"


def default_mcp_app_html() -> str:
    return files("solvapay_mcp").joinpath("data", "mcp-app.html").read_text(encoding="utf-8")


def widget_html_rpc(
    rpc: Mapping[str, object],
    *,
    resource_uri: str,
    public_base_url: str,
    product_ref: str,
    csp: dict[str, list[str]] | None = None,
    api_base_url: str | None = None,
    views: list[str] | None = None,
) -> dict[str, object] | None:
    from solvapay_mcp.core import call

    args: dict[str, object] = {
        "rpc": dict(rpc),
        "resourceUri": resource_uri,
        "publicBaseUrl": public_base_url,
        "productRef": product_ref,
    }
    if views is not None:
        args["views"] = views
    if csp is not None:
        args["csp"] = csp
    if api_base_url is not None:
        args["apiBaseUrl"] = api_base_url
    envelope = call("mcpWidgetResource", args)
    if envelope is None:
        return None
    if not isinstance(envelope, dict):
        raise TypeError("mcpWidgetResource returned a non-object envelope")
    result = envelope.get("result")
    contents = result.get("contents") if isinstance(result, dict) else None
    first = contents[0] if isinstance(contents, list) and contents else None
    if not isinstance(first, dict):
        raise TypeError("mcpWidgetResource omitted contents[0]")
    first["text"] = default_mcp_app_html()
    return envelope
