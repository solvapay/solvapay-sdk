"""What a paid MCP tool's handler receives and returns.

A handler gets a ``ResponseContext`` and returns ``ctx.respond(data, ...)``.
The SDK turns that into the MCP tool result, the same shape the TypeScript
SDK's ``buildPayableHandler`` produces.
"""

from __future__ import annotations

import json
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any, Literal

from mcp.types import CallToolResult, EmbeddedResource, TextContent, TextResourceContents

from .._js import UNDEFINED, get
from ..paywall import PaywallStateKind, build_nudge_message, credit_signals
from ..paywall.decide import FreeLimit, PaywallError

Json = dict[str, Any]
NudgeKind = Literal["low-balance", "cycle-ending", "approaching-limit"]


@dataclass(frozen=True)
class Nudge:
    """A soft prompt appended to a successful result, such as a low balance."""

    kind: NudgeKind
    message: str = ""


@dataclass(frozen=True)
class CustomerSnapshot:
    """The customer as the limits check before this call saw them (up to 10 s old)."""

    ref: str
    balance: float | None
    is_credit_based: bool
    remaining: float | None
    within_limits: bool
    overage: bool
    plan: Json | None
    _refresh: Callable[[], Awaitable[CustomerSnapshot]] = field(repr=False)

    async def fresh(self) -> CustomerSnapshot:
        """Asks the API again, bypassing the cache."""
        return await self._refresh()


@dataclass(frozen=True)
class ResponseResult:
    """What ``ctx.respond`` returns. Return it from the handler as is."""

    data: Any
    text: str | None
    nudge: Nudge | None
    data_in_text: bool
    emitted: list[Json]
    limits: Json | None


def _snapshot(
    customer_ref: str,
    limits: Json | None,
    plan: Json | None,
    refresh: Callable[[], Awaitable[CustomerSnapshot]],
) -> CustomerSnapshot:
    signals = credit_signals(limits)
    balance = signals.get("creditBalance", UNDEFINED)
    remaining = get(limits, "remaining")
    return CustomerSnapshot(
        ref=customer_ref,
        balance=None if balance is UNDEFINED else balance,
        is_credit_based=bool(signals["isCreditBased"]),
        remaining=None if remaining is UNDEFINED else remaining,
        within_limits=bool(get(limits, "withinLimits")) if limits else True,
        overage=get(limits, "overage") is True,
        plan=plan,
        _refresh=refresh,
    )


class ResponseContext:
    """The paid tool's view of the customer and its way to answer."""

    def __init__(
        self,
        *,
        customer_ref: str,
        limits: Json | None,
        product: str,
        check_limits: Callable[[Json], Awaitable[Json]],
        free_limit: FreeLimit | None = None,
    ) -> None:
        self._limits = limits
        self._emitted: list[Json] = []
        self.product: Json = {"reference": product, "name": product}
        plan_ref = get(limits, "planRef")
        plan = {"reference": plan_ref} if isinstance(plan_ref, str) and plan_ref else None

        async def refresh() -> CustomerSnapshot:
            body: Json = {
                "customerRef": customer_ref,
                "productRef": product,
                "meterName": free_limit.meter if free_limit else "requests",
            }
            if free_limit:
                body["freeAllowance"] = free_limit.wire()
            return _snapshot(customer_ref, await check_limits(body), plan, refresh)

        self.customer = _snapshot(customer_ref, limits, plan, refresh)

    def respond(
        self,
        data: Any,
        *,
        text: str | None = None,
        nudge: Nudge | None = None,
        data_in_text: bool = True,
    ) -> ResponseResult:
        """The tool's answer. ``text`` replaces the JSON in the first content block;
        ``nudge`` appends a soft prompt (default copy when its message is empty)."""
        return ResponseResult(
            data=data,
            text=text,
            nudge=nudge,
            data_in_text=data_in_text,
            emitted=list(self._emitted),
            limits=self._limits,
        )

    def gate(self, reason: str | None = None) -> None:
        """Stops the call and shows a paywall instead."""
        message = reason or "Payment required"
        raise PaywallError(
            {
                "kind": "payment_required",
                "product": self.product["reference"],
                "checkoutUrl": "",
                "message": message,
            }
        )

    async def emit(self, block: Json) -> None:
        """Queues a content block (text, image or resource) ahead of the answer."""
        self._emitted.append(block)


def gate_result(gate: Json) -> CallToolResult:
    """A paywall as a tool result: not an error, the message as text, the gate as data."""
    return CallToolResult(
        content=[TextContent(type="text", text=str(gate["message"]))],
        structured_content=gate,
        is_error=False,
    )


def error_result(message: str) -> CallToolResult:
    return CallToolResult(
        content=[
            TextContent(
                type="text", text=json.dumps({"success": False, "error": message}, indent=2)
            )
        ],
        is_error=True,
    )


def _json(data: Any) -> str:
    return json.dumps(data, separators=(",", ":"), ensure_ascii=False)


def unwrap(result: ResponseResult) -> CallToolResult:
    """The tool result for a ``ResponseResult``, as the TypeScript SDK builds it."""
    if not isinstance(result, ResponseResult):
        raise TypeError(
            "A paid tool's handler must return ctx.respond(data, ...), "
            f"not {type(result).__name__}."
        )
    base_text = result.text if isinstance(result.text, str) else _json(result.data)
    primary = base_text
    nudge_text: str | None = None
    if result.nudge is not None:
        credit_based = bool(credit_signals(result.limits)["isCreditBased"])
        fallback: PaywallStateKind = (
            "topup_required"
            if result.nudge.kind == "low-balance" and credit_based
            else "upgrade_required"
        )
        nudge_text = result.nudge.message or build_nudge_message(fallback, result.limits)
        primary = f"{base_text}\n\n{nudge_text}" if base_text else nudge_text

    content: list[Any] = [*result.emitted, TextContent(type="text", text=primary)]
    if (isinstance(result.text, str) or nudge_text is not None) and result.data_in_text:
        content.append(TextContent(type="text", text=_json(result.data)))
    if nudge_text is not None:
        content.append(
            EmbeddedResource(
                type="resource",
                resource=TextResourceContents(
                    uri="solvapay://nudge", mime_type="text/plain", text=nudge_text
                ),
            )
        )
    structured = result.data if isinstance(result.data, dict) else None
    return CallToolResult(content=content, structured_content=structured, is_error=False)
