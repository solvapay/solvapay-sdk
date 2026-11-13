"""Suite ``agent-mcp``: the MCP route agents call (``solvapay.agents.mcp``).

The route is driven as a real ASGI app (``route.middleware(merchant)``) over
``httpx.ASGITransport``, one route for the whole case. ``agentMcpRoute`` builds
it from ``args.route``, ``args.tools`` and ``args.freeTools``, sends
``args.requests`` in order, and returns what each one got and every SolvaPay API
call the route made, as ``conformance/runners/typescript/src/agent-mcp-ops.ts``
does. ``agentRefusalStatuses`` maps refusal reasons to HTTP statuses.
"""

from __future__ import annotations

import asyncio
import json
import re
from collections.abc import Callable
from contextlib import ExitStack
from datetime import datetime, timedelta, timezone
from typing import Any
from unittest import mock

import httpx
import jwt
import jwt.api_jwt
import respx
from mcp.server.mcpserver import MCPServer
from mcp.types import CallToolResult, TextContent, ToolAnnotations
from pydantic import BaseModel, Field, create_model
from starlette.responses import PlainTextResponse
from starlette.types import Receive, Scope, Send

import solvapay.agents.calls as calls_module
from solvapay import AsyncApiClient, SolvaPayError
from solvapay.agents import (
    AgentCalls,
    AgentKeyVerifier,
    AgentLayer,
    AgentTokenVerifier,
    Money,
    refusal_status,
)
from solvapay.agents.mcp import (
    PaidCall,
    PaidTool,
    PaidToolRun,
    ProtectedResource,
    create_agent_mcp_route,
)

CONFORMANCE_API = "https://api.conformance.test"
MERCHANT_ORIGIN = "https://merchant-am.test"

UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$")


def without_uuids(value: Any, seen: dict[str, str] | None = None) -> Any:
    """Each request id (a random UUID) becomes ``<uuid-N>``, numbered by first appearance."""
    seen = {} if seen is None else seen
    if isinstance(value, str):
        if not UUID.match(value):
            return value
        return seen.setdefault(value, f"<uuid-{len(seen) + 1}>")
    if isinstance(value, list):
        return [without_uuids(v, seen) for v in value]
    if isinstance(value, dict):
        return {k: without_uuids(v, seen) for k, v in value.items()}
    return value


# ---- the parts of an answer a case compares -----------------------------------

SCHEMA_KEYS = ("type", "description", "minimum", "maximum", "minLength", "maxLength")


def comparable_schema(schema: dict[str, Any], defs: dict[str, Any] | None = None) -> dict[str, Any]:
    defs = schema.get("$defs", defs or {})
    ref = schema.get("$ref")
    if isinstance(ref, str):
        rest = {k: v for k, v in schema.items() if k != "$ref"}
        schema = {**defs[ref.removeprefix("#/$defs/")], **rest}
    branches = [b for b in schema.get("anyOf", []) if b != {"type": "null"}]
    if "anyOf" in schema and len(branches) == 1:
        outer = {k: v for k, v in schema.items() if k != "anyOf"}
        return comparable_schema({**branches[0], **outer}, defs)
    out: dict[str, Any] = {key: schema[key] for key in SCHEMA_KEYS if key in schema}
    if isinstance(schema.get("properties"), dict):
        out["properties"] = {
            name: comparable_schema(value, defs)
            for name, value in sorted(schema["properties"].items())
        }
        out["required"] = sorted(schema.get("required", []))
    return out


def _parsed_json(text: Any) -> Any:
    if not isinstance(text, str) or not re.match(r"[\[{]", text):
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def comparable_message(message: dict[str, Any]) -> dict[str, Any]:
    """One JSON-RPC message from the MCP server, reduced to what a host reads."""
    out: dict[str, Any] = {"id": message.get("id")}
    error = message.get("error")
    if error:
        # Only the route's own errors (-32001) carry a message the SDKs share.
        out["error"] = error if error.get("code") == -32001 else {"code": error.get("code")}
        return out
    result = message.get("result") or {}
    if isinstance(result.get("tools"), list):
        tools = []
        for tool in result["tools"]:
            entry = {k: tool[k] for k in ("name", "title", "description") if k in tool}
            if tool.get("annotations") is not None:
                entry["annotations"] = tool["annotations"]
            entry["inputSchema"] = comparable_schema(tool["inputSchema"])
            tools.append(entry)
        out["result"] = {"tools": sorted(tools, key=lambda tool: tool["name"])}
    elif result.get("serverInfo"):
        info = result["serverInfo"]
        out["result"] = {"serverInfo": {"name": info.get("name"), "version": info.get("version")}}
    elif isinstance(result.get("content"), list):
        content = []
        for block in result["content"]:
            parsed = _parsed_json(block.get("text")) if block.get("type") == "text" else None
            content.append(block if parsed is None else {"type": "text", "json": parsed})
        out["result"] = {"content": content}
        if result.get("structuredContent") is not None:
            out["result"]["structuredContent"] = result["structuredContent"]
        if result.get("isError") is True:
            out["result"]["isError"] = True
    else:
        out["result"] = result
    return out


