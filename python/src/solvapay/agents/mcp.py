"""An MCP server paid by SolvaPay agents, ported from ``@solvapay/agents/mcp``.

Install with ``pip install 'solvapay[agents,mcp]'``. Requests on the MCP path
whose bearer token is an agent key, or a token SolvaPay's agent issuer signed,
are verified and served by an MCP server built for that agent. Each paid tool
call is authorized before it runs and completed at the cost it reports. Every
other request is the merchant's: the route answers ``None`` and the merchant's
own app handles it.

```python
from pydantic import BaseModel
from solvapay.agents import Money
from solvapay.agents.mcp import PaidTool, PaidToolRun, create_agent_mcp_route

class Question(BaseModel):
    question: str

async def answer(args: Question, call) -> PaidToolRun:
    reply = await upstream(args.question)
    return PaidToolRun(status=200, cost=(reply.cost, "USD"), result=text_result(reply.text))

route = create_agent_mcp_route(
    issuer="https://api.solvapay.com/v1/agent",
    agent_layer=layer,
    calls=calls,
    mcp_path="/mcp",
    server_name="research",
    tools=lambda server, paid, _call: paid(PaidTool(
        name="answer", description="Answers a question.", input=Question,
        item=lambda _a: "answer-v1",
        estimate=lambda _a: Money("0.01", "USD"),
        prompt=lambda a: a.question,
        run=answer,
    )),
)
app = route.middleware(merchant_app)   # or: response = await route(request)
```

A refusal is a tool error (``isError: true``) whose text is the sentence for the
agent's human, and whose ``structuredContent.refusal.reason`` says which refusal
it was, so an agent can act on it without parsing the text.
"""

from __future__ import annotations

import inspect
import json
import logging
import re
import uuid
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from decimal import Decimal
from typing import Annotated, Any, Generic, TypeVar

import anyio
import jwt
from mcp.server.mcpserver import MCPServer
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import CallToolResult, TextContent, ToolAnnotations
from pydantic import BaseModel, Field
from starlette.requests import Request
from starlette.responses import JSONResponse, Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from ..errors import SolvaPayError
from .calls import AgentCall, AgentCalls, CallResult, Money, Refused, prompt_facts
from .identity import (
    AgentLayer,
    AgentRejected,
    NotAgent,
    RejectionReason,
    VerifiedAgent,
    is_agent_key,
)
from .oauth import (
    canonical_resource,
    challenge_header,
    protected_resource_metadata,
    protected_resource_metadata_path,
    protected_resource_metadata_url,
)

logger = logging.getLogger("solvapay.agents")

ArgsT = TypeVar("ArgsT", bound=BaseModel)

UNREACHABLE = "The service behind this tool could not be reached. Nothing was charged."


@dataclass(frozen=True)
class AgentRequest:
    """The agent a request was verified as, and the token it presented."""

    request: Request
    agent: VerifiedAgent
    agent_token: str
    """As presented; SolvaPay verifies it again on every authorize."""


@dataclass(frozen=True)
class PaidCall:
    """What a paid tool's ``run`` gets besides its arguments."""

    call_ref: str
    request_id: str
    agent: VerifiedAgent


@dataclass(frozen=True)
class PaidToolRun:
    """How a paid tool's upstream call went."""

    status: int
    """The status the upstream answered with; 400 and above charges nothing."""
    cost: tuple[float | Decimal | str, str] | None
    """What the upstream reported it cost, ``(amount, currency)``, or None."""
    result: CallToolResult
    """What the agent gets back."""
    interrupted: str | None = None
    """Set when the answer broke before it finished."""


@dataclass(frozen=True)
class PaidTool(Generic[ArgsT]):
    name: str
    description: str
    input: type[ArgsT]
    """The tool's arguments as a pydantic model; MCP validates calls against it."""
    item: Callable[[ArgsT], str]
    """The merchant's label for what the call buys (a model id, a tool name)."""
    estimate: Callable[[ArgsT], Money]
    """What the call may cost, in the merchant's currency."""
    run: Callable[[ArgsT, PaidCall], Awaitable[PaidToolRun]]
    """Calls the upstream. Raising means it was never reached: released, nothing charged."""
    title: str | None = None
    annotations: ToolAnnotations | None = None
    prompt: Callable[[ArgsT], str | None] | None = None
    """The text whose fingerprint shows repeats (loops); its end goes only when allowed."""
    unreachable_message: str | None = None
    """What the agent reads when ``run`` raises; says nothing was charged."""


