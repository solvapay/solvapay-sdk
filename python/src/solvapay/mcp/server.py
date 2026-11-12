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

import json
from collections.abc import Awaitable, Callable, Iterable, Mapping, Sequence
from typing import Any
from urllib.parse import urlsplit

import httpx
from mcp.server.auth.settings import AuthSettings
from mcp.server.lowlevel.helper_types import ReadResourceContents
from mcp.server.mcpserver import Context, MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import InputRequiredResult, ToolAnnotations
from pydantic import AnyUrl
from starlette.applications import Starlette

from ..errors import SolvaPayError
from ..paywall.decide import FreeLimit
from ..solvapay import SolvaPay
from .app import (
    BOOTSTRAP_MIME_TYPE,
    BOOTSTRAP_URI,
    BypassWhen,
    HideToolsByAudience,
    app_resource,
    default_resource_uri,
    merge_csp,
    widget_html,
)
from .auth import SolvaPayTokenVerifier, oauth_bridge_routes
from .bootstrap import ADVERTISED_VIEWS, ViewKind, build_bootstrap_payload, derive_default_view
from .intent import _resolve_customer, register_intent_tools
from .tools import (
    GetCustomerRef,
    Handler,
    default_customer_ref,
    register_free_tool,
    register_payable_tool,
)
from .transport import register_transport_tools

Json = dict[str, Any]

BootstrapReader = Callable[[Context[Any, Any]], Awaitable[str]]


class _AppServer(MCPServer[Any]):
    """An ``MCPServer`` that reads ``solvapay://bootstrap.json`` for the caller.

    The snapshot depends on who asks, and ``MCPServer`` hands a static resource no
    request context, so the read is answered here, where the context is known.
    """

    bootstrap_reader: BootstrapReader | None = None

    async def read_resource(
        self, uri: AnyUrl | str, context: Context[Any, Any] | None = None
    ) -> Iterable[ReadResourceContents] | InputRequiredResult:
        if self.bootstrap_reader is not None and str(uri) == BOOTSTRAP_URI:
            text = await self.bootstrap_reader(context or Context(mcp_server=self))
            return [ReadResourceContents(content=text, mime_type=BOOTSTRAP_MIME_TYPE)]
        return await super().read_resource(uri, context)


