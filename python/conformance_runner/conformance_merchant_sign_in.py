"""Suite ``merchant-sign-in``: how a merchant's MCP server signs its customers in and lists
its own paid and free tools.

``merchantMcpHttp`` drives the whole ASGI app (``create_solvapay_mcp_server(...).http_app()``)
over ``httpx.ASGITransport`` with ``requests`` in order; SolvaPay's API answers from ``api``
and every request it gets is recorded with its query, forwarded headers and raw body, as
``conformance/runners/typescript/src/merchant-sign-in.ts`` does.

``merchantTools`` registers the case's merchant tools and reads them as a host does:
``tools/list`` (the merchant's tools only) and ``tools/call`` for each of ``calls``.
"""

from __future__ import annotations

import asyncio
import inspect
import json
from collections.abc import Callable
from datetime import datetime
from typing import Annotated, Any

import httpx
import respx
from mcp.client.client import Client
from mcp.types import Implementation, ToolAnnotations
from pydantic import Field

from solvapay import SolvaPayError, create_solvapay
from solvapay.mcp import ResponseContext, ResponseResult, create_solvapay_mcp_server
from solvapay.paywall.decide import FreeLimit

CONFORMANCE_API = "https://api.conformance.test"
MERCHANT_ORIGIN = "https://mcp-si.conformance.test"
RESOURCE_URI = "ui://conformance/mcp-app.html"

COMPARED_HEADERS = (
    "access-control-allow-origin",
    "access-control-allow-credentials",
    "access-control-allow-methods",
    "access-control-allow-headers",
    "access-control-max-age",
    "access-control-expose-headers",
    "vary",
    "www-authenticate",
    "location",
    "allow",
    "cache-control",
    "pragma",
)


def _compact(value: Any) -> str:
    return json.dumps(value, separators=(",", ":"), ensure_ascii=False)


def _solvapay(product_ref: str) -> Any:
    return create_solvapay(
        api_key="sk_sandbox_conformance",
        max_retries=0,  # TypeScript never retries; see Known divergences
        api_base_url=CONFORMANCE_API,
        product_ref=product_ref,
    )


def _body(text: str, content_type: str) -> Any:
    if text == "":
        return None
    if "json" in content_type:
        try:
            return json.loads(text)
        except ValueError:
            return text
    return text


def _outcome(response: httpx.Response) -> dict[str, Any]:
    headers: dict[str, Any] = {}
    content_type = response.headers.get("content-type")
    if content_type:
        # Only the media type: `charset` spelling is not behaviour.
        headers["content-type"] = content_type.split(";")[0].strip().lower()
    for name in COMPARED_HEADERS:
        if name in response.headers:
            headers[name] = response.headers[name]
    return {
        "status": response.status_code,
        "headers": headers,
        "body": _body(response.text, content_type or ""),
    }


async def _merchant_mcp_http(args: dict[str, Any]) -> dict[str, Any]:
    mcp = create_solvapay_mcp_server(
        solvapay=_solvapay(args["productRef"]),
        public_base_url=args["publicBaseUrl"],
        product_ref=args["productRef"],
        resource_uri=RESOURCE_URI,
        mcp_path=args.get("mcpPath", "/mcp"),
        oauth_paths=args.get("oauthPaths"),
    )
    pending = list(args.get("api", []))
    api_calls: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        forwarded = {
            name: request.headers[name]
            for name in ("content-type", "authorization")
            if name in request.headers
        }
        call: dict[str, Any] = {"method": request.method, "path": request.url.path}
        if request.url.query:
            call["query"] = request.url.query.decode()
        call["headers"] = forwarded
        if request.content:
            call["body"] = request.content.decode()
        api_calls.append(call)
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == request.url.path:
                pending.pop(i)
                if exchange.get("unreachable"):
                    raise httpx.ConnectError("fetch failed", request=request)
                headers = dict(exchange.get("headers", {}))
                if "text" in exchange:
                    content = exchange["text"]
                elif "body" in exchange:
                    content = _compact(exchange["body"])
                    headers.setdefault("content-type", "application/json")
                else:
                    content = ""
                return httpx.Response(
                    exchange.get("status", 200), content=content.encode(), headers=headers
                )
        raise AssertionError(f"Unexpected API call: {request.method} {request.url.path}")

    responses = []
    http = httpx.AsyncClient(
        transport=httpx.ASGITransport(app=mcp.http_app()), base_url=MERCHANT_ORIGIN
    )
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
        async with http:
            for spec in args["requests"]:
                headers = dict(spec.get("headers", {}))
                content: str | None = None
                if "rawBody" in spec:
                    content = spec["rawBody"]
                elif "body" in spec:
                    content = _compact(spec["body"])
                    headers.setdefault("content-type", "application/json")
                response = await http.request(
                    spec.get("method", "GET"), spec["path"], headers=headers, content=content
                )
                responses.append(_outcome(response))
    assert not pending, "API calls not made: " + ", ".join(
        f"{e['method']} {e['path']}" for e in pending
    )
    return {"responses": responses, "apiCalls": api_calls}


