"""The built-in ``account`` and ``activate_plan`` tools, the slash-command prompts and the
``docs://solvapay/overview.md`` resource, ported from ``@solvapay/mcp-core``'s
``descriptors.ts``.

``create_solvapay_mcp_server`` registers all of them. ``register_intent_tools``
adds them to any ``MCPServer``.

With ``resource_uri`` (``create_solvapay_mcp_server`` passes it), ``account`` opens
the SolvaPay widget on MCP Apps hosts: the tool lists ``_meta.ui.resourceUri`` and
its result carries it, except in ``mode: 'text'``. Text-only hosts read the same
narration either way. The widget's own tools are in ``transport.py``.
"""

from __future__ import annotations

import inspect
import json
import uuid
from collections.abc import Awaitable, Callable, Iterable, Mapping
from datetime import datetime
from typing import Annotated, Any, Literal

from mcp.server.mcpserver import Context, MCPServer
from mcp.server.mcpserver.prompts import Prompt
from mcp.types import CallToolResult, ResourceLink, TextContent, ToolAnnotations
from pydantic import BeforeValidator, Field

from .._js import get
from ..errors import SolvaPayError
from ..solvapay import SolvaPay
from .app import tool_ui_meta
from .bootstrap import (
    ADVERTISED_VIEWS,
    ViewKind,
    build_bootstrap_payload,
    derive_default_view,
    signed_in_customer_ref,
)
from .narrate import ACTIVATE_PLAN_TOOL_NAME, NARRATORS, VIEWER_TOOL_NAME, narrate_activate_plan
from .narrate import ui_placeholder as _ui_placeholder
from .tools import default_customer_ref

Json = dict[str, Any]
Mode = Literal["ui", "text", "auto"]
GetCustomerRef = Callable[[Mapping[str, Any], Context], "str | Awaitable[str | None] | None"]

OVERVIEW_URI = "docs://solvapay/overview.md"
OVERVIEW_MIME_TYPE = "text/markdown"
OVERVIEW_MARKDOWN = """# SolvaPay MCP server — overview

This MCP server connects a SolvaPay-protected product to your host so users can
manage their plan, usage, and billing **without leaving the chat**. It is
dual-audience: every tool returns a UI bootstrap for hosts that render MCP UI
resources (`basic-host`, Claude Desktop, ChatGPT, etc.) and a markdown summary
with clickable URLs for text-only hosts.

## What the user can do

- **Account** — one read-only viewer for every billing surface. Pass `view`:
  `checkout` (upgrade / change plan / buy / subscribe), `account` (current
  plan, cancel, billing), or `topup` (add credits). Omit `view` and the
  server picks (no plan → checkout, out of credits → topup, else account).
  Slash commands `/upgrade`, `/manage_account`, and `/topup` remap onto
  this tool. `account`.
- **Activate plan** — activate a specific plan by `planRef`. Free plans
  activate immediately, usage-based plans activate when balance covers the
  configured usage, paid plans return checkout. Requires `planRef` — to list
  plans, call `account` with `view: "checkout"`. `/activate_plan`.

## How it fits together

The viewer returns a full `BootstrapPayload` (merchant + product + plans
+ customer snapshot) so the embedded UI never fires per-view read calls. When
a paywalled data tool hits the usage limit, its response is plain text: the
`content[0].text` narration names the recovery tool (`account`, or
`activate_plan` when a specific planRef is known) and inlines
`gate.checkoutUrl` for terminal-first hosts. The structured gate rides on
`structuredContent` for programmatic consumers. No widget iframe opens for a
gate — the LLM reads the narration and, if the user agrees, calls the named
tool which mounts the checkout / topup / account surface.

Auth is handled by the SolvaPay OAuth bridge (see `createMcpOAuthBridge`). The
bridge injects `customer_ref` onto every authenticated request; tools that
need an authenticated caller return `Unauthorized` when it is missing.

## Also see

- `docs://solvapay/overview.md` (this resource) — agent-facing narration.
- `ui://<app>/mcp-app.html` — the embedded UI shell.
- `tools/list` + `prompts/list` — programmatic discovery of the intent tools
  and their slash-command shortcuts.
"""

VIEW_PARAM_DESCRIPTION = (
    'Landing surface. checkout: user says "upgrade", "change plan", "buy", or "subscribe". '
    'account: user says "my account", "current plan", "cancel", or "billing". '
    'topup: user says "top up", "add credits", or "buy credits". '
    "Omit to let the server pick (no plan → checkout, out of credits → topup, else account)."
)

