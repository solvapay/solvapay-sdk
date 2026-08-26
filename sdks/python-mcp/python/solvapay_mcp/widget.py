from __future__ import annotations

from importlib.resources import files

MCP_APP_MIME_TYPE = "text/html;profile=mcp-app"
RESOURCE_URI_META_KEY = "ui/resourceUri"


def default_mcp_app_html() -> str:
    return files("solvapay_mcp").joinpath("data", "mcp-app.html").read_text(encoding="utf-8")