def _body(text: str, content_type: str) -> Any:
    if text == "":
        return None
    if content_type.startswith("text/event-stream"):
        data = [json.loads(line[5:]) for line in text.split("\n") if line.startswith("data:")]
        return data[0] if len(data) == 1 else data
    return json.loads(text)


ROUTE_HEADERS = (
    "www-authenticate",
    "access-control-expose-headers",
    "access-control-allow-origin",
    "cache-control",
)


def _is_mcp_answer(body: Any) -> bool:
    messages = body if isinstance(body, list) else [body]
    return all(
        isinstance(m, dict)
        and ("result" in m or ("error" in m and m["error"].get("code") != -32001))
        for m in messages
    )


def outcome_of(response: httpx.Response) -> dict[str, Any]:
    """The route's own answers compare whole, with their headers; the MCP server's
    answers compare as JSON-RPC messages reduced to what a host reads."""
    body = _body(response.text, response.headers.get("content-type", ""))
    if _is_mcp_answer(body):
        return {
            "status": response.status_code,
            "mcp": [comparable_message(m) for m in body]
            if isinstance(body, list)
            else comparable_message(body),
        }
    headers = {name: response.headers[name] for name in ROUTE_HEADERS if name in response.headers}
    return {"status": response.status_code, "headers": headers, "body": body}


# ---- the route a case describes -----------------------------------------------


class _StaticJwks:
    """The case's public keys, by ``kid``; an unknown ``kid`` is an invalid token."""

    def __init__(self, jwks: dict[str, Any]) -> None:
        self._keys = jwt.PyJWKSet.from_dict(jwks)

    def get_signing_key_from_jwt(self, token: str) -> jwt.PyJWK:
        kid = jwt.get_unverified_header(token).get("kid")
        for key in self._keys.keys:
            if key.key_id == kid:
                return key
        raise jwt.PyJWKClientError(f"No key with kid {kid}")


class _Clock:
    """The case's clock: PyJWT's ``datetime`` and the calls' wait read it, and waiting for
    the owner moves it on instead of sleeping."""

    def __init__(self, now: datetime) -> None:
        self.now = now

    def seconds(self) -> float:
        return self.now.timestamp()

    async def sleep(self, seconds: float) -> None:
        self.now += timedelta(seconds=seconds)

    def datetime_class(self) -> type[datetime]:
        clock = self

        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
                return clock.now if tz is None else clock.now.astimezone(tz)

        return FixedDatetime


_TYPES: dict[str, type] = {"string": str, "integer": int, "number": float, "boolean": bool}


def _input_model(tool: dict[str, Any]) -> type[BaseModel]:
    fields: dict[str, Any] = {}
    for name, prop in tool["input"].items():
        kind: Any = _TYPES[prop["type"]]
        description = prop.get("description")
        if prop.get("optional"):
            fields[name] = (kind | None, Field(default=None, description=description))
        else:
            fields[name] = (kind, Field(description=description))
    model: type[BaseModel] = create_model(f"Input_{tool['name']}", **fields)
    return model


def _run(tool: dict[str, Any]) -> Callable[[Any, PaidCall], Any]:
    spec = tool["run"]

    async def run(args: BaseModel, call: PaidCall) -> PaidToolRun:
        if "throw" in spec:
            raise RuntimeError(spec["throw"])
        if spec.get("echo"):
            text = json.dumps(
                {
                    "args": args.model_dump(exclude_none=True),
                    "callRef": call.call_ref,
                    "agentRef": call.agent.agent_ref,
                    "principalRef": call.agent.principal_ref,
                }
            )
        else:
            text = spec.get("text", "")
        cost = spec["cost"]
        return PaidToolRun(
            status=spec["status"],
            cost=None if cost is None else (cost["amount"], cost["currency"]),
            interrupted=spec.get("interrupted"),
            result=CallToolResult(content=[TextContent(type="text", text=text)]),
        )

    return run


def _paid_tool(tool: dict[str, Any]) -> PaidTool[Any]:
    prompt_arg = tool.get("prompt")
    estimate = tool["estimate"]
    annotations = tool.get("annotations")
    return PaidTool(
        name=tool["name"],
        title=tool.get("title"),
        description=tool["description"],
        annotations=None if annotations is None else ToolAnnotations(**annotations),
        input=_input_model(tool),
        item=lambda _args: tool["item"],
        estimate=lambda _args: Money(estimate["amount"], estimate["currency"]),
        prompt=None if prompt_arg is None else (lambda args: str(getattr(args, prompt_arg))),
        run=_run(tool),
        unreachable_message=tool.get("unreachableMessage"),
    )