# ---- merchantTools ---------------------------------------------------------------

_TYPES: dict[str, type] = {"string": str, "number": float, "boolean": bool}


def _handler(tool: dict[str, Any]) -> Callable[..., Any]:
    """A handler whose signature is the tool's ``input``; it answers what it received."""

    async def handler(**kwargs: Any) -> ResponseResult:
        ctx: ResponseContext = kwargs.pop("ctx")
        return ctx.respond({"received": {k: v for k, v in kwargs.items() if v is not None}})

    params = []
    annotations: dict[str, Any] = {}
    for name, prop in (tool.get("input") or {}).items():
        kind: Any = _TYPES[prop["type"]]
        if prop.get("optional"):
            kind = kind | None
        if prop.get("description"):
            kind = Annotated[kind, Field(description=prop["description"])]
        default = None if prop.get("optional") else inspect.Parameter.empty
        params.append(
            inspect.Parameter(
                name, inspect.Parameter.KEYWORD_ONLY, default=default, annotation=kind
            )
        )
        annotations[name] = kind
    params.append(
        inspect.Parameter("ctx", inspect.Parameter.KEYWORD_ONLY, annotation=ResponseContext)
    )
    annotations["ctx"] = ResponseContext
    handler.__signature__ = inspect.Signature(params)  # type: ignore[attr-defined]
    handler.__annotations__ = {**annotations, "return": ResponseResult}
    handler.__name__ = tool["name"]
    return handler


def _free_limit(spec: dict[str, Any]) -> FreeLimit:
    return FreeLimit(
        cap=spec["cap"],
        scope=spec["scope"],
        **({"meter": spec["meter"]} if "meter" in spec else {}),
        window_days=spec.get("windowDays"),
    )


async def _merchant_tools(args: dict[str, Any]) -> dict[str, Any]:
    hidden = args.get("hideToolsByAudience")
    mcp = create_solvapay_mcp_server(
        solvapay=_solvapay(args["productRef"]),
        public_base_url=MERCHANT_ORIGIN,
        product_ref=args["productRef"],
        resource_uri=RESOURCE_URI,
        hide_tools_by_audience=hidden["audiences"] if hidden else None,
        hide_tools_bypass=(lambda _ctx: hidden.get("bypass") is True) if hidden else None,
    )
    tools = args["tools"]
    try:
        for tool in tools:
            customer = tool.get("customerRef")
            common: dict[str, Any] = {
                "handler": _handler(tool),
                "description": tool.get("description"),
                "title": tool.get("title"),
                "annotations": ToolAnnotations.model_validate(tool["annotations"])
                if "annotations" in tool
                else None,
                "meta": tool.get("meta"),
                "get_customer_ref": lambda _args, _context, customer=customer: customer,
            }
            if tool["kind"] == "free":
                mcp.register_free(tool["name"], limit=_free_limit(tool["freeLimit"]), **common)
            else:
                mcp.register_payable(tool["name"], **common)
    except SolvaPayError:
        # Registration refused the tools (the message is for people).
        return {"refused": True}

    names = {tool["name"] for tool in tools}
    client_info = Implementation(name=args.get("clientName", "conformance"), version="1.0.0")
    from test_conformance import _dump, comparable_schema  # the shared reductions

    async with Client(mcp.server, client_info=client_info) as client:
        listed = [_dump(tool) for tool in (await client.list_tools()).tools]
        results = []
        for call in args.get("calls", []):
            result = _dump(await client.call_tool(call["name"], call.get("arguments", {})))
            results.append(
                {
                    "content": result.get("content"),
                    **(
                        {"structuredContent": result["structuredContent"]}
                        if "structuredContent" in result
                        else {}
                    ),
                    **({"isError": True} if result.get("isError") is True else {}),
                }
            )
    out: dict[str, Any] = {
        "tools": sorted(
            (
                {
                    **{key: tool[key] for key in ("name", "title", "description") if key in tool},
                    **{key: tool[key] for key in ("annotations", "_meta") if key in tool},
                    "inputSchema": comparable_schema(tool["inputSchema"]),
                }
                for tool in listed
                if tool["name"] in names
            ),
            key=lambda tool: tool["name"],
        )
    }
    if results:
        out["calls"] = results
    return out


MERCHANT_SIGN_IN_OPERATIONS: dict[str, Callable[[dict[str, Any], datetime | None], Any]] = {
    "merchantMcpHttp": lambda args, _clock: asyncio.run(_merchant_mcp_http(args)),
    "merchantTools": lambda args, _clock: asyncio.run(_merchant_tools(args)),
}