VIEWER_DESCRIPTION = (
    'Call when the user says "upgrade", "change plan", "buy", "subscribe", "my account", '
    '"current plan", "cancel", "billing", "top up", "add credits", or "buy credits". '
    "Opens the SolvaPay billing surface. Pass `view` to pick the landing screen; omit it to "
    "let the server pick (no plan → checkout, out of credits → topup, else account). "
    "Read-only snapshot — charges happen after the customer confirms. Always include the "
    "Manage and Checkout markdown links from the tool result in your reply to the user. "
    "To change something, call this tool again with `view`: `account` (manage or cancel), "
    "`topup` (add credits), or `checkout` (change plan)."
)

MODE_PARAM_DESCRIPTION = (
    "Default `mode: 'auto'` returns a self-sufficient text summary (plan, price, https "
    "checkout URL) and still opens the iframe on UI hosts. Pass `mode: 'text'` to strip "
    "the iframe, or `mode: 'ui'` for a one-line placeholder that still includes the "
    "checkout URL."
)

ACTIVATE_PLAN_DESCRIPTION = (
    'Call when the user says "activate" and a specific `planRef` is known. Free plans '
    "activate immediately; usage-based plans activate when the balance covers usage; paid "
    "plans open checkout. Requires `planRef` — to list or pick a plan, call `account` with "
    'view: "checkout".'
)

_CONTEXT_PARAM = "solvapay_mcp_context"


def _json(data: Any) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def tool_error_result(error: str, status: int, details: str | None = None) -> CallToolResult:
    """``toolErrorResult``: the recovery text first, the ``{error, status, details}`` envelope
    as structured content."""
    envelope: Json = {"error": error, "status": status}
    if details is not None:
        envelope["details"] = details
    return CallToolResult(
        content=[TextContent(type="text", text=details if details is not None else error)],
        structured_content=envelope,
        is_error=True,
    )


def parse_mode(raw: Any) -> Mode:
    return raw if raw in ("ui", "text", "auto") else "auto"


def narrated_tool_result(
    view: str,
    data: Json,
    mode: Mode = "auto",
    meta: Json | None = None,
    *,
    now: datetime | None = None,
) -> CallToolResult:
    """``narratedToolResult``: the narration (led by a one-line placeholder in ``ui`` mode),
    one ``resource_link`` per link, and the payload as structured content."""
    narrator = NARRATORS.get(view)
    if narrator is None:
        return CallToolResult(
            content=[TextContent(type="text", text=_json(data))],
            structured_content=data,
            meta=meta,
        )
    output = narrator(data, now)
    narrated = TextContent(type="text", text=output.text)
    links = [
        ResourceLink(type="resource_link", uri=link["uri"], name=link["name"])
        for link in output.links
    ]
    content: list[Any] = [narrated, *links]
    if mode == "ui":
        content.insert(0, TextContent(type="text", text=_ui_placeholder(view, data)))
    if mode == "text" and meta and "ui" in meta:
        meta = {key: value for key, value in meta.items() if key != "ui"}
    return CallToolResult(content=content, structured_content=data, meta=meta)


async def _resolve_customer(
    get_customer_ref: GetCustomerRef, args: Mapping[str, Any], context: Context
) -> str | None:
    value = get_customer_ref(args, context)
    resolved = await value if inspect.isawaitable(value) else value
    return signed_in_customer_ref(resolved)


def _error_from(error: SolvaPayError) -> CallToolResult:
    status = error.status if error.status is not None else 500
    return tool_error_result(error.message, status, error.message)


def _annotate(tool: Callable[..., Any], params: list[inspect.Parameter]) -> None:
    """Gives ``tool`` the signature ``MCPServer`` derives its input schema from."""
    params = [
        *params,
        inspect.Parameter(_CONTEXT_PARAM, inspect.Parameter.KEYWORD_ONLY, annotation=Context),
    ]
    tool.__signature__ = inspect.Signature(params, return_annotation=CallToolResult)  # type: ignore[attr-defined]
    tool.__annotations__ = {p.name: p.annotation for p in params} | {"return": CallToolResult}


