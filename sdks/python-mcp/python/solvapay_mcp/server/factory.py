from __future__ import annotations

from collections.abc import Awaitable, Callable

from mcp.server.lowlevel.server import Server
from solvapay.facade import SolvaPay

from solvapay_mcp.register import ensure_dispatch
from solvapay_mcp.server.engine import bind_engine


def create_solvapay_mcp_server(
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    resource_uri: str = "ui://solvapay/mcp-app.html",
    read_html: Callable[[], Awaitable[str]] | None = None,
    views: list[str] | None = None,
    csp: dict[str, list[str]] | None = None,
    api_base_url: str | None = None,
    server_name: str = "solvapay-mcp-server",
    hide_tools_by_audience: list[str] | None = None,
) -> Server[object]:
    del read_html
    server: Server[object] = Server(server_name)
    bind_engine(
        server,
        solvapay=solvapay,
        product_ref=product_ref,
        public_base_url=public_base_url,
        resource_uri=resource_uri,
        views=views,
        hide_audiences=hide_tools_by_audience,
        csp=csp,
        api_base_url=api_base_url,
    )
    ensure_dispatch(server)
    return server
