"""The tools this server offers. Replace the placeholder work with yours.

The work lives in plain functions (`answer`, `about`) so tests can call it
without SolvaPay; the handlers wrap it with `ctx.respond`.
"""

from __future__ import annotations

from typing import Annotated

from pydantic import Field
from solvapay import FreeLimit
from solvapay.mcp import ResponseContext, SolvaPayMcpServer
from solvapay.mcp.response import ResponseResult


def answer(query: str) -> dict[str, str]:
    """The paid tool's work."""
    return {"query": query, "answer": f"Replace this with the real answer to: {query}"}


def about() -> dict[str, str]:
    """The free tool's work."""
    return {
        "server": "__SERVER_NAME__",
        "paid": "__TOOL_NAME__",
        "free": "about",
    }


async def __TOOL_NAME__(
    query: Annotated[str, Field(description="What to look up.")],
    ctx: ResponseContext,
) -> ResponseResult:
    return ctx.respond(answer(query))


async def about_tool(ctx: ResponseContext) -> ResponseResult:
    return ctx.respond(about())


def register_tools(mcp: SolvaPayMcpServer) -> None:
    # Paid: each call is checked against the customer's plan before the
    # handler runs. Without a plan, the customer gets the paywall instead.
    mcp.register_payable(
        "__TOOL_NAME__",
        handler=__TOOL_NAME__,
        title="__TOOL_NAME__",
        description="Answers a query. Replace this description with what the tool does.",
    )
    # Free up to a cap per customer, then the same paywall as a paid tool.
    mcp.register_free(
        "about",
        handler=about_tool,
        limit=FreeLimit(cap=20, scope="rolling_window", window_days=30),
        description="What this server offers.",
    )