@dataclass(frozen=True)
class ProtectedResource:
    """Turns OAuth sign-in on for hosts such as Claude and ChatGPT."""

    resource: str
    """Canonical MCP URL, with its path. Becomes ``resource`` and the expected ``aud``."""
    authorization_server: str | None = None
    """Defaults to the agent issuer."""
    documentation: str | None = None
    metadata_path: str | None = None
    """Default: ``/.well-known/oauth-protected-resource`` + the resource path."""


Paid = Callable[[PaidTool[Any]], None]
RegisterTools = Callable[[MCPServer, Paid, "AgentRequest | None"], None]


# ---- tool registration ------------------------------------------------------


def _tool_function(
    tool: PaidTool[Any], body: Callable[[Any], Awaitable[CallToolResult]]
) -> Callable[..., Awaitable[CallToolResult]]:
    """A function whose signature is ``tool.input``'s fields, for MCPServer's schema."""
    params = []
    for name, field in tool.input.model_fields.items():
        annotation: Any = field.annotation
        if field.description:
            annotation = Annotated[annotation, Field(description=field.description)]
        params.append(
            inspect.Parameter(
                name,
                inspect.Parameter.KEYWORD_ONLY,
                annotation=annotation,
                default=inspect.Parameter.empty if field.is_required() else field.default,
            )
        )

    async def call(**kwargs: Any) -> CallToolResult:
        return await body(tool.input.model_validate(kwargs))

    call.__signature__ = inspect.Signature(params, return_annotation=CallToolResult)  # type: ignore[attr-defined]
    call.__annotations__ = {p.name: p.annotation for p in params} | {"return": CallToolResult}
    call.__name__ = tool.name
    return call


def _add(server: MCPServer, tool: PaidTool[Any], fn: Callable[..., Any]) -> None:
    """Without a title the name stands in; without annotations it is neither read-only nor
    destructive (a paid call is never read-only in the money sense)."""
    server.add_tool(
        fn,
        name=tool.name,
        title=tool.title or tool.name,
        description=tool.description,
        annotations=tool.annotations
        or ToolAnnotations(read_only_hint=False, destructive_hint=False),
        structured_output=False,
    )


def register_paid_tool(
    server: MCPServer, *, calls: AgentCalls, call: AgentRequest, tool: PaidTool[Any]
) -> None:
    """Registers one paid tool: authorize, run, complete; a refusal becomes a tool error."""

    async def body(args: Any) -> CallToolResult:
        request_id = str(uuid.uuid4())
        text = tool.prompt(args) if tool.prompt else None
        begun = await calls.begin(
            AgentCall(
                request_id=request_id,
                agent_token=call.agent_token,
                agent=call.agent,
                item=tool.item(args),
                estimate=tool.estimate(args),
                prompt=None if text is None else prompt_facts(text),
                log_fields={"tool": tool.name},
            )
        )
        if isinstance(begun, Refused):
            return CallToolResult(
                is_error=True,
                content=[TextContent(type="text", text=begun.message)],
                structured_content={"refusal": {"reason": begun.reason, "message": begun.message}},
            )

        try:
            run = await tool.run(
                args, PaidCall(call_ref=begun.call_ref, request_id=request_id, agent=call.agent)
            )
        except Exception as error:
            await begun.release("upstream_unreachable")
            logger.error(
                "call.upstream_failed %s",
                {"requestId": request_id, "tool": tool.name, "callRef": begun.call_ref,
                 "error": str(error)},
            )  # fmt: skip
            return CallToolResult(
                is_error=True,
                content=[TextContent(type="text", text=tool.unreachable_message or UNREACHABLE)],
            )

        completed = await begun.finish(
            CallResult(status=run.status, cost=run.cost, interrupted=run.interrupted)
        )
        logger.info(
            "call.completed %s",
            {
                "requestId": request_id,
                "tool": tool.name,
                "agentRef": call.agent.agent_ref,
                "userRef": call.agent.principal_ref,
                "callRef": begun.call_ref,
                "item": begun.item,
                "estimate": f"{begun.estimate.amount} {begun.estimate.currency}",
                "status": run.status,
                "cost": run.cost,
                # None when SolvaPay could not be told; the SDK logged why.
                "completed": None
                if completed is None
                else {"source": completed.source, "amount": completed.amount.model_dump()},
            },
        )
        return run.result

    _add(server, tool, _tool_function(tool, body))


