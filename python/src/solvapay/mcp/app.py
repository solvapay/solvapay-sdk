"""The SolvaPay MCP App: the checkout, account and top-up widget hosts open in an iframe.

Ported from ``@solvapay/mcp-core`` (``descriptors.ts``, ``csp.ts``,
``hideToolsByAudience.ts``) and ``@solvapay/mcp`` (``buildMcpServer.ts``).

The widget is the TypeScript SDK's: ``widget/`` builds
``@solvapay/react``'s MCP views into one ``mcp-app.html``, which this package
ships (``scripts/sync_widget.py`` keeps the copy current). It holds nothing
merchant-specific; the ``account`` tool's bootstrap payload carries the
merchant, product, plans and return URL at runtime.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Callable, Mapping, Sequence
from functools import cache
from importlib import resources
from typing import Any
from urllib.parse import urlsplit

from mcp.server.context import CallNext, HandlerResult, ServerRequestContext
from mcp.server.mcpserver.resources import TextResource
from mcp.types import ListToolsResult

from ..errors import SolvaPayError

logger = logging.getLogger("solvapay.mcp")

Json = dict[str, Any]

RESOURCE_MIME_TYPE = "text/html;profile=mcp-app"
"""The MIME type every MCP Apps UI resource is served as."""

RESOURCE_URI_META_KEY = "ui/resourceUri"
"""The flat ``_meta`` key hosts older than the 2026-01-26 MCP Apps spec read."""

BOOTSTRAP_URI = "solvapay://bootstrap.json"
BOOTSTRAP_MIME_TYPE = "application/json"

WIDGET_FILE = "mcp-app.html"

DEFAULT_CSP: dict[str, list[str]] = {
    "resourceDomains": [
        "https://js.stripe.com",
        "https://*.stripe.com",
        "https://b.stripecdn.com",
        # Claude injects Anthropic Sans @font-face CSS from here.
        "https://assets.claude.ai",
    ],
    "connectDomains": [
        "https://api.stripe.com",
        "https://m.stripe.com",
        "https://r.stripe.com",
        "https://q.stripe.com",
        "https://errors.stripe.com",
    ],
    "frameDomains": ["https://js.stripe.com", "https://hooks.stripe.com"],
}
"""``SOLVAPAY_DEFAULT_CSP``: Stripe Elements, its 3-D Secure frame, and host fonts."""

CSP_KEYS = ("resourceDomains", "connectDomains", "frameDomains")


def _origin(url: str | None) -> str | None:
    if not url:
        return None
    parts = urlsplit(url)
    if parts.scheme not in ("http", "https") or not parts.hostname:
        return None
    return f"{parts.scheme}://{parts.netloc}"


def merge_csp(
    overrides: Mapping[str, Sequence[str]] | None = None, api_base_url: str | None = None
) -> dict[str, list[str]]:
    """``mergeCsp``: the Stripe baseline plus ``overrides``, plus the SolvaPay API origin in
    ``resourceDomains`` and ``connectDomains`` (merchant branding images, API calls)."""
    unknown = set(overrides or {}) - set(CSP_KEYS)
    if unknown:
        raise SolvaPayError(
            f"Unknown CSP keys: {', '.join(sorted(unknown))}. Use {', '.join(CSP_KEYS)}.",
            code="invalid_argument",
        )
    api_origin = _origin(api_base_url)

    def merge(key: str, *extras: Sequence[str] | None) -> list[str]:
        merged = list(DEFAULT_CSP[key])
        for extra in extras:
            for domain in extra or ():
                if domain not in merged:
                    merged.append(domain)
        return merged

    api = [api_origin] if api_origin else None
    return {
        "resourceDomains": merge("resourceDomains", (overrides or {}).get("resourceDomains"), api),
        "connectDomains": merge("connectDomains", (overrides or {}).get("connectDomains"), api),
        "frameDomains": merge("frameDomains", (overrides or {}).get("frameDomains")),
    }


@cache
def widget_html() -> str:
    """The widget this package ships. A missing file is a broken install, never a text-only
    fallback."""
    try:
        return resources.files("solvapay.mcp").joinpath(WIDGET_FILE).read_text(encoding="utf-8")
    except FileNotFoundError as error:
        raise SolvaPayError(
            f"solvapay/mcp/{WIDGET_FILE} is missing from this installation; reinstall solvapay",
            code="widget_missing",
        ) from error


_URI_HOST = re.compile(r"[^a-z0-9-]+")


def default_resource_uri(server_name: str) -> str:
    """``ui://<server name>/mcp-app.html``, the name made safe for a URI host."""
    host = _URI_HOST.sub("-", server_name.lower()).strip("-")
    if not host:
        raise SolvaPayError(
            "The server name has no letters or digits to build a ui:// URI from; pass resource_uri",
            code="invalid_argument",
        )
    return f"ui://{host}/{WIDGET_FILE}"


