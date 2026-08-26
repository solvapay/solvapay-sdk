from __future__ import annotations

import json
import time
from collections.abc import Awaitable, Callable, Mapping
from contextvars import ContextVar, Token
from dataclasses import dataclass
from weakref import WeakKeyDictionary, WeakSet

from mcp.server.lowlevel.server import Server
from mcp.types import (
    Annotations,
    CallToolRequestParams,
    CallToolResult,
    ContentBlock,
    ListPromptsResult,
    ListResourcesResult,
    ListToolsResult,
    PaginatedRequestParams,
    Prompt,
    Resource,
    ResourceLink,
    TextContent,
    Tool,
)
from solvapay.errors import PaywallError, SolvaPayError
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
BuiltinHandler = Callable[[dict[str, object]], Awaitable[Mapping[str, object]]]

_format_gate_override: FormatGateFn | None = None
_REGISTRIES: WeakKeyDictionary[Server[object], dict[str, _PayableTool]] = WeakKeyDictionary()
_BUILTIN_REGISTRIES: WeakKeyDictionary[Server[object], dict[str, _BuiltinTool]] = (
    WeakKeyDictionary()
)
_RESOURCE_REGISTRIES: WeakKeyDictionary[Server[object], list[_RegisteredResource]] = (
    WeakKeyDictionary()
)
_PROMPT_REGISTRIES: WeakKeyDictionary[Server[object], list[_RegisteredPrompt]] = WeakKeyDictionary()
_DISPATCH_INSTALLED: WeakSet[Server[object]] = WeakSet()
_request_customer_ref: ContextVar[str | None] = ContextVar(
    "solvapay_mcp_customer_ref", default=None
)


class MissingCustomerRefError(SolvaPayError):
    def __init__(self, message: str = "customer_ref missing from MCP auth context") -> None:
        super().__init__(message)
        self.status = 401
        self.code = "unauthorized"


@dataclass
class _PayableTool:
    solvapay: SolvaPay
    product: str
    handler: Handler
    title: str | None
    description: str | None
    input_schema: dict[str, object]
    get_customer_ref: GetCustomerRef | None


@dataclass
class _BuiltinTool:
    tool: Tool
    handler: BuiltinHandler


@dataclass
class _RegisteredResource:
    resource: Resource
    read: Callable[[], Awaitable[str]]


@dataclass
class _RegisteredPrompt:
    prompt: Prompt
    handler: Callable[[dict[str, str]], Awaitable[str]]


def set_request_customer_ref(ref: str | None) -> Token[str | None]:
    return _request_customer_ref.set(ref)


def reset_request_customer_ref(token: Token[str | None]) -> None:
    _request_customer_ref.reset(token)


def get_request_customer_ref() -> str | None:
    raw = _request_customer_ref.get()
    if isinstance(raw, str) and raw.strip():
        return raw.strip()
    return None


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
    _install_dispatch(server)
    return registry


def _builtins(server: Server[object]) -> dict[str, _BuiltinTool]:
    registry = _BUILTIN_REGISTRIES.get(server)
    if registry is None:
        registry = {}
        _BUILTIN_REGISTRIES[server] = registry
    _install_dispatch(server)
    return registry


def _resources(server: Server[object]) -> list[_RegisteredResource]:
    registry = _RESOURCE_REGISTRIES.get(server)
    if registry is None:
        registry = []
        _RESOURCE_REGISTRIES[server] = registry
    _install_dispatch(server)
    return registry


def _prompts(server: Server[object]) -> list[_RegisteredPrompt]:
    registry = _PROMPT_REGISTRIES.get(server)
    if registry is None:
        registry = []
        _PROMPT_REGISTRIES[server] = registry
    _install_dispatch(server)
    return registry