def _list_paid_tool(server: MCPServer, tool: PaidTool[Any], names: set[str]) -> None:
    """Lists a paid tool for a host that has not signed in; the route never lets it run."""
    names.add(tool.name)

    async def body(_args: Any) -> CallToolResult:
        raise SolvaPayError(
            f"Paid tool {tool.name} reached without an agent: the route should have challenged",
            code="agent_route_misconfigured",
        )

    _add(server, tool, _tool_function(tool, body))


# ---- serving ----------------------------------------------------------------


async def _serve(server: MCPServer, request: Request, body: bytes) -> Response:
    """Answers one MCP request (JSON, stateless) from ``server``, built for this request."""
    if request.method != "POST":
        # Stateless and JSON-only: no event stream to open (GET), no session to end
        # (DELETE). The transport would otherwise hold a GET open forever.
        return JSONResponse(
            {
                "jsonrpc": "2.0",
                "id": None,
                "error": {"code": -32000, "message": "Method not allowed."},
            },
            status_code=405,
        )
    server.streamable_http_app(
        json_response=True,
        stateless_http=True,
        # The merchant's app owns host checks; this server is reached only through it.
        transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False),
    )
    manager = server.session_manager
    sent_body = False
    done = anyio.Event()
    status = 500
    headers: list[tuple[bytes, bytes]] = []
    chunks: list[bytes] = []

    async def receive() -> Message:
        nonlocal sent_body
        if not sent_body:
            sent_body = True
            return {"type": "http.request", "body": body, "more_body": False}
        await done.wait()
        return {"type": "http.disconnect"}

    async def send(message: Message) -> None:
        nonlocal status, headers
        if message["type"] == "http.response.start":
            status = message["status"]
            headers = list(message.get("headers", []))
        elif message["type"] == "http.response.body":
            chunks.append(message.get("body", b""))
            if not message.get("more_body", False):
                done.set()

    async with manager.run():
        await manager.handle_request(request.scope, receive, send)
    done.set()
    response = Response(content=b"".join(chunks), status_code=status)
    response.raw_headers = headers
    return response


def _json_body(body: bytes) -> Any:
    try:
        return json.loads(body)
    except ValueError:
        return None


def _tool_calls(method: str, body: bytes) -> list[tuple[Any, str]]:
    """The ``tools/call`` requests in a JSON-RPC body (one, or a batch): ``(id, name)``."""
    if method != "POST":
        return []
    parsed = _json_body(body)
    messages = parsed if isinstance(parsed, list) else [parsed]
    out = []
    for message in messages:
        if not isinstance(message, dict) or message.get("method") != "tools/call":
            continue
        params = message.get("params")
        name = params.get("name") if isinstance(params, dict) else None
        if isinstance(name, str):
            out.append((message.get("id"), name))
    return out


def _json_rpc_id(body: bytes) -> Any:
    parsed = _json_body(body)
    return parsed.get("id") if isinstance(parsed, dict) else None


def _agent_bearer(request: Request, issuer: str) -> str | None:
    """The bearer, when it is an agent key or SolvaPay's agent issuer signed it (read
    unverified, only to route)."""
    match = re.match(r"^Bearer\s+(\S+)$", request.headers.get("authorization", ""), re.I)
    if not match:
        return None
    token = match.group(1)
    if is_agent_key(token):
        return token
    try:
        claims = jwt.decode(token, options={"verify_signature": False})
    except jwt.PyJWTError:
        return None  # Not a JWT at all: the merchant's own handler answers it.
    return token if claims.get("iss") == issuer else None


