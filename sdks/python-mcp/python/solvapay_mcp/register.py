from __future__ import annotations

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
    _call,
    assert_response_result,
    paywall_tool_result,
)
from solvapay_mcp.core import call
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
_HIDE_AUDIENCES: WeakKeyDictionary[Server[object], list[str]] = WeakKeyDictionary()
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


def set_hide_tools_by_audience(server: Server[object], audiences: list[str] | None) -> None:
    if audiences:
        _HIDE_AUDIENCES[server] = list(audiences)
    elif server in _HIDE_AUDIENCES:
        del _HIDE_AUDIENCES[server]


def _now_ms() -> int:
    return int(time.time() * 1000)


def _tools(server: Server[object]) -> dict[str, _PayableTool]:
    registry = _REGISTRIES.get(server)
    if registry is None:
        registry = {}
        _REGISTRIES[server] = registry
    _install_dispatch(server)
    return registry


def ensure_dispatch(server: Server[object]) -> None:
    _install_dispatch(server)


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

    from solvapay_mcp.server.engine import dispatch_rpc, engine_for

    def _rpc(method: str, params: object, request_id: object = 1) -> dict[str, object]:
        return {"jsonrpc": "2.0", "id": request_id, "method": method, "params": params}

    async def _result(method: str, params: object) -> object:
        envelope = await dispatch_rpc(server, _rpc(method, params))
        kind = envelope.get("kind")
        if kind == "challenge":
            raise ValueError("mcp auth challenge")
        rpc = envelope.get("rpc") if kind == "rpc" else envelope
        if isinstance(rpc, dict):
            return rpc.get("result")
        return rpc

    async def on_list_tools(_ctx: object, _params: PaginatedRequestParams) -> ListToolsResult:
        binding = engine_for(server)
        if binding is None:
            tools: list[Tool] = []
            for name, payable_spec in dict(_REGISTRIES.get(server) or {}).items():
                tool = Tool(name=name, input_schema=payable_spec.input_schema)
                if payable_spec.title is not None:
                    tool.title = payable_spec.title
                if payable_spec.description is not None:
                    tool.description = payable_spec.description
                tools.append(tool)
            return ListToolsResult(tools=tools)
        raw = await _result("tools/list", {})
        tools: list[Tool] = []
        descriptors: dict[str, dict[str, object]] = {}
        desc_raw = call(
            "mcpDescriptors",
            {
                "resourceUri": binding.resource_uri,
                "publicBaseUrl": binding.public_base_url,
                "productRef": binding.product_ref,
                **({"views": binding.views} if binding.views is not None else {}),
                **({"csp": binding.csp} if binding.csp is not None else {}),
                **({"apiBaseUrl": binding.api_base_url} if binding.api_base_url is not None else {}),
            },
        )
        if isinstance(desc_raw, dict) and isinstance(desc_raw.get("tools"), list):
            for item in desc_raw["tools"]:
                if isinstance(item, dict) and isinstance(item.get("name"), str):
                    descriptors[str(item["name"])] = item
        if isinstance(raw, dict) and isinstance(raw.get("tools"), list):
            for item in raw["tools"]:
                if isinstance(item, dict):
                    name = item.get("name")
                    descriptor = descriptors.get(str(name)) if isinstance(name, str) else None
                    if descriptor is not None:
                        meta = descriptor.get("meta")
                        if isinstance(meta, dict):
                            ui = meta.get("ui")
                            if (
                                isinstance(ui, dict)
                                and "resourceUri" in ui
                                and "ui/resourceUri" not in meta
                            ):
                                meta = {**meta, "ui/resourceUri": ui["resourceUri"]}
                            item = {**item, "_meta": meta, "annotations": descriptor.get("annotations")}
                    tools.append(Tool.model_validate(item))
        payable_tools: dict[str, _PayableTool] = dict(_REGISTRIES.get(server) or {})
        listed = {tool.name for tool in tools}
        for name, payable_spec in payable_tools.items():
            if name in listed:
                continue
            tool = Tool(name=name, input_schema=payable_spec.input_schema)
            if payable_spec.title is not None:
                tool.title = payable_spec.title
            if payable_spec.description is not None:
                tool.description = payable_spec.description
            tools.append(tool)
        return ListToolsResult(tools=tools)

    async def on_call_tool(_ctx: object, params: CallToolRequestParams) -> CallToolResult:
        spec = _REGISTRIES.get(server, {}).get(params.name)
        if spec is not None:
            arguments = params.arguments if isinstance(params.arguments, dict) else {}
            payload = await _invoke_payable(spec, dict(arguments))
            return _to_call_tool_result(payload)
        raw = await _result(
            "tools/call",
            {"name": params.name, "arguments": params.arguments or {}},
        )
        if isinstance(raw, Mapping):
            return _to_call_tool_result(raw)
        raise TypeError("tools/call did not return an object")

    async def on_list_resources(
        _ctx: object, _params: PaginatedRequestParams
    ) -> ListResourcesResult:
        raw = await _result("resources/list", {})
        resources: list[Resource] = []
        ui_meta: dict[str, object] | None = None
        binding = engine_for(server)
        if binding is not None:
            desc_raw = call(
                "mcpDescriptors",
                {
                    "resourceUri": binding.resource_uri,
                    "publicBaseUrl": binding.public_base_url,
                    "productRef": binding.product_ref,
                    **({"csp": binding.csp} if binding.csp is not None else {}),
                    **({"apiBaseUrl": binding.api_base_url} if binding.api_base_url is not None else {}),
                },
            )
            if isinstance(desc_raw, dict) and isinstance(desc_raw.get("csp"), dict):
                ui_meta = {"ui": {"csp": desc_raw["csp"], "prefersBorder": False}}
        if isinstance(raw, dict) and isinstance(raw.get("resources"), list):
            for item in raw["resources"]:
                if isinstance(item, dict):
                    if ui_meta is not None and item.get("uri") == (binding.resource_uri if binding else None):
                        item = {**item, "_meta": ui_meta}
                    resources.append(Resource.model_validate(item))
        return ListResourcesResult(resources=resources)

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
        raw = await _result("resources/read", {"uri": str(params.uri)})
        if isinstance(raw, dict):
            return ReadResourceResult.model_validate(raw)
        raise TypeError("resources/read did not return an object")

    async def on_list_prompts(_ctx: object, _params: PaginatedRequestParams) -> ListPromptsResult:
        raw = await _result("prompts/list", {})
        prompts: list[Prompt] = []
        if isinstance(raw, dict) and isinstance(raw.get("prompts"), list):
            for item in raw["prompts"]:
                if isinstance(item, dict):
                    prompts.append(Prompt.model_validate(item))
        return ListPromptsResult(prompts=prompts)

    async def on_get_prompt(_ctx: object, params: GetPromptRequestParams) -> GetPromptResult:
        arguments = params.arguments if isinstance(params.arguments, dict) else {}
        raw = await _result("prompts/get", {"name": params.name, "arguments": arguments})
        if isinstance(raw, dict) and "messages" in raw:
            return GetPromptResult.model_validate(raw)
        text = str(raw)
        return GetPromptResult(
            messages=[
                PromptMessage(
                    role="user",
                    content=TextContent(type="text", text=text),
                )
            ]
        )

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