def _answers(text: str) -> Callable[[], str]:
    def free() -> str:
        return text

    return free


def _free_tools(specs: list[dict[str, Any]]) -> Callable[[MCPServer], None] | None:
    if not specs:
        return None

    def register(server: MCPServer) -> None:
        for spec in specs:
            server.add_tool(
                _answers(spec["text"]),
                name=spec["name"],
                description=spec["description"],
                structured_output=False,
            )

    return register


async def _agent_mcp_route(args: dict[str, Any], clock: _Clock) -> dict[str, Any]:
    route_args = args["route"]
    protected = route_args.get("protectedResource")
    environment = route_args.get("environment")
    api = AsyncApiClient(
        api_key="sk_sandbox_conformance",
        api_base_url=CONFORMANCE_API,
        max_retries=0,  # TypeScript never retries; see Known divergences
    )
    layer = AgentLayer(
        verify_token=AgentTokenVerifier(
            issuer=args["issuer"],
            provider_ref=args["providerRef"],
            resource=protected["resource"] if protected else None,
            environment=environment,
            jwks=_StaticJwks(args["jwks"]),  # type: ignore[arg-type]
        ).verify,
        verify_key=None
        if route_args.get("agentKeys") is False
        else AgentKeyVerifier(api, environment=environment).verify,
    )
    tools = [_paid_tool(tool) for tool in args.get("tools", [])]

    def register(_server: MCPServer, paid: Callable[[PaidTool[Any]], None], _call: Any) -> None:
        for tool in tools:
            paid(tool)

    route = create_agent_mcp_route(
        issuer=args["issuer"],
        agent_layer=layer,
        calls=AgentCalls(api, max_wait_seconds=route_args["maxWaitSeconds"], clock=clock.seconds),
        mcp_path=route_args["mcpPath"],
        server_name=route_args["serverName"],
        tools=register,
        **(
            {"server_version": route_args["serverVersion"]} if "serverVersion" in route_args else {}
        ),
        protected_resource=None
        if protected is None
        else ProtectedResource(
            resource=protected["resource"],
            authorization_server=protected.get("authorizationServer"),
            documentation=protected.get("documentation"),
            metadata_path=protected.get("metadataPath"),
        ),
        lazy_auth=route_args.get("lazyAuth", True),
        free_tools=_free_tools(args.get("freeTools", [])),
    )

    reached_merchant = False

    async def merchant(scope: Scope, receive: Receive, send: Send) -> None:
        nonlocal reached_merchant
        reached_merchant = True
        await PlainTextResponse("merchant", status_code=418)(scope, receive, send)

    pending = list(args.get("api", []))
    api_calls: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        call: dict[str, Any] = {"method": request.method, "path": request.url.path}
        if request.content:
            call["body"] = json.loads(request.content)
        api_calls.append(call)
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == request.url.path:
                pending.pop(i)
                return httpx.Response(exchange.get("status", 200), json=exchange["body"])
        raise AssertionError(f"Unexpected API call: {request.method} {request.url.path}")

    responses: list[dict[str, Any]] = []
    http = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=route.middleware(merchant)), base_url=MERCHANT_ORIGIN
    )
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
        async with http:
            for spec in args["requests"]:
                headers = {"accept": "application/json, text/event-stream"}
                if "authorization" in spec:
                    headers["authorization"] = spec["authorization"]
                content: str | None = None
                if "rawBody" in spec:
                    content = spec["rawBody"]
                elif "body" in spec:
                    content = json.dumps(spec["body"])
                if content is not None:
                    headers["content-type"] = "application/json"
                reached_merchant = False
                try:
                    response = await http.request(
                        spec.get("method", "POST"), spec["path"], headers=headers, content=content
                    )
                except SolvaPayError:
                    # The route fails loudly (a misconfigured agent layer): no answer at all.
                    responses.append({"thrown": True})
                    continue
                responses.append({"merchant": True} if reached_merchant else outcome_of(response))
    await api.aclose()
    assert not pending, "API calls not made: " + ", ".join(
        f"{e['method']} {e['path']}" for e in pending
    )
    return without_uuids({"responses": responses, "apiCalls": api_calls})


def agent_mcp_route(args: dict[str, Any], now: datetime | None) -> Any:
    clock = _Clock(now or datetime.now(tz=timezone.utc))
    with ExitStack() as stack:
        stack.enter_context(mock.patch.object(jwt.api_jwt, "datetime", clock.datetime_class()))
        stack.enter_context(
            mock.patch.object(calls_module, "asyncio", mock.Mock(sleep=clock.sleep))
        )
        return asyncio.run(_agent_mcp_route(args, clock))


AGENT_MCP_OPERATIONS: dict[str, Callable[[dict[str, Any], datetime | None], Any]] = {
    "agentMcpRoute": agent_mcp_route,
    "agentRefusalStatuses": lambda args, _clock: {
        reason: refusal_status(reason) for reason in args["reasons"]
    },
}