def _metadata_path(resource: ProtectedResource) -> str:
    return protected_resource_metadata_path(resource.resource, resource.metadata_path)


def auth_challenge(resource: ProtectedResource, description: str, json_rpc_id: Any) -> Response:
    """A 401 JSON-RPC error with the challenge: the host signs the owner in and retries."""
    metadata_url = protected_resource_metadata_url(resource.resource, resource.metadata_path)
    return JSONResponse(
        {"jsonrpc": "2.0", "id": json_rpc_id, "error": {"code": -32001, "message": description}},
        status_code=401,
        headers={
            "WWW-Authenticate": challenge_header(
                resource=resource.resource, description=description, metadata_url=metadata_url
            ),
            "Access-Control-Expose-Headers": "WWW-Authenticate",
        },
    )


def _agent_token_rejected(reason: RejectionReason) -> Response:
    """401 for a token that did not verify; 403 for the other environment, as SolvaPay."""
    return JSONResponse(
        {
            "jsonrpc": "2.0",
            "id": None,
            "error": {"code": -32001, "message": f"The agent token was not accepted ({reason})."},
        },
        status_code=403 if reason == "environment_mismatch" else 401,
        headers={"WWW-Authenticate": f'Bearer error="invalid_token", error_description="{reason}"'},
    )


class AgentMcpRoute:
    """``await route(request)``: a response for an agent's request, else None.
    ``route.middleware(app)`` puts it in front of the merchant's ASGI app."""

    def __init__(
        self,
        *,
        issuer: str,
        agent_layer: AgentLayer,
        calls: AgentCalls,
        mcp_path: str,
        server_name: str,
        tools: RegisterTools,
        server_version: str = "0.1.0",
        protected_resource: ProtectedResource | None = None,
        lazy_auth: bool = True,
        free_tools: Callable[[MCPServer], None] | None = None,
    ) -> None:
        self.issuer = issuer
        self.agent_layer = agent_layer
        self.calls = calls
        self.mcp_path = mcp_path
        self.server_name = server_name
        self.server_version = server_version
        self.tools = tools
        self.lazy_auth = lazy_auth
        self.free_tools = free_tools
        self.resource: ProtectedResource | None = None
        self.metadata_paths: set[str] = set()
        if protected_resource is not None:
            self.resource = ProtectedResource(
                resource=canonical_resource(protected_resource.resource),
                authorization_server=protected_resource.authorization_server or issuer,
                documentation=protected_resource.documentation,
                metadata_path=protected_resource.metadata_path,
            )
            self.metadata_paths = {
                _metadata_path(self.resource),
                f"{mcp_path}/.well-known/oauth-protected-resource",
            }

    def _server(self) -> MCPServer:
        server = MCPServer(name=self.server_name, version=self.server_version)
        if self.free_tools:
            self.free_tools(server)
        return server

    async def __call__(self, request: Request) -> Response | None:
        path = request.url.path
        resource = self.resource
        if resource and request.method == "GET" and path in self.metadata_paths:
            return JSONResponse(
                protected_resource_metadata(
                    resource=resource.resource,
                    authorization_server=resource.authorization_server or self.issuer,
                    server_name=self.server_name,
                    documentation=resource.documentation,
                ),
                headers={
                    "Cache-Control": "public, max-age=300",
                    "Access-Control-Allow-Origin": "*",
                },
            )
        if path != self.mcp_path:
            return None
        body = await request.body()
        token = _agent_bearer(request, self.issuer)
        if token is None:
            return await self._anonymous(resource, request, body) if resource else None

        identity = await self.agent_layer.identify(token)
        if isinstance(identity, AgentRejected):
            logger.info(
                "call.rejected %s",
                {"reason": f"agent_token_{identity.reason}", "detail": identity.detail},
            )
            # The other environment is not fixed by signing in again here.
            if resource and identity.reason != "environment_mismatch":
                description = (
                    "The sign-in has expired: sign in again"
                    if identity.reason == "expired"
                    else "The agent token was not accepted: sign in again"
                )
                return auth_challenge(resource, description, _json_rpc_id(body))
            return _agent_token_rejected(identity.reason)
        if isinstance(identity, NotAgent):
            raise SolvaPayError(
                "An agent key reached the agent route, but its agent layer has no verify_key"
                if is_agent_key(token)
                else "A token from the agent issuer was not read as one",
                code="agent_route_misconfigured",
            )
        call = AgentRequest(request=request, agent=identity, agent_token=token)
        server = self._server()
        self.tools(
            server,
            lambda tool: register_paid_tool(server, calls=self.calls, call=call, tool=tool),
            call,
        )
        return await _serve(server, request, body)

    async def _anonymous(
        self, resource: ProtectedResource, request: Request, body: bytes
    ) -> Response | None:
        """No agent token while OAuth is on. A bearer that is not ours is the merchant's own
        auth: its handler answers unless it is a paid call. With no bearer at all the route
        answers itself, from a server that lists every tool and runs only the free ones."""
        paid_names: set[str] = set()
        server = self._server()
        self.tools(server, lambda tool: _list_paid_tool(server, tool, paid_names), None)
        tool_calls = _tool_calls(request.method, body)
        needing = [id_ for id_, name in tool_calls if not self.lazy_auth or name in paid_names]
        if needing:
            # The call that needs sign-in, which in a batch may not be the first.
            return auth_challenge(resource, "Sign in to pay for this tool", needing[0])
        if re.match(r"^Bearer\s", request.headers.get("authorization", ""), re.I):
            return None
        return await _serve(server, request, body)

    def middleware(self, app: ASGIApp) -> ASGIApp:
        """An ASGI app that answers agents' requests and passes the rest to ``app``."""

        async def asgi(scope: Scope, receive: Receive, send: Send) -> None:
            if scope["type"] != "http":
                await app(scope, receive, send)
                return
            request = Request(scope, receive)
            response = await self(request)
            if response is not None:
                await response(scope, receive, send)
                return
            if scope["path"] != self.mcp_path:
                await app(scope, receive, send)
                return
            # The route read the body to look at it; hand the app the same bytes.
            body = await request.body()
            replayed = False

            async def replay() -> Message:
                nonlocal replayed
                if not replayed:
                    replayed = True
                    return {"type": "http.request", "body": body, "more_body": False}
                return await receive()

            await app(scope, replay, send)

        return asgi