def register_intent_tools(
    server: MCPServer,
    *,
    solvapay: SolvaPay,
    product_ref: str,
    public_base_url: str,
    views: Iterable[ViewKind] = ADVERTISED_VIEWS,
    get_customer_ref: GetCustomerRef | None = None,
    resource_uri: str | None = None,
) -> None:
    """Registers ``account`` (unless ``views`` is empty), ``activate_plan``, the
    ``/upgrade``, ``/manage_account``, ``/topup`` and ``/activate_plan`` prompts, and the
    ``docs://solvapay/overview.md`` resource.

    ``resource_uri`` is the widget's ``ui://`` resource, which the caller registers
    (``create_solvapay_mcp_server`` does). Without it ``account`` is text only."""
    if not public_base_url.startswith(("https://", "http://")):
        raise SolvaPayError("public_base_url must be an http(s) URL", code="invalid_argument")
    enabled = set(views)
    unknown = enabled - set(ADVERTISED_VIEWS)
    if unknown:
        raise SolvaPayError(
            f"Unknown views: {', '.join(sorted(unknown))}. Use checkout, account or topup.",
            code="invalid_argument",
        )
    resolve = get_customer_ref or default_customer_ref
    advertised = [view for view in ADVERTISED_VIEWS if view in enabled]

    async def payload(view: ViewKind, customer_ref: str | None) -> Json:
        return await build_bootstrap_payload(
            solvapay,
            view=view,
            product_ref=product_ref,
            public_base_url=public_base_url,
            customer_ref=customer_ref,
        )

    if advertised:

        async def account(**kwargs: Any) -> CallToolResult:
            context: Context = kwargs.pop(_CONTEXT_PARAM)
            requested = kwargs.get("view")
            if requested is not None and requested != "auto-recharge" and requested not in enabled:
                return tool_error_result(
                    f"view '{requested}' is not enabled on this server",
                    400,
                    f"Enabled views: {', '.join(advertised)}. Pass one of those, or omit "
                    "view to let the server pick.",
                )
            mode = parse_mode(kwargs.get("mode"))
            customer_ref = await _resolve_customer(resolve, kwargs, context)
            try:
                if requested is None:
                    # Built as 'account': the view only steers the checkout purpose.
                    data = await payload("account", customer_ref)
                    data["view"] = derive_default_view(data, enabled)
                else:
                    data = await payload(requested, customer_ref)
            except SolvaPayError as error:
                return _error_from(error)
            result_meta: Json = {"openai/widgetSessionId": str(uuid.uuid4())}
            if resource_uri is not None:
                result_meta = {"ui": {"resourceUri": resource_uri}, **result_meta}
            return narrated_tool_result(data["view"], data, mode, result_meta)

        view_type: Any = Literal[tuple(advertised)]
        _annotate(
            account,
            [
                inspect.Parameter(
                    "view",
                    inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=Annotated[
                        view_type | None,
                        # An old transcript's 'auto-recharge' still parses, as 'account'.
                        BeforeValidator(lambda v: "account" if v == "auto-recharge" else v),
                        Field(description=VIEW_PARAM_DESCRIPTION),
                    ],
                ),
                inspect.Parameter(
                    "mode",
                    inspect.Parameter.KEYWORD_ONLY,
                    default=None,
                    annotation=Annotated[Mode | None, Field(description=MODE_PARAM_DESCRIPTION)],
                ),
            ],
        )
        server.add_tool(
            account,
            name=VIEWER_TOOL_NAME,
            title="Account",
            description=VIEWER_DESCRIPTION,
            annotations=ToolAnnotations(
                read_only_hint=True, idempotent_hint=True, open_world_hint=True
            ),
            meta=tool_ui_meta(resource_uri) if resource_uri is not None else None,
            structured_output=False,
        )

    async def activate_plan(**kwargs: Any) -> CallToolResult:
        context: Context = kwargs.pop(_CONTEXT_PARAM)
        product_arg = kwargs.get("productRef")
        product = product_arg if isinstance(product_arg, str) and product_arg else product_ref
        plan_arg = kwargs.get("planRef")
        plan_ref = plan_arg.strip() if isinstance(plan_arg, str) else ""
        if not plan_ref:
            return tool_error_result(
                "activate_plan requires a planRef",
                400,
                "Pass `planRef` to activate a specific plan. To list plans, call `account` "
                'with view: "checkout".',
            )
        customer_ref = await _resolve_customer(resolve, kwargs, context)
        if customer_ref is None:
            return tool_error_result(
                "Unauthorized", 401, "customer_ref missing from MCP auth context"
            )
        api = solvapay.api
        try:
            response = await api.activate_plan(
                body={"customerRef": customer_ref, "productRef": product, "planRef": plan_ref}
            )
        except SolvaPayError as error:
            return _error_from(error)
        result: Json = response.model_dump(mode="json", by_alias=True, exclude_unset=True)
        solvapay.paywall.invalidate_limits(customer_ref, product)

        checkout_url = get(result, "checkoutUrl")
        if result.get("status") == "payment_required" and not checkout_url:
            try:
                session = await api.create_checkout_session(
                    body={"productRef": product, "customerRef": customer_ref, "planRef": plan_ref}
                )
                checkout_url = session.checkout_url
            except SolvaPayError:
                pass  # TypeScript answers without a link too; the narration says to call account.

        try:
            listed = (await api.list_plans(product_ref=product)).plans or []
            plan_name = next((p.name for p in listed if p.reference == plan_ref), None)
        except SolvaPayError:
            plan_name = None  # The name only labels the narration.

        narrated: Json = {**result}
        if isinstance(checkout_url, str):
            narrated["checkoutUrl"] = checkout_url
        if plan_name is not None:
            narrated["planName"] = plan_name
        structured = {**result}
        if isinstance(checkout_url, str) and checkout_url:
            structured["checkoutUrl"] = checkout_url
        return CallToolResult(
            content=[TextContent(type="text", text=narrate_activate_plan(narrated))],
            structured_content=structured,
        )

    _annotate(
        activate_plan,
        [
            inspect.Parameter(
                "planRef",
                inspect.Parameter.KEYWORD_ONLY,
                annotation=Annotated[str, Field(description="Plan to activate. Required.")],
            ),
            inspect.Parameter(
                "productRef", inspect.Parameter.KEYWORD_ONLY, default=None, annotation=str | None
            ),
        ],
    )
    server.add_tool(
        activate_plan,
        name=ACTIVATE_PLAN_TOOL_NAME,
        title="Activate plan",
        description=ACTIVATE_PLAN_DESCRIPTION,
        annotations=ToolAnnotations(
            read_only_hint=False,
            destructive_hint=False,
            idempotent_hint=True,
            open_world_hint=True,
        ),
        meta={"openai/widgetAccessible": True},
        structured_output=False,
    )

    for prompt in build_solvapay_prompts(enabled):
        server.add_prompt(prompt)

    server.resource(
        OVERVIEW_URI,
        name="SolvaPay MCP — overview",
        title="SolvaPay overview",
        description=(
            'Agent-facing "start here" doc — explains the two intent tools, dual-audience '
            "fallback, and auth model before any tool is called."
        ),
        mime_type=OVERVIEW_MIME_TYPE,
    )(lambda: OVERVIEW_MARKDOWN)


