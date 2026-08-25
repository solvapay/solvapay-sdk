from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable, Mapping
from dataclasses import dataclass
from weakref import WeakKeyDictionary

from mcp.server.lowlevel.server import Server
from mcp.types import (
    CallToolRequestParams,
    CallToolResult,
    ContentBlock,
    ListToolsResult,
    PaginatedRequestParams,
    TextContent,
    Tool,
)
from solvapay.errors import PaywallError
from solvapay.facade import SolvaPay
from solvapay.results import PayableAllowResult, PayablePaywallResult

from solvapay_mcp._layer2 import (
    assert_response_result,
    build_payable_tool_result,
    paywall_tool_result,
)
from solvapay_mcp.response_context import ResponseContext

Handler = Callable[[dict[str, object], ResponseContext], Awaitable[object]]
GetCustomerRef = Callable[[dict[str, object]], str | Awaitable[str]]
FormatGateFn = Callable[[str, dict[str, object]], dict[str, object]]

_format_gate_override: FormatGateFn | None = None
_REGISTRIES: WeakKeyDictionary[Server[object], dict[str, _PayableTool]] = WeakKeyDictionary()


@dataclass
class _PayableTool:
    solvapay: SolvaPay
    product: str
    handler: Handler
    title: str | None
    description: str | None
    input_schema: dict[str, object]
    get_customer_ref: GetCustomerRef | None


def set_format_gate_override(fn: FormatGateFn | None) -> None:
    """Test-only hook for the negative adapter-authored gate-copy suite."""
    global _format_gate_override
    _format_gate_override = fn


def _now_ms() -> int:
    return int(time.time() * 1000)


def _tools(server: Server[object]) -> dict[str, _PayableTool]:
    registry = _REGISTRIES.get(server)
    if registry is None:
        registry = {}
        _REGISTRIES[server] = registry
    _install_dispatch(server, registry)
    return registry


def _install_dispatch(server: Server[object], registry: dict[str, _PayableTool]) -> None:
    async def on_list_tools(_ctx: object, _params: PaginatedRequestParams) -> ListToolsResult:
        tools: list[Tool] = []
        for name, spec in registry.items():
            tool = Tool(name=name, input_schema=spec.input_schema)
            if spec.title is not None:
                tool.title = spec.title
            if spec.description is not None:
                tool.description = spec.description
            tools.append(tool)
        return ListToolsResult(tools=tools)

    async def on_call_tool(_ctx: object, params: CallToolRequestParams) -> CallToolResult:
        spec = registry.get(params.name)
        if spec is None:
            raise ValueError(f"Unknown tool: {params.name}")
        arguments = params.arguments if isinstance(params.arguments, dict) else {}
        payload = await _invoke_payable(spec, dict(arguments))
        return _to_call_tool_result(payload)

    server.add_request_handler("tools/list", PaginatedRequestParams, on_list_tools)
    server.add_request_handler("tools/call", CallToolRequestParams, on_call_tool)


def register_payable_tool(
    server: Server[object],
    name: str,
    *,
    solvapay: SolvaPay,
    product: str,
    handler: Handler,
    title: str | None = None,
    description: str | None = None,
    input_schema: dict[str, object] | None = None,
    get_customer_ref: GetCustomerRef | None = None,
) -> None:
    registry = _tools(server)
    schema: dict[str, object] = (
        input_schema if input_schema is not None else {"type": "object", "properties": {}}
    )
    registry[name] = _PayableTool(
        solvapay=solvapay,
        product=product,
        handler=handler,
        title=title,
        description=description,
        input_schema=schema,
        get_customer_ref=get_customer_ref,
    )


async def _resolve_customer_ref(
    args: dict[str, object],
    get_customer_ref: GetCustomerRef | None,
) -> str:
    if get_customer_ref is not None:
        resolved = get_customer_ref(args)
        if isinstance(resolved, str):
            return resolved
        return await resolved
    raw = args.get("customer_ref")
    if isinstance(raw, str) and raw:
        return raw
    return "anonymous"


def _format_gate(message: str, gate: dict[str, object]) -> dict[str, object]:
    if _format_gate_override is not None:
        return _format_gate_override(message, gate)
    return paywall_tool_result(message, gate)


def _to_call_tool_result(payload: Mapping[str, object]) -> CallToolResult:
    content: list[ContentBlock] = []
    raw_content = payload.get("content")
    if isinstance(raw_content, list):
        for block in raw_content:
            if isinstance(block, dict) and block.get("type") == "text":
                content.append(TextContent(type="text", text=str(block.get("text", ""))))
    structured = payload.get("structuredContent")
    is_error = payload.get("isError")
    if is_error is None:
        return CallToolResult(content=content, structured_content=structured)
    return CallToolResult(
        content=content,
        structured_content=structured,
        is_error=bool(is_error),
    )


async def _invoke_payable(spec: _PayableTool, args: dict[str, object]) -> dict[str, object]:
    started = _now_ms()
    customer_ref = await _resolve_customer_ref(args, spec.get_customer_ref)
    gate_result = await spec.solvapay.gate(customer_ref, product=spec.product)
    if isinstance(gate_result, PayablePaywallResult):
        gate = dict(gate_result.content)
        message = str(gate.get("message") or "Payment required")
        return _format_gate(message, gate)

    if not isinstance(gate_result, PayableAllowResult):
        raise TypeError("unexpected gate result")

    limits: Mapping[str, object] = {}
    decision = gate_result.decision
    maybe_limits = decision.get("limits") if isinstance(decision, Mapping) else None
    if isinstance(maybe_limits, Mapping):
        limits = maybe_limits

    ctx = ResponseContext(
        customer={
            "ref": gate_result.customer_ref,
            "balance": limits.get("creditBalance", 0),
            "remaining": limits.get("remaining"),
            "withinLimits": limits.get("withinLimits", True),
            "plan": limits.get("plan"),
        },
        product={"reference": spec.product, "name": spec.product},
        product_ref=spec.product,
    )
    try:
        returned = await spec.handler(args, ctx)
    except PaywallError as err:
        gate = dict(err.structured_content)
        message = str(err)
        return _format_gate(message, gate)
    except Exception as err:
        gate_result.track_fail(err, duration=max(0, _now_ms() - started))
        return {
            "content": [
                {
                    "type": "text",
                    "text": json.dumps({"success": False, "error": str(err)}, indent=2),
                }
            ],
            "isError": True,
        }

    envelope = assert_response_result(returned)
    result = build_payable_tool_result(envelope)
    gate_result.track_success(duration=max(0, _now_ms() - started))
    return result
