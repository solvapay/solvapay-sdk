"""Suite ``web-routes``: the routes ``@solvapay/react`` calls, as ``solvapay.web.routes()``
serves them (TypeScript: ``conformance/runners/typescript/src/web-routes.ts``).

``webRoute`` sends one request to the routes, through ``httpx.ASGITransport``, and
returns what they answer (status, JSON body, ``Allow``) and every request they made
to SolvaPay's API, scripted by ``api``: each exchange is used once, nothing else
may be called.

``user`` is who the merchant's own auth says is calling. TypeScript signs it into a
bearer token its route verifies; here the identity hook answers it. ``user: null``
is a request with no signed-in user.
"""

from __future__ import annotations

import asyncio
import json
from typing import Any
from urllib.parse import urlencode

import httpx
import respx
from _api_answer import api_response
from starlette.requests import Request

from solvapay import create_solvapay
from solvapay.web import User, routes

CONFORMANCE_API = "https://api.conformance.test"
APP_ORIGIN = "https://app.conformance.test"


def _parsed(text: str) -> Any:
    if text == "":
        return None
    try:
        return json.loads(text)
    except ValueError:
        return text


async def _web_route(args: dict[str, Any]) -> dict[str, Any]:
    pending = list(args.get("api", []))
    api_calls: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        call: dict[str, Any] = {"method": request.method, "path": request.url.path}
        if request.url.query:
            call["query"] = request.url.query.decode()
        if request.content:
            call["body"] = json.loads(request.content)
        api_calls.append(call)
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == request.url.path:
                pending.pop(i)
                return api_response(exchange)
        raise AssertionError(f"Unexpected API call: {request.method} {request.url.path}")

    case_user = args.get("user")

    async def get_user(_request: Request) -> User | None:
        if case_user is None:
            return None
        return User(id=case_user["id"], email=case_user.get("email"), name=case_user.get("name"))

    solvapay = create_solvapay(
        api_key="sk_sandbox_conformance",
        api_base_url=CONFORMANCE_API,
        max_retries=0,  # TypeScript never retries; see Known divergences
    )
    app = routes(solvapay, get_user=get_user)

    headers = dict(args.get("headers", {}))
    content: bytes | None = None
    if "body" in args:
        content = json.dumps(args["body"]).encode()
        headers["content-type"] = "application/json"
    query = f"?{urlencode(args['query'])}" if args.get("query") else ""

    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as client:
            response = await client.request(
                args.get("method", "GET"),
                f"{APP_ORIGIN}{args['path']}{query}",
                headers=headers,
                content=content,
            )
    await solvapay.aclose()

    result: dict[str, Any] = {"status": response.status_code, "body": _parsed(response.text)}
    allow = response.headers.get("allow")
    if allow is not None:
        result["allow"] = allow
    assert not pending, "API calls not made: " + ", ".join(
        f"{e['method']} {e['path']}" for e in pending
    )
    result["apiCalls"] = api_calls
    return result


WEB_ROUTE_OPERATIONS = {
    "webRoute": lambda args, _clock: asyncio.run(_web_route(args)),
}