def tool_ui_meta(resource_uri: str) -> Json:
    """The ``_meta`` a tool that opens the widget lists with (``registerAppTool``)."""
    return {"ui": {"resourceUri": resource_uri}, RESOURCE_URI_META_KEY: resource_uri}


def transport_tool_meta(resource_uri: str) -> Json:
    """The ``_meta`` of a tool only the widget calls.

    ``ui.visibility: ['app']`` keeps it out of the model's tool list on MCP Apps
    hosts; ``audience: 'ui'`` is what ``hide_tools_by_audience`` filters on;
    ChatGPT needs ``openai/widgetAccessible`` to let the iframe call it and
    reads ``openai/visibility`` (default public) to hide it from the model.
    """
    return {
        "ui": {"resourceUri": resource_uri, "visibility": ["app"]},
        "audience": "ui",
        "openai/widgetAccessible": True,
        "openai/visibility": "private",
        RESOURCE_URI_META_KEY: resource_uri,
    }


def app_resource(resource_uri: str, csp: Mapping[str, list[str]], html: str) -> TextResource:
    """The widget as a ``ui://`` resource. Its ``_meta.ui`` is listed and read alike."""
    if not resource_uri.startswith("ui://"):
        raise SolvaPayError(
            f"resource_uri must use the ui:// scheme, got {resource_uri!r}", code="invalid_argument"
        )
    return TextResource(
        uri=resource_uri,
        name=resource_uri,
        mime_type=RESOURCE_MIME_TYPE,
        # The host owns the outer frame; the widget paints none.
        meta={"ui": {"csp": dict(csp), "prefersBorder": True}},
        text=html,
    )


# ---- hide_tools_by_audience ---------------------------------------------------

BypassWhen = Callable[[ServerRequestContext[Any, Any]], bool]

_CHATGPT_CLIENT = re.compile(r"openai-mcp", re.IGNORECASE)


def _user_agent(ctx: ServerRequestContext[Any, Any]) -> str | None:
    headers = getattr(ctx.request, "headers", None)
    value = headers.get("user-agent") if headers is not None else None
    return value if isinstance(value, str) else None


def is_chatgpt_request(ctx: ServerRequestContext[Any, Any]) -> bool:
    """``defaultIsChatGptRequest``: the User-Agent, else the client name from ``initialize``,
    names ChatGPT's MCP client."""
    user_agent = _user_agent(ctx)
    if user_agent and _CHATGPT_CLIENT.search(user_agent):
        return True
    params = getattr(ctx.session, "client_params", None)
    client_info = getattr(params, "client_info", None)
    name = getattr(client_info, "name", None)
    return isinstance(name, str) and _CHATGPT_CLIENT.search(name) is not None


class HideToolsByAudience:
    """Server middleware that leaves tools whose ``_meta.audience`` is one of ``audiences``
    out of ``tools/list``. They stay callable, so the widget still reaches them.

    ChatGPT checks an iframe's ``tools/call`` against the listed tools, so a hidden
    tool would fail there; ``bypass_when`` (ChatGPT by default) gets the full list.
    """

    def __init__(self, audiences: Sequence[str], bypass_when: BypassWhen | None = None) -> None:
        self.hidden = frozenset(audiences)
        self.bypass_when = bypass_when or is_chatgpt_request
        self._warned: set[str] = set()

    async def __call__(
        self, ctx: ServerRequestContext[Any, Any], call_next: CallNext
    ) -> HandlerResult:
        result = await call_next(ctx)
        if ctx.method != "tools/list" or not self.hidden:
            return result
        if self.bypass_when(ctx):
            user_agent = _user_agent(ctx)
            context = f"ua={user_agent}" if user_agent else "no user-agent"
            if context not in self._warned:
                self._warned.add(context)
                logger.warning(
                    "hide_tools_by_audience bypassed (%s); returning the full tools/list", context
                )
            return result
        # The dispatcher hands middleware the wire form (a dict); a direct call may
        # still see the model.
        if isinstance(result, ListToolsResult):
            tools = [
                tool
                for tool in result.tools
                if (tool.meta or {}).get("audience") not in self.hidden
            ]
            return result.model_copy(update={"tools": tools})
        if isinstance(result, dict) and isinstance(result.get("tools"), list):
            return {
                **result,
                "tools": [
                    tool
                    for tool in result["tools"]
                    if (tool.get("_meta") or {}).get("audience") not in self.hidden
                ],
            }
        raise SolvaPayError(
            f"tools/list answered with {type(result).__name__}, not a tools list",
            code="unexpected_result",
        )
