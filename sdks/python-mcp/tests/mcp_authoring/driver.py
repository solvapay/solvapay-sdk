from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from mcp.client import Client
from mcp.server.lowlevel.server import Server
from solvapay.facade import create_solvapay
from solvapay_mcp.register import register_payable_tool
from solvapay_mcp.response_context import ResponseContext

from tests.mcp_authoring.mock_backend import MockBackend
from tests.mcp_authoring.scenario import (
    HandlerGate,
    HandlerRespond,
    HandlerThrow,
    Scenario,
)


def _compile_handler(scenario: Scenario):
    spec = scenario.handler

    async def handler(_args: dict[str, object], ctx: ResponseContext) -> object:
        if isinstance(spec, HandlerThrow):
            raise RuntimeError(spec.message)
        if isinstance(spec, HandlerGate):
            ctx.gate(spec.reason)
        if isinstance(spec, HandlerRespond):
            if spec.emit is not None:
                for block in spec.emit:
                    ctx.emit(block.model_dump(by_alias=True))
            options = spec.options.model_dump(exclude_none=True) if spec.options else None
            return ctx.respond(spec.data, options)
        raise RuntimeError("unreachable handler kind")

    return handler


def _input_schema(scenario: Scenario) -> dict[str, Any] | None:
    raw = scenario.tool.inputSchema
    if raw is None:
        return None
    properties: dict[str, Any] = {}
    required: list[str] = []
    for key, spec in raw.items():
        if isinstance(spec, Mapping) and spec.get("type") == "string":
            properties[key] = {"type": "string"}
            required.append(key)
            continue
        raise RuntimeError(f"unsupported inputSchema for field {key}")
    schema: dict[str, Any] = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    return schema


async def call_registered_payable(backend: MockBackend, scenario: Scenario) -> dict[str, Any]:
    solvapay = create_solvapay(api_client=backend)
    server: Server[Any] = Server("mcp-authoring-fixtures")
    get_customer_ref = None
    if scenario.customerRefSource == "hook":

        async def _hook(_args: dict[str, object]) -> str:
            return scenario.customerRef

        get_customer_ref = _hook

    register_payable_tool(
        server,
        scenario.tool.name,
        solvapay=solvapay,
        product=scenario.product,
        title=scenario.tool.title,
        description=scenario.tool.description,
        input_schema=_input_schema(scenario),
        handler=_compile_handler(scenario),
        get_customer_ref=get_customer_ref,
    )

    async with Client(server) as client:
        result = await client.call_tool(scenario.tool.name, scenario.tool.args)

    dumped = result.model_dump(by_alias=True, exclude_none=True)
    projected: dict[str, Any] = {"content": dumped["content"]}
    if "structuredContent" in dumped:
        projected["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError") is True:
        projected["isError"] = True
    elif dumped.get("isError") is False and dumped.get("structuredContent") and isinstance(
        dumped.get("structuredContent"), dict
    ) and dumped["structuredContent"].get("kind") in {"payment_required", "activation_required"}:
        projected["isError"] = False
    return projected