def build_solvapay_prompts(enabled_views: Iterable[ViewKind] = ADVERTISED_VIEWS) -> list[Prompt]:
    """The slash-command prompts: one user message each, naming the tool to call."""
    enabled = set(enabled_views)
    viewer = f"Call the `{VIEWER_TOOL_NAME}` tool with view:"
    prompts: list[Prompt] = []

    if "checkout" in enabled:

        def upgrade(planRef: str | None = None) -> str:
            if planRef:
                return f'{viewer} "checkout", then activate plan {planRef}.'
            return f'{viewer} "checkout" to show upgrade options.'

        prompts.append(
            Prompt.from_function(
                upgrade,
                name="upgrade",
                title="Upgrade plan",
                description="Start or change a paid plan for the current customer.",
            )
        )

    if "account" in enabled:

        def manage_account() -> str:
            return f'{viewer} "account" to show my SolvaPay account.'

        prompts.append(
            Prompt.from_function(
                manage_account,
                name="manage_account",
                title="Manage account",
                description=(
                    "Show the current plan, balance, payment method, and cancel/reactivate "
                    "controls for the current customer."
                ),
            )
        )

    if "topup" in enabled:

        def topup(amount: str | None = None) -> str:
            if amount:
                return f'{viewer} "topup" and top up my credits by {amount}.'
            return f'{viewer} "topup" to add SolvaPay credits.'

        prompts.append(
            Prompt.from_function(
                topup,
                name="topup",
                title="Top up credits",
                description="Add SolvaPay credits to the current customer.",
            )
        )

    def activate(planRef: str | None = None) -> str:
        if planRef:
            return f"Call the `{ACTIVATE_PLAN_TOOL_NAME}` tool with planRef {planRef}."
        return f'{viewer} "checkout" to list plans I can activate.'

    prompts.append(
        Prompt.from_function(
            activate,
            name="activate_plan",
            title="Activate plan",
            description="Activate a specific plan by ref, or list plans to pick from.",
        )
    )
    return prompts


__all__ = [
    "OVERVIEW_MARKDOWN",
    "OVERVIEW_URI",
    "build_solvapay_prompts",
    "narrated_tool_result",
    "parse_mode",
    "register_intent_tools",
    "tool_error_result",
]