def create_agent_mcp_route(
    *,
    issuer: str,
    agent_layer: AgentLayer,
    calls: AgentCalls,
    mcp_path: str,
    server_name: str,
    tools: RegisterTools,
    server_version: str = "0.1.0",
    protected_resource: ProtectedResource | None = None,
    lazy_auth: bool = True,
    free_tools: Callable[[MCPServer], None] | None = None,
) -> AgentMcpRoute:
    """A route for the merchant's app: a response for an agent's request, else None.

    ``tools(server, paid, call)`` registers the merchant's tools, with ``paid`` for the
    paid ones. ``call`` is None only when tools are listed for a host that has not
    signed in yet (``protected_resource`` set); a paid call is then answered with the
    sign-in challenge. ``lazy_auth=False`` challenges every ``tools/call`` without a
    token, while ``initialize`` and ``tools/list`` still answer. ``free_tools``
    registers tools anyone may call, signed in or not.
    """
    return AgentMcpRoute(
        issuer=issuer,
        agent_layer=agent_layer,
        calls=calls,
        mcp_path=mcp_path,
        server_name=server_name,
        tools=tools,
        server_version=server_version,
        protected_resource=protected_resource,
        lazy_auth=lazy_auth,
        free_tools=free_tools,
    )


__all__ = [
    "AgentMcpRoute",
    "AgentRequest",
    "PaidCall",
    "PaidTool",
    "PaidToolRun",
    "ProtectedResource",
    "auth_challenge",
    "create_agent_mcp_route",
    "register_paid_tool",
]
