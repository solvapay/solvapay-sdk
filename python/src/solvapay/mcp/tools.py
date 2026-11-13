"""``register_payable_tool`` and ``register_free_tool`` for the official MCP Python SDK.

```python
from mcp.server import MCPServer
from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, register_payable_tool

server = MCPServer("research")
solvapay = create_solvapay()

async def quote(symbol: str, ctx: ResponseContext):
    return ctx.respond({"symbol": symbol, "price": 101.5})

register_payable_tool(server, "quote", solvapay=solvapay, handler=quote, product="prd_…")
```

The tool's input schema comes from the handler's signature, without its
``ResponseContext`` parameter. Each call is checked against the customer's
plan first: a call that may go ahead runs the handler and records the usage;
one that may not returns the paywall (``isError: false``, the message as text,
the gate as ``structuredContent``).

The customer comes from the verified access token (see ``solvapay.mcp.auth``),
or from ``get_customer_ref`` when you pass one. A call with no customer is
refused: unlike the TypeScript SDK, a tool argument is never trusted as the
customer, and there is no ``anonymous`` fallback.
"""

from __future__ import annotations

import inspect
import typing
from collections.abc import Awaitable, Callable, Mapping
from typing import Any

from mcp.server.auth.middleware.auth_context import get_access_token
from mcp.server.mcpserver import Context, MCPServer
from mcp.types import CallToolResult, ToolAnnotations

from ..errors import SolvaPayError
from ..paywall.decide import FreeLimit, PaywallError
from ..solvapay import SolvaPay
from .app import RESOURCE_URI_META_KEY
from .response import (
    ResponseContext,
    ResponseResult,
    error_result,
    gate_result,
    tool_error_result,
    unwrap,
)

Json = dict[str, Any]
Handler = Callable[..., Awaitable[ResponseResult]]
GetCustomerRef = Callable[[Mapping[str, Any], Context], "str | Awaitable[str | None] | None"]

PAID_TOOL_HINT = "Paid tool — call `account` for current balance and cost per call."
_CONTEXT_PARAM = "solvapay_mcp_context"


def free_tool_description_suffix(limit: FreeLimit, shared_with: list[str] | None = None) -> str:
    window = "lifetime" if limit.scope == "lifetime" else f"{limit.window_days} days"
    base = (
        f"Free tool — {limit.cap} calls per {window}, then a plan is required. "
        "Call `account` for remaining usage."
    )
    if not shared_with:
        return base
    names = ", ".join(f"`{name}`" for name in shared_with)
    return f"{base} Shares a free allowance with {names}."


def _context_param(handler: Callable[..., Any], hints: Mapping[str, Any]) -> str:
    for name, param in inspect.signature(handler).parameters.items():
        if hints.get(name) is ResponseContext or name == "ctx":
            if param.kind not in (param.POSITIONAL_OR_KEYWORD, param.KEYWORD_ONLY):
                break
            return name
    raise SolvaPayError(
        f"{getattr(handler, '__name__', 'handler')} needs a `ctx: ResponseContext` parameter",
        code="invalid_handler",
    )


async def default_customer_ref(_args: Mapping[str, Any], _context: Context) -> str | None:
    """The customer from the verified access token, if there is one."""
    token = get_access_token()
    if token is None:
        return None
    ref = token.subject or (token.claims or {}).get("customer_ref")
    return ref if isinstance(ref, str) and ref else None


