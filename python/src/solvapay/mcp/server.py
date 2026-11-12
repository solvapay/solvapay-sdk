"""``create_solvapay_mcp_server``: an MCP server with SolvaPay sign-in and paid tools.

```python
from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, create_solvapay_mcp_server

mcp = create_solvapay_mcp_server(
    solvapay=create_solvapay(),
    product_ref="prd_…",
    public_base_url="https://research.example.com",
)

async def quote(symbol: str, ctx: ResponseContext):
    return ctx.respond({"symbol": symbol, "price": 101.5})

mcp.register_payable("quote", handler=quote, description="Latest price for a symbol.")

app = mcp.http_app()   # serve with uvicorn: the MCP endpoint is /mcp
```
"""

from __future__ import annotations

from typing import Any

import httpx
from mcp.server.auth.settings import AuthSettings
from mcp.server.mcpserver import MCPServer
from mcp.types import ToolAnnotations
from starlette.applications import Starlette

from ..errors import SolvaPayError
from ..paywall.decide import FreeLimit
from ..solvapay import SolvaPay
from .auth import SolvaPayTokenVerifier, oauth_bridge_routes
from .bootstrap import ADVERTISED_VIEWS, ViewKind
from .intent import register_intent_tools
from .tools import GetCustomerRef, Handler, register_free_tool, register_payable_tool

Json = dict[str, Any]


class SolvaPayMcpServer:
    """An ``MCPServer`` (``.server``) plus helpers bound to its SolvaPay product."""

    def __init__(
        self,
        *,
        server: MCPServer,
        solvapay: SolvaPay,
        product_ref: str,
        mcp_path: str,
    ) -> None:
        self.server = server
        self.solvapay = solvapay
        self.product_ref = product_ref
        self.mcp_path = mcp_path
        self._free_meters: dict[str, tuple[FreeLimit, list[str]]] = {}

    def register_payable(
        self,
        name: str,
        *,
        handler: Handler,
        description: str | None = None,
        title: str | None = None,
        annotations: ToolAnnotations | None = None,
        meta: Json | None = None,
        product: str | None = None,
        get_customer_ref: GetCustomerRef | None = None,
    ) -> None:
        """A paid tool on this server's product (or ``product``)."""
        register_payable_tool(
            self.server,
            name,
            solvapay=self.solvapay,
            handler=handler,
            product=product or self.product_ref,
            description=description,
            title=title,
            annotations=annotations,
            meta=meta,
            get_customer_ref=get_customer_ref,
        )

    def register_free(
        self,
        name: str,
        *,
        handler: Handler,
        limit: FreeLimit,
        description: str | None = None,
        title: str | None = None,
        annotations: ToolAnnotations | None = None,
        meta: Json | None = None,
        product: str | None = None,
        get_customer_ref: GetCustomerRef | None = None,
    ) -> None:
        """A free tool. Tools that name the same meter must declare the same limit."""
        existing = self._free_meters.get(limit.meter)
        if existing and existing[0] != limit:
            raise SolvaPayError(
                f"Free tools '{', '.join(existing[1])}' and '{name}' declare meter "
                f"'{limit.meter}' with different caps",
                code="invalid_free_limit",
            )
        shared_with = list(existing[1]) if existing else []
        if existing:
            existing[1].append(name)
        else:
            self._free_meters[limit.meter] = (limit, [name])
        register_free_tool(
            self.server,
            name,
            solvapay=self.solvapay,
            handler=handler,
            limit=limit,
            product=product or self.product_ref,
            description=description,
            title=title,
            annotations=annotations,
            meta=meta,
            get_customer_ref=get_customer_ref,
            shared_with=shared_with,
        )

    def http_app(self, **options: Any) -> Starlette:
        """The ASGI app: the MCP endpoint at ``mcp_path`` plus the sign-in routes."""
        return self.server.streamable_http_app(streamable_http_path=self.mcp_path, **options)


def create_solvapay_mcp_server(
    *,
    solvapay: SolvaPay,
    public_base_url: str,
    product_ref: str | None = None,
    name: str = "solvapay-mcp",
    version: str = "1.0.0",
    instructions: str | None = None,
    mcp_path: str = "/mcp",
    oauth_paths: dict[str, str] | None = None,
    http_client: httpx.AsyncClient | None = None,
    views: list[ViewKind] | None = None,
    get_customer_ref: GetCustomerRef | None = None,
) -> SolvaPayMcpServer:
    """An MCP server whose customers sign in with SolvaPay.

    ``public_base_url`` is where clients reach this server (an ngrok URL in
    development). It is the OAuth issuer clients see.

    The server comes with SolvaPay's built-in tools, as the TypeScript server does:
    ``account`` (checkout, account and top-up views; ``views`` picks which, and an
    empty list leaves the tool out) and ``activate_plan``, the ``/upgrade``,
    ``/manage_account``, ``/topup`` and ``/activate_plan`` prompts, and the
    ``docs://solvapay/overview.md`` resource. ``get_customer_ref`` overrides who the
    customer is for them; by default it is the verified access token's.
    """
    if not public_base_url.startswith(("https://", "http://")):
        raise SolvaPayError("public_base_url must be an http(s) URL", code="invalid_argument")
    product = solvapay.require_product(product_ref)
    base = public_base_url.rstrip("/")
    api_base_url = solvapay.api.api_base_url

    server = MCPServer(
        name=name,
        version=version,
        instructions=instructions,
        token_verifier=SolvaPayTokenVerifier(api_base_url=api_base_url, http_client=http_client),
        auth=AuthSettings(
            issuer_url=base,
            resource_server_url=f"{base}{mcp_path}",
            # SolvaPay checks the token on userinfo; its customer is then only
            # usable with this merchant's key.
            validate_token_resource=False,
        ),
    )
    for route in oauth_bridge_routes(
        public_base_url=base,
        api_base_url=api_base_url,
        product_ref=product,
        paths=oauth_paths,
        http_client=http_client,
    ):
        server.custom_route(route.path, methods=sorted(route.methods or []))(route.endpoint)
    register_intent_tools(
        server,
        solvapay=solvapay,
        product_ref=product,
        public_base_url=public_base_url,
        views=ADVERTISED_VIEWS if views is None else views,
        get_customer_ref=get_customer_ref,
    )
    return SolvaPayMcpServer(
        server=server, solvapay=solvapay, product_ref=product, mcp_path=mcp_path
    )