def _install_dispatch(server: Server[object]) -> None:
    if server in _DISPATCH_INSTALLED:
        return
    _DISPATCH_INSTALLED.add(server)

    async def on_list_tools(_ctx: object, _params: PaginatedRequestParams) -> ListToolsResult:
        tools: list[Tool] = []
        for spec in (_BUILTIN_REGISTRIES.get(server) or {}).values():
            tools.append(spec.tool)
        payable_tools: dict[str, _PayableTool] = dict(_REGISTRIES.get(server) or {})
        for name, payable_spec in payable_tools.items():
            tool = Tool(name=name, input_schema=payable_spec.input_schema)
            if payable_spec.title is not None:
                tool.title = payable_spec.title
            if payable_spec.description is not None:
                tool.description = payable_spec.description
            tools.append(tool)
        return ListToolsResult(tools=tools)

    async def on_call_tool(_ctx: object, params: CallToolRequestParams) -> CallToolResult:
        builtin = _BUILTIN_REGISTRIES.get(server, {}).get(params.name)
        if builtin is not None:
            arguments = params.arguments if isinstance(params.arguments, dict) else {}
            payload = await builtin.handler(dict(arguments))
            return _to_call_tool_result(payload)
        spec = _REGISTRIES.get(server, {}).get(params.name)
        if spec is None:
            raise ValueError(f"Unknown tool: {params.name}")
        arguments = params.arguments if isinstance(params.arguments, dict) else {}
        payload = await _invoke_payable(spec, dict(arguments))
        return _to_call_tool_result(payload)

    async def on_list_resources(
        _ctx: object, _params: PaginatedRequestParams
    ) -> ListResourcesResult:
        return ListResourcesResult(resources=[item.resource for item in _resources(server)])

    from mcp.types import (
        GetPromptRequestParams,
        GetPromptResult,
        PromptMessage,
        ReadResourceRequestParams,
        ReadResourceResult,
        TextContent,
        TextResourceContents,
    )

    async def on_read_resource(
        _ctx: object, params: ReadResourceRequestParams
    ) -> ReadResourceResult:

        if not isinstance(params, ReadResourceRequestParams):
            raise ValueError("invalid resources/read params")
        uri = str(params.uri)
        for item in _resources(server):
            if str(item.resource.uri) == uri:
                text = await item.read()
                return ReadResourceResult(
                    contents=[
                        TextResourceContents(
                            uri=item.resource.uri,
                            mime_type=item.resource.mime_type,
                            text=text,
                            _meta=item.resource.meta,
                        )
                    ]
                )
        raise ValueError(f"Unknown resource: {uri}")

    async def on_list_prompts(_ctx: object, _params: PaginatedRequestParams) -> ListPromptsResult:
        return ListPromptsResult(prompts=[item.prompt for item in _prompts(server)])

    async def on_get_prompt(_ctx: object, params: GetPromptRequestParams) -> GetPromptResult:

        if not isinstance(params, GetPromptRequestParams):
            raise ValueError("invalid prompts/get params")
        for item in _prompts(server):
            if item.prompt.name == params.name:
                args = params.arguments if isinstance(params.arguments, dict) else {}
                text = await item.handler({str(k): str(v) for k, v in args.items()})
                return GetPromptResult(
                    messages=[
                        PromptMessage(
                            role="user",
                            content=TextContent(type="text", text=text),
                        )
                    ]
                )
        raise ValueError(f"Unknown prompt: {params.name}")

    server.add_request_handler("tools/list", PaginatedRequestParams, on_list_tools)
    server.add_request_handler("tools/call", CallToolRequestParams, on_call_tool)
    server.add_request_handler("resources/list", PaginatedRequestParams, on_list_resources)
    server.add_request_handler("resources/read", ReadResourceRequestParams, on_read_resource)
    server.add_request_handler("prompts/list", PaginatedRequestParams, on_list_prompts)
    server.add_request_handler("prompts/get", GetPromptRequestParams, on_get_prompt)


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


def register_builtin_tool(server: Server[object], tool: Tool, handler: BuiltinHandler) -> None:
    _builtins(server)[tool.name] = _BuiltinTool(tool=tool, handler=handler)


def register_resource(
    server: Server[object],
    resource: Resource,
    read: Callable[[], Awaitable[str]],
) -> None:
    _resources(server).append(_RegisteredResource(resource=resource, read=read))


def register_prompt(
    server: Server[object],
    prompt: Prompt,
    handler: Callable[[dict[str, str]], Awaitable[str]],
) -> None:
    _prompts(server).append(_RegisteredPrompt(prompt=prompt, handler=handler))


async def _resolve_customer_ref(
    args: dict[str, object],
    get_customer_ref: GetCustomerRef | None,
) -> str:
    if get_customer_ref is not None:
        resolved = get_customer_ref(args)
        if isinstance(resolved, str):
            return resolved
        return await resolved
    request_ref = get_request_customer_ref()
    if request_ref is not None:
        return request_ref
    raw = args.get("customer_ref")
    if isinstance(raw, str) and raw:
        return raw
    raise MissingCustomerRefError()


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
                raw_ann = block.get("annotations")
                text_ann = (
                    Annotations.model_validate(raw_ann) if isinstance(raw_ann, dict) else None
                )
                content.append(
                    TextContent(
                        type="text",
                        text=str(block.get("text", "")),
                        annotations=text_ann,
                    )
                )
            elif isinstance(block, dict) and block.get("type") == "resource_link":
                raw_ann = block.get("annotations")
                content.append(
                    ResourceLink(
                        type="resource_link",
                        name=str(block.get("name") or ""),
                        uri=str(block.get("uri") or ""),
                        annotations=Annotations(**raw_ann) if isinstance(raw_ann, dict) else None,
                    )
                )
    structured = payload.get("structuredContent")
    meta = payload.get("_meta")
    is_error = payload.get("isError")
    kwargs: dict[str, object] = {"content": content, "structured_content": structured}
    if isinstance(meta, dict):
        kwargs["meta"] = meta
    if is_error is None:
        return CallToolResult(**kwargs)  # type: ignore[arg-type]
    return CallToolResult(
        **kwargs,  # type: ignore[arg-type]
        is_error=bool(is_error),
    )


async def _invoke_payable(spec: _PayableTool, args: dict[str, object]) -> dict[str, object]:
    started = _now_ms()
    try:
        customer_ref = await _resolve_customer_ref(args, spec.get_customer_ref)
    except MissingCustomerRefError as err:
        return {
            "isError": True,
            "content": [{"type": "text", "text": str(err)}],
            "structuredContent": {
                "error": "Unauthorized",
                "status": 401,
                "details": str(err),
            },
        }
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