def _register(
    server: MCPServer,
    name: str,
    *,
    solvapay: SolvaPay,
    handler: Handler,
    product: str | None,
    description: str,
    title: str | None,
    annotations: ToolAnnotations | None,
    meta: Json | None,
    get_customer_ref: GetCustomerRef | None,
    free_limit: FreeLimit | None,
) -> None:
    if not inspect.iscoroutinefunction(handler):
        raise SolvaPayError(f"The handler for {name} must be async", code="invalid_handler")
    resolved_product = solvapay.require_product(product)
    # include_extras keeps `Annotated[str, Field(description=…)]`, so hosts see the description.
    hints = typing.get_type_hints(handler, include_extras=True)
    ctx_name = _context_param(handler, hints)
    resolve_customer = get_customer_ref or default_customer_ref

    async def check_limits(body: Json) -> Json:
        response = await solvapay.api.check_limits(body=body)
        return response.model_dump(mode="json", by_alias=True, exclude_unset=True)

    async def tool(**kwargs: Any) -> CallToolResult:
        context: Context = kwargs.pop(_CONTEXT_PARAM)
        customer = resolve_customer(kwargs, context)
        customer_ref = await customer if inspect.isawaitable(customer) else customer
        if not customer_ref:
            if free_limit is not None:
                # registerFreeTool's answer, before the paywall runs.
                return tool_error_result(
                    "Unauthorized", 401, "customer_ref missing from MCP auth context"
                )
            return error_result(
                f"{name} needs a signed-in customer: connect to this server with OAuth first."
            )
        try:
            decision = await solvapay.paywall.decide(
                customer_ref=customer_ref,
                product=resolved_product,
                free_limit=free_limit,
                tool_name=name,
            )
        except SolvaPayError as error:
            return error_result(error.message)
        if decision.gate is not None:
            return gate_result(decision.gate)

        response_context = ResponseContext(
            customer_ref=decision.customer_ref,
            limits=decision.limits,
            product=resolved_product,
            check_limits=check_limits,
            free_limit=free_limit,
        )
        try:
            result = await solvapay.paywall.run_allow(
                decision,
                lambda: handler(**kwargs, **{ctx_name: response_context}),
                product=resolved_product,
                free_limit=free_limit,
                tool_name=name,
            )
        except PaywallError as gate:
            return gate_result(gate.gate)
        except Exception as error:  # the TypeScript adapter's formatError, as a tool error
            return error_result(str(error))
        return unwrap(result)

    # The schema MCPServer derives from this signature: the handler's own
    # parameters, without the ResponseContext, plus MCP's Context.
    signature = inspect.signature(handler)
    params = [
        p.replace(annotation=hints.get(p.name, p.annotation))
        for p in signature.parameters.values()
        if p.name != ctx_name
    ]
    params.append(
        inspect.Parameter(_CONTEXT_PARAM, inspect.Parameter.KEYWORD_ONLY, annotation=Context)
    )
    tool.__signature__ = signature.replace(  # type: ignore[attr-defined]
        parameters=params, return_annotation=CallToolResult
    )
    tool.__annotations__ = {p.name: p.annotation for p in params} | {"return": CallToolResult}
    tool.__name__ = name
    tool.__doc__ = handler.__doc__

    server.add_tool(
        tool,
        name=name,
        title=title,
        description=description,
        # Read-only and open-world unless the merchant says otherwise.
        annotations=ToolAnnotations.model_validate(
            {
                "readOnlyHint": True,
                "openWorldHint": True,
                **(annotations.model_dump(by_alias=True, exclude_none=True) if annotations else {}),
            }
        ),
        meta=_with_resource_uri_key(meta),
        structured_output=False,
    )


def _with_resource_uri_key(meta: Json | None) -> Json | None:
    """``registerAppTool``: a tool that names a UI resource also carries the flat
    ``ui/resourceUri`` key hosts older than the 2026-01-26 MCP Apps spec read."""
    ui = (meta or {}).get("ui")
    resource_uri = ui.get("resourceUri") if isinstance(ui, dict) else None
    if meta is None or not isinstance(resource_uri, str) or RESOURCE_URI_META_KEY in meta:
        return meta
    return {**meta, RESOURCE_URI_META_KEY: resource_uri}


def _with_hint(description: str | None, hint: str) -> str:
    return f"{description.rstrip()} {hint}" if description else hint


def register_payable_tool(
    server: MCPServer,
    name: str,
    *,
    solvapay: SolvaPay,
    handler: Handler,
    product: str | None = None,
    description: str | None = None,
    title: str | None = None,
    annotations: ToolAnnotations | None = None,
    meta: Json | None = None,
    get_customer_ref: GetCustomerRef | None = None,
) -> None:
    """Registers a paid tool: each call is checked against the customer's plan."""
    _register(
        server,
        name,
        solvapay=solvapay,
        handler=handler,
        product=product,
        description=_with_hint(description, PAID_TOOL_HINT),
        title=title,
        annotations=annotations,
        meta=meta,
        get_customer_ref=get_customer_ref,
        free_limit=None,
    )


def register_free_tool(
    server: MCPServer,
    name: str,
    *,
    solvapay: SolvaPay,
    handler: Handler,
    limit: FreeLimit,
    product: str | None = None,
    description: str | None = None,
    title: str | None = None,
    annotations: ToolAnnotations | None = None,
    meta: Json | None = None,
    get_customer_ref: GetCustomerRef | None = None,
    shared_with: list[str] | None = None,
) -> None:
    """Registers a free tool: ``limit.cap`` calls per window, then a plan is required."""
    _register(
        server,
        name,
        solvapay=solvapay,
        handler=handler,
        product=product,
        description=_with_hint(description, free_tool_description_suffix(limit, shared_with)),
        title=title,
        annotations=annotations,
        meta=meta,
        get_customer_ref=get_customer_ref,
        free_limit=limit,
    )