def _invoke_payable_next(state: object, event: Mapping[str, object]) -> dict[str, object]:
    out = _call("invoke_payable_next", {"state": state, "event": dict(event)})
    if not isinstance(out, dict):
        raise SolvaPayError("invoke_payable_next returned unexpected value")
    return {str(k): v for k, v in out.items()}


def _as_action_map(out: Mapping[str, object]) -> dict[str, object]:
    raw = out.get("action")
    if not isinstance(raw, dict):
        raise SolvaPayError("invoke_payable_next returned unexpected action")
    return {str(k): v for k, v in raw.items()}


async def _invoke_payable(spec: _PayableTool, args: dict[str, object]) -> dict[str, object]:
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
    state: object = None
    event: dict[str, object] = {
        "kind": "start",
        "customerRef": customer_ref,
        "product": spec.product,
        "usageType": "requests",
        "startedMs": _now_ms(),
    }
    allow: PayableAllowResult | None = None
    while True:
        out = _invoke_payable_next(state, event)
        state = out.get("state")
        action = _as_action_map(out)
        kind = action.get("kind")
        if kind == "runGate":
            gate_result = await spec.solvapay.gate(
                str(action.get("customerRef")),
                product=str(action.get("product") or spec.product),
            )
            if isinstance(gate_result, PayablePaywallResult):
                gate = dict(gate_result.content)
                message = str(gate.get("message") or "Payment required")
                if _format_gate_override is not None:
                    return _format_gate(message, gate)
                event = {"kind": "gatePaywall", "gate": gate, "message": message}
                continue
            if not isinstance(gate_result, PayableAllowResult):
                raise TypeError("unexpected gate result")
            allow = gate_result
            limits: Mapping[str, object] = {}
            decision = gate_result.decision
            maybe_limits = decision.get("limits") if isinstance(decision, Mapping) else None
            if isinstance(maybe_limits, Mapping):
                limits = maybe_limits
            event = {
                "kind": "gateAllow",
                "customerRef": gate_result.customer_ref,
                "limits": dict(limits),
            }
            continue
        if kind == "invokeHandler":
            limits_raw = action.get("limits")
            limits = limits_raw if isinstance(limits_raw, Mapping) else {}
            ctx = ResponseContext(
                customer={
                    "ref": str(action.get("customerRef") or ""),
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
                if _format_gate_override is not None:
                    return _format_gate(message, gate)
                event = {"kind": "handlerPaywall", "gate": gate, "message": message}
                continue
            except Exception as err:
                event = {
                    "kind": "handlerErr",
                    "message": str(err),
                    "nowMs": _now_ms(),
                }
                continue
            envelope = assert_response_result(returned)
            event = {
                "kind": "handlerOk",
                "envelope": envelope,
                "nowMs": _now_ms(),
            }
            continue
        if kind == "done":
            track = action.get("track")
            if isinstance(track, Mapping) and allow is not None:
                duration = float(track.get("durationMs") or 0)
                if str(track.get("outcome")) == "success":
                    allow.track_success(duration=duration)
                else:
                    allow.track_fail(track.get("outcome"), duration=duration)
            result = action.get("result")
            if not isinstance(result, dict):
                raise SolvaPayError("invoke_payable_next done missing result")
            return {str(k): v for k, v in result.items()}
        raise SolvaPayError(f"invoke_payable_next unknown action kind: {kind}")