class SolvaPayMcpServer:
    """An ``MCPServer`` (``.server``) plus helpers bound to its SolvaPay product."""

    def __init__(
        self,
        *,
        server: MCPServer,
        solvapay: SolvaPay,
        product_ref: str,
        mcp_path: str,
        public_base_url: str,
        resource_uri: str,
    ) -> None:
        self.server = server
        self.solvapay = solvapay
        self.product_ref = product_ref
        self.mcp_path = mcp_path
        self.public_base_url = public_base_url
        self.resource_uri = resource_uri
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
        """The ASGI app: the MCP endpoint at ``mcp_path`` plus the sign-in routes.

        DNS-rebinding protection stays on, allowing this server's public host
        (from ``public_base_url``) and localhost. Without the public host, the
        MCP SDK answers every request through the public URL (a tunnel, a
        load balancer) with 421. Pass ``transport_security`` to set your own.
        """
        options.setdefault("transport_security", self.transport_security())
        return self.server.streamable_http_app(streamable_http_path=self.mcp_path, **options)

    def transport_security(self) -> TransportSecuritySettings:
        public = urlsplit(self.public_base_url)
        host = public.netloc
        origin = f"{public.scheme}://{host}"
        return TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[host, "127.0.0.1:*", "localhost:*", "[::1]:*"],
            allowed_origins=[origin, "http://127.0.0.1:*", "http://localhost:*", "http://[::1]:*"],
        )


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
    resource_uri: str | None = None,
    csp: Mapping[str, Sequence[str]] | None = None,
    hide_tools_by_audience: Sequence[str] | None = None,
    hide_tools_bypass: BypassWhen | None = None,
) -> SolvaPayMcpServer:
    """An MCP server whose customers sign in with SolvaPay.

    ``public_base_url`` is where clients reach this server (an ngrok URL in
    development). It is the OAuth issuer clients see, and where Stripe sends the
    customer back after 3-D Secure.

    The server comes with SolvaPay's built-in tools, as the TypeScript server does:
    ``account`` (checkout, account and top-up views; ``views`` picks which, and an
    empty list leaves the tool out) and ``activate_plan``, the ``/upgrade``,
    ``/manage_account``, ``/topup`` and ``/activate_plan`` prompts, and the
    ``docs://solvapay/overview.md`` resource. ``get_customer_ref`` overrides who the
    customer is for them; by default it is the verified access token's.

    On MCP Apps hosts (ChatGPT, Claude) ``account`` opens the SolvaPay widget,
    served at ``resource_uri`` (default ``ui://<name>/mcp-app.html``). The widget
    calls six transport tools (``create_payment_intent``, ``process_payment``,
    ``create_hosted_session``, ``set_renewal``, ``attach_business_details``,
    ``get_history``) and reads ``solvapay://bootstrap.json``. ``csp`` adds domains to
    the widget's Content Security Policy (``resourceDomains``, ``connectDomains``,
    ``frameDomains``) on top of Stripe's and the SolvaPay API's.

    ``hide_tools_by_audience=["ui"]`` leaves the transport tools out of
    ``tools/list`` for hosts that ignore ``_meta.ui.visibility``. They stay
    callable. ChatGPT always gets the full list (its iframe can only call listed
    tools); ``hide_tools_bypass`` replaces that check.
    """
    if not public_base_url.startswith(("https://", "http://")):
        raise SolvaPayError("public_base_url must be an http(s) URL", code="invalid_argument")
    product = solvapay.require_product(product_ref)
    base = public_base_url.rstrip("/")
    api_base_url = solvapay.api.api_base_url
    uri = resource_uri or default_resource_uri(name)
    enabled_views = ADVERTISED_VIEWS if views is None else views
    resolve = get_customer_ref or default_customer_ref

    server = _AppServer(
        name=name,
        version=version,
        instructions=instructions,
        middleware=[HideToolsByAudience(hide_tools_by_audience, hide_tools_bypass)]
        if hide_tools_by_audience
        else None,
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
        views=enabled_views,
        get_customer_ref=get_customer_ref,
        resource_uri=uri,
    )
    register_transport_tools(
        server,
        solvapay=solvapay,
        product_ref=product,
        resource_uri=uri,
        get_customer_ref=get_customer_ref,
    )
    server.add_resource(app_resource(uri, merge_csp(csp, api_base_url), widget_html()))

    async def read_bootstrap(context: Context[Any, Any]) -> str:
        # The snapshot `account` answers when `view` is omitted.
        customer_ref = await _resolve_customer(resolve, {}, context)
        data = await build_bootstrap_payload(
            solvapay,
            view="account",
            product_ref=product,
            public_base_url=public_base_url,
            customer_ref=customer_ref,
        )
        data["view"] = derive_default_view(data, enabled_views)
        return json.dumps(data, separators=(",", ":"), ensure_ascii=False)

    server.bootstrap_reader = read_bootstrap

    def answered_by_server() -> str:
        raise SolvaPayError(
            f"{BOOTSTRAP_URI} is read through the SolvaPay MCP server", code="unexpected_read"
        )

    server.resource(
        BOOTSTRAP_URI,
        name="SolvaPay bootstrap",
        title="SolvaPay bootstrap",
        description=(
            "Current merchant/product/plans/customer snapshot for the embedded UI. Widgets "
            "read this idempotently when the host scrubs structuredContent from tool results."
        ),
        mime_type=BOOTSTRAP_MIME_TYPE,
    )(answered_by_server)
    return SolvaPayMcpServer(
        server=server,
        solvapay=solvapay,
        product_ref=product,
        mcp_path=mcp_path,
        public_base_url=base,
        resource_uri=uri,
    )
