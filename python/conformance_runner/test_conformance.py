"""Runs the SDK conformance suite (conformance/cases) against this package.

Every case states what the TypeScript SDK, the reference, does. This runner
feeds the same input to the Python SDK and requires the same outcome. A case
whose ``fn`` has no mapping here fails: nothing is skipped.

Results are compared as canonical JSON text, not as Python objects: in Python
``True == 1`` and ``9000 == 9000.0``, which would hide differences on the wire.
"""

from __future__ import annotations

import asyncio
import contextlib
import json
import re
from collections.abc import Callable, Iterator
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
import pytest
import respx
from _api_answer import api_response
from conformance_agent_mcp import AGENT_MCP_OPERATIONS  # suite agent-mcp
from conformance_merchant_sign_in import MERCHANT_SIGN_IN_OPERATIONS  # suite merchant-sign-in
from mcp.client.client import Client
from mcp.types import CallToolResult, Implementation

import solvapay.paywall.decide as decide_module
from solvapay import SolvaPayError, create_solvapay, pricing
from solvapay.business_details import validate_business_details
from solvapay.mcp import (
    CustomerSnapshot,
    Nudge,
    ResponseContext,
    ResponseResult,
    create_solvapay_mcp_server,
    narrate_activate_plan,
    narrated_tool_result,
)
from solvapay.mcp.intent import parse_mode
from solvapay.paywall import build_nudge_message, build_paywall_gate
from solvapay.paywall.decide import FreeLimit, PaywallError
from solvapay.webhooks import verify_webhook

import _agent_identity  # isort: skip  # the agent-identity suite's mappings, beside this file

CASES_DIR = Path(__file__).resolve().parents[2] / "conformance" / "cases"
LOCK = CASES_DIR.parent / "cases.lock"
PIN = Path(__file__).resolve().parents[1] / "conformance.lock"
NAME = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")

Operation = Callable[[dict[str, Any], "datetime | None"], Any]


def narrate_account(args: dict[str, Any], clock: datetime | None) -> Any:
    result = narrated_tool_result(
        args["view"], args["payload"], parse_mode(args.get("mode")), now=clock
    )
    dumped = result.model_dump(by_alias=True, exclude_none=True, mode="json")
    return {"content": dumped["content"]}


CONFORMANCE_API = "https://api.conformance.test"
CONFORMANCE_PUBLIC_URL = "https://mcp.conformance.test"


def _parsed_json(text: str) -> Any:
    """A text block's JSON, or None when the text is not entirely JSON (``callPaidTool``:
    a narration may follow the data in the same block)."""
    if not re.match(r"[\[{]", text):
        return None
    try:
        return json.loads(text)
    except ValueError:
        return None


def tool_outcome(result: CallToolResult, *, whole_json_only: bool = False) -> dict[str, Any]:
    """The result as the cases compare it: a text block holding JSON compares parsed, as
    ``json``, since key order is not part of what the widget reads."""
    dumped = result.model_dump(by_alias=True, exclude_none=True, mode="json")
    content = []
    for block in dumped["content"]:
        text = block.get("text", "")
        if block.get("type") == "text" and re.match(r"[\[{]", text):
            parsed = _parsed_json(text) if whole_json_only else json.loads(text)
            if parsed is not None:
                block = {"type": "text", "json": parsed}
        content.append(block)
    outcome: dict[str, Any] = {"content": content}
    if "structuredContent" in dumped:
        outcome["structuredContent"] = dumped["structuredContent"]
    if dumped.get("isError"):
        outcome["isError"] = True
    return outcome


# ---- API error messages in tool errors (cases ``transport-tools/errors-*``) ----
#
# A tool error's text that is an API error answer's message compares as
# ``<api message>``: Python writes the API's own message, TypeScript
# ``"<Operation> failed (<status>): <body>"`` (see Known divergences). The status
# and the SDK's own sentences still compare.

API_MESSAGE = "<api message>"


def _api_message(exchange: dict[str, Any]) -> str:
    """The message ``SolvaPayError`` carries for this answer (``_http._error_from_response``)."""
    body = exchange.get("body")
    message = body.get("message") if isinstance(body, dict) else None
    if isinstance(message, list):
        message = "; ".join(str(part) for part in message)
    return str(message or f"The SolvaPay API answered {exchange.get('status', 200)}")


def without_api_messages(outcome: dict[str, Any], api: list[dict[str, Any]]) -> dict[str, Any]:
    if outcome.get("isError") is not True:
        return outcome
    messages = {_api_message(e) for e in api if e.get("status", 200) >= 400}

    def replace(value: Any) -> Any:
        if isinstance(value, str):
            return API_MESSAGE if value in messages else value
        if isinstance(value, list):
            return [replace(v) for v in value]
        if isinstance(value, dict):
            return {k: replace(v) for k, v in value.items()}
        return value

    replaced: dict[str, Any] = replace(outcome)
    return replaced


# ---- end API error messages ----


async def _call_tool(args: dict[str, Any]) -> dict[str, Any]:
    customer = args.get("customerRef")
    mcp = create_solvapay_mcp_server(
        solvapay=create_solvapay(
            api_key="sk_sandbox_conformance",
            max_retries=0,  # TypeScript never retries; see Known divergences
            api_base_url=CONFORMANCE_API,
            product_ref=args["productRef"],
        ),
        public_base_url=CONFORMANCE_PUBLIC_URL,
        get_customer_ref=lambda _args, _context: customer,
        **({"views": args["views"]} if "views" in args else {}),
    )
    # Every exchange must be used, and nothing else may be called. Exchanges on the
    # same method and path answer in the order listed, once each.
    answers: dict[tuple[str, str], list[httpx.Response]] = {}
    for exchange in args.get("api", []):
        answers.setdefault((exchange["method"], exchange["path"]), []).append(
            api_response(exchange)
        )
    with respx.mock(assert_all_called=True, assert_all_mocked=True) as router:
        for (method, path), responses in answers.items():
            router.route(
                method=method,
                scheme="https",
                host=CONFORMANCE_API.removeprefix("https://"),
                path=path,
            ).mock(side_effect=responses)
        result = await mcp.server.call_tool(args["tool"], args.get("arguments", {}))
    assert isinstance(result, CallToolResult)
    return without_api_messages(tool_outcome(result), args.get("api", []))


OPERATIONS: dict[str, Operation] = {
    "callTool": lambda args, _clock: asyncio.run(_call_tool(args)),
    "verifyWebhook": lambda args, clock: verify_webhook(
        body=args["body"], signature=args["signature"], secret=args["secret"], now=clock
    ),
    "buildPaywallGate": lambda args, _clock: build_paywall_gate(args["productRef"], args["limits"]),
    "narrateAccount": narrate_account,
    "narrateActivatePlan": lambda args, _clock: narrate_activate_plan(args["result"]),
}

# ---- paywall nudge copy: ``state`` is the kind the classifier would produce.
OPERATIONS["buildNudgeMessage"] = lambda args, _clock: build_nudge_message(
    args["state"], args["limits"]
)


# ---- solvapay.pricing and solvapay.business_details (suites `pricing`, `business-details`)


def plan_pricing(args: dict[str, Any], _clock: datetime | None) -> dict[str, Any]:
    """Every pricing reader's answer for one plan."""
    plan, balance, meter = args.get("plan"), args.get("balance"), args.get("meter")
    return {
        "charges": pricing.charges(plan),
        "headlineCharges": pricing.headline_charges(plan),
        "perUnitCharge": pricing.per_unit_charge(plan, meter),
        "billingCycle": pricing.billing_cycle(plan),
        "tierBands": pricing.tier_bands(plan, meter),
        "tierMeters": pricing.tier_meters(plan),
        "usageRate": pricing.usage_rate(plan, meter),
        "trialDays": pricing.trial_days(plan),
        "includedUnits": pricing.included_units(plan, meter),
        "meterName": pricing.meter_name(plan),
        "countsUsage": pricing.counts_usage(plan),
        "planPricingShape": pricing.plan_pricing_shape(plan),
        "creditsPerUnitFromBalance": pricing.credits_per_unit_from_balance(plan, balance, meter),
    }


def business_details(args: dict[str, Any], _clock: datetime | None) -> dict[str, Any]:
    """The details to send, or the first problem's message."""
    try:
        return validate_business_details(
            is_business=args["isBusiness"],
            business_name=args.get("businessName"),
            country=args.get("country"),
            customer_country=args.get("customerCountry"),
            customer_name=args.get("customerName"),
            customer_state=args.get("customerState"),
            customer_postal_code=args.get("customerPostalCode"),
            tax_id=args.get("taxId"),
        )
    except SolvaPayError as error:
        assert error.code == "invalid_business_details"
        return {"invalid": error.message}


OPERATIONS["planPricing"] = plan_pricing
OPERATIONS["validateBusinessDetails"] = business_details

# ---- solvapay.agents identity, OAuth helpers, prompt facts (suite `agent-identity`)
OPERATIONS.update(_agent_identity.OPERATIONS)

# ---- describeServer and getPrompt: the whole server, over MCP ----------------
#
# The server is reached the way a host reaches it: an in-memory MCP client that
# initializes as ``clientName``. Input schemas compare in the reduced form the
# README describes, so pydantic's titles, defaults and ``anyOf [X, null]`` for an
# optional argument don't count; everything a host reads does.

RESOURCE_URI = "ui://conformance/mcp-app.html"
SCHEMA_KEYS = (
    "type",
    "const",
    "enum",
    "description",
    "minimum",
    "maximum",
    "exclusiveMinimum",
    "exclusiveMaximum",
    "minLength",
    "maxLength",
)


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


def _server_for(args: dict[str, Any]) -> Any:
    customer = args.get("customerRef")
    return create_solvapay_mcp_server(
        solvapay=create_solvapay(
            api_key="sk_sandbox_conformance",
            max_retries=0,  # TypeScript never retries; see Known divergences
            api_base_url=CONFORMANCE_API,
            product_ref=args["productRef"],
        ),
        public_base_url=args.get("publicBaseUrl", CONFORMANCE_PUBLIC_URL),
        resource_uri=RESOURCE_URI,
        get_customer_ref=lambda _args, _context: customer,
        views=args.get("views"),
        csp=args.get("csp"),
        hide_tools_by_audience=args.get("hideToolsByAudience"),
    )


def _dump(model: Any) -> Any:
    return model.model_dump(by_alias=True, exclude_none=True, mode="json")


async def _describe_server(args: dict[str, Any]) -> dict[str, Any]:
    client_info = Implementation(name=args.get("clientName", "conformance"), version="1.0.0")
    async with Client(_server_for(args).server, client_info=client_info) as client:
        tools = [_dump(tool) for tool in (await client.list_tools()).tools]
        prompts = [_dump(prompt) for prompt in (await client.list_prompts()).prompts]
        resources = [_dump(resource) for resource in (await client.list_resources()).resources]
    keys = ("uri", "name", "title", "description", "mimeType", "_meta")
    return {
        "tools": sorted(
            (
                {
                    **{key: tool[key] for key in ("name", "title", "description") if key in tool},
                    "annotations": tool.get("annotations"),
                    "_meta": tool.get("_meta"),
                    "inputSchema": comparable_schema(tool["inputSchema"]),
                }
                for tool in tools
            ),
            key=lambda tool: tool["name"],
        ),
        "prompts": sorted(
            (
                {
                    **{k: prompt[k] for k in ("name", "title", "description") if k in prompt},
                    "arguments": sorted(
                        (
                            {"name": a["name"], "required": a.get("required") is True}
                            for a in prompt.get("arguments", [])
                        ),
                        key=lambda a: a["name"],
                    ),
                }
                for prompt in prompts
            ),
            key=lambda prompt: prompt["name"],
        ),
        "resources": sorted(
            ({key: r[key] for key in keys if key in r} for r in resources),
            key=lambda r: r["uri"],
        ),
    }


async def _get_prompts(args: dict[str, Any]) -> list[dict[str, Any]]:
    results = []
    async with Client(_server_for(args).server) as client:
        for call in args["calls"]:
            result = await client.get_prompt(call["name"], call.get("arguments", {}))
            results.append({"messages": _dump(result)["messages"]})
    return results


@contextlib.contextmanager
def _api(api: list[dict[str, Any]]) -> Iterator[None]:
    """The API answers from ``api``, each exchange once and in order (one path may answer
    twice); every exchange must be used, and nothing else may be called."""
    pending = list(api)

    def answer(request: httpx.Request) -> httpx.Response:
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == request.url.path:
                pending.pop(i)
                return api_response(exchange)
        raise AssertionError(f"Unexpected API call: {request.method} {request.url.path}")

    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
        yield
    assert not pending, "API calls not made: " + ", ".join(
        f"{e['method']} {e['path']}" for e in pending
    )


def _snapshot(customer: CustomerSnapshot) -> dict[str, Any]:
    # TypeScript's ``balance`` is ``number | undefined``: None is the undefined.
    return {
        "ref": customer.ref,
        **({"balance": customer.balance} if customer.balance is not None else {}),
        "isCreditBased": customer.is_credit_based,
        "remaining": customer.remaining,
        "withinLimits": customer.within_limits,
        "overage": customer.overage,
        "plan": customer.plan,
    }


def _scripted_handler(script: dict[str, Any]) -> Any:
    """The merchant handler a ``callPaidTool`` case scripts (see the README)."""

    async def handler(ctx: ResponseContext) -> ResponseResult:
        for block in script.get("emit", []):
            await ctx.emit(block)
        fresh = await ctx.customer.fresh() if script.get("fresh") is True else None
        if "gate" in script:
            ctx.gate(script["gate"])
        if isinstance(script.get("throw"), str):
            raise RuntimeError(script["throw"])
        respond = script.get("respond", {})
        data = respond.get("data")
        if respond.get("echo") is True:
            data = {
                **(data or {}),
                "customer": _snapshot(ctx.customer),
                **({"freshCustomer": _snapshot(fresh)} if fresh is not None else {}),
                "product": ctx.product,
            }
        nudge = respond.get("nudge")
        return ctx.respond(
            data,
            text=respond.get("text"),
            nudge=Nudge(kind=nudge["kind"], message=nudge.get("message", ""))
            if nudge is not None
            else None,
            data_in_text=respond.get("dataInText", True),
        )

    return handler


async def _call_paid_tool(args: dict[str, Any]) -> dict[str, Any]:
    tool = args["tool"]
    mcp = _server_for(args)
    handler = _scripted_handler(args.get("handler", {}))
    customer = args["customerRef"]

    def get_customer_ref(_args: Any, _context: Any) -> str:
        return customer

    if tool.get("kind") == "free":
        limit = _free_limit(tool)
        assert limit is not None, "a free tool needs freeLimit"
        mcp.register_free(
            tool["name"], handler=handler, limit=limit, get_customer_ref=get_customer_ref
        )
    else:
        mcp.register_payable(tool["name"], handler=handler, get_customer_ref=get_customer_ref)
    with _api(args.get("api", [])):
        async with Client(mcp.server) as client:
            result = await client.call_tool(tool["name"], {})
    return tool_outcome(result, whole_json_only=True)


async def _read_resource(args: dict[str, Any]) -> dict[str, Any]:
    with _api(args.get("api", [])):
        async with Client(_server_for(args).server) as client:
            result = await client.read_resource(args["uri"])
    contents = []
    for content in _dump(result)["contents"]:
        parsed = _parsed_json(content.get("text", "")) if "text" in content else None
        if parsed is not None:
            content = {**{k: v for k, v in content.items() if k != "text"}, "json": parsed}
        contents.append(content)
    return {"contents": contents}


OPERATIONS.update(
    {
        "readResource": lambda args, _clock: asyncio.run(_read_resource(args)),
        "describeServer": lambda args, _clock: asyncio.run(_describe_server(args)),
        "getPrompts": lambda args, _clock: asyncio.run(_get_prompts(args)),
        "callPaidTool": lambda args, _clock: asyncio.run(_call_paid_tool(args)),
    }
)

# ---- suite agent-mcp: the MCP route agents call (conformance_agent_mcp.py) -----
OPERATIONS.update(AGENT_MCP_OPERATIONS)

# ---- suite merchant-sign-in: merchant MCP sign-in and tools (conformance_merchant_sign_in.py)
OPERATIONS.update(MERCHANT_SIGN_IN_OPERATIONS)


# ---- scenarios ---------------------------------------------------------------
#
# A scenario runs several steps against ONE SolvaPay instance, so the state kept
# between calls (the limits cache, the customer mapping) is part of the case.
# The clock is fixed at each step's ``clock``; the API answers from the step's
# ``api`` list; every request is recorded, in order, as ``apiCalls``.

REQUEST_ID = re.compile(r"^(solvapay_\d+_)[a-z0-9]{9}(:.*)?$")


def without_randomness(value: Any) -> Any:
    """The random part of a request id is the only value a case can't fix."""
    if isinstance(value, str):
        match = REQUEST_ID.match(value)
        return f"{match.group(1)}<random>{match.group(2) or ''}" if match else value
    if isinstance(value, list):
        return [without_randomness(v) for v in value]
    if isinstance(value, dict):
        return {k: without_randomness(v) for k, v in value.items()}
    return value


class _Clock:
    """Stands in for the ``time`` module and ``datetime`` class the paywall reads."""

    def __init__(self) -> None:
        self.now = datetime.fromtimestamp(0, tz=timezone.utc)

    def time(self) -> float:
        return self.now.timestamp()

    def monotonic(self) -> float:
        return self.now.timestamp()

    def datetime_class(self) -> type[datetime]:
        clock = self

        class FixedDatetime(datetime):
            @classmethod
            def now(cls, tz: Any = None) -> datetime:  # type: ignore[override]
                return clock.now if tz is None else clock.now.astimezone(tz)

        return FixedDatetime


def _free_limit(args: dict[str, Any]) -> FreeLimit | None:
    raw = args.get("freeLimit")
    if raw is None:
        return None
    return FreeLimit(
        cap=raw["cap"], scope=raw["scope"], meter=raw["meter"], window_days=raw.get("windowDays")
    )


async def _scenario_step(
    solvapay: Any, product: str, fn: str, args: dict[str, Any]
) -> dict[str, Any]:
    if fn == "decide":
        decision = await solvapay.gate(
            customer_ref=args["customerRef"],
            product=product,
            meter=args.get("meter"),
            free_limit=_free_limit(args),
            tool_name=args.get("toolName"),
        )
        result: dict[str, Any] = {"outcome": decision.outcome, "customerRef": decision.customer_ref}
        if decision.consequence is not None:
            result["consequence"] = decision.consequence
        if decision.gate is not None:
            result["gate"] = decision.gate
        return {"result": result}
    if fn == "paidCall":
        mode = args.get("handler")

        async def handler(*, customer_ref: str) -> dict[str, Any]:
            if mode == "fail":
                raise SolvaPayError("the handler failed", code="handler_failed")
            # The handler gates the call itself.
            if mode == "gate":
                raise PaywallError(
                    build_paywall_gate(product, {"withinLimits": False, "remaining": 0})
                )
            return {"ok": True}

        # Python records the handler's name as the tool name.
        handler.__name__ = args["toolName"]
        paid = solvapay.payable(
            product=product, meter=args.get("meter"), free_limit=_free_limit(args)
        )(handler)
        try:
            return {"result": await paid(customer_ref=args["customerRef"])}
        except PaywallError as error:
            return {"gate": error.gate}
    if fn == "decideConcurrently":
        # ``count`` calls for one customer start together, as parallel tool calls do.
        decisions = await asyncio.gather(
            *(
                solvapay.paywall.decide(
                    customer_ref=args["customerRef"], product=product, meter=args.get("meter")
                )
                for _ in range(args["count"])
            )
        )
        return {"result": [decision.outcome for decision in decisions]}
    if fn == "invalidateLimits":
        solvapay.paywall.invalidate_limits(args["customerRef"], args.get("productRef"))
        return {"result": None}
    # ---- customer resolution with details
    if fn == "ensureCustomer":
        ref = await solvapay.paywall.ensure_customer(
            args["customerRef"],
            args.get("externalRef"),
            email=args.get("email"),
            name=args.get("name"),
        )
        return {"result": ref}
    # ---- solvapay.agents identity steps (suite `agent-identity`); the patched clock
    if fn in _agent_identity.STEPS:
        return await _agent_identity.scenario_step(
            solvapay, fn, args, lambda: decide_module.time.time()
        )
    raise AssertionError(f'No Python mapping for scenario step "{fn}" in {__file__}')


async def run_scenario(
    data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> list[dict[str, Any]]:
    clock = _Clock()
    monkeypatch.setattr(decide_module, "time", clock)
    monkeypatch.setattr(decide_module, "datetime", clock.datetime_class())
    setup = data["setup"]
    ttl_ms = setup.get("limitsCacheTtlMs")
    solvapay = create_solvapay(
        api_key="sk_sandbox_conformance",
        max_retries=0,  # TypeScript never retries; see Known divergences
        api_base_url=CONFORMANCE_API,
        **({"limits_cache_ttl": ttl_ms / 1000} if ttl_ms is not None else {}),
    )
    pending: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        call: dict[str, Any] = {"method": request.method, "path": request.url.path}
        if request.url.params:
            call["query"] = dict(request.url.params)
        if request.content:
            call["body"] = json.loads(request.content)
        calls.append(call)
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == request.url.path:
                pending.pop(i)
                return api_response(exchange)
        raise AssertionError(f"Unexpected API call: {request.method} {request.url.path}")

    outcomes = []
    # Each step checks its own exchanges were used; a scenario may make no call at all.
    with respx.mock(assert_all_mocked=True, assert_all_called=False) as router:
        router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
        for index, step in enumerate(data["steps"]):
            clock.now = datetime.fromisoformat(step["clock"].replace("Z", "+00:00"))
            pending[:] = list(step.get("api", []))
            calls.clear()
            try:
                outcome = await _scenario_step(
                    solvapay, setup["productRef"], step["fn"], step["args"]
                )
            except PaywallError:
                raise
            except SolvaPayError as error:
                outcome = {"error": {"code": error.code}}
            assert not pending, (
                f"step {index + 1} ({step['fn']}): API exchanges not used: "
                + ", ".join(f"{e['method']} {e['path']}" for e in pending)
            )
            outcomes.append(without_randomness({**outcome, "apiCalls": list(calls)}))
    await solvapay.aclose()
    return outcomes


def load_cases() -> list[tuple[str, dict[str, Any]]]:
    cases = []
    for suite_dir in sorted(p for p in CASES_DIR.iterdir() if p.is_dir()):
        for file in sorted(suite_dir.iterdir()):
            where = f"{suite_dir.name}/{file.name}"
            if file.suffix != ".json":
                raise AssertionError(f"{where}: only .json files belong in a suite")
            data = json.loads(file.read_text(encoding="utf-8"))
            problems = []
            if data.get("suite") != suite_dir.name:
                problems.append("suite does not match the folder")
            if data.get("case") != file.stem or not NAME.match(file.stem):
                problems.append("case does not match the file name")
            if not str(data.get("description", "")).strip():
                problems.append("description is missing")
            if "steps" in data:
                if any("expect" not in step for step in data["steps"]):
                    problems.append("a step has no expect: record it with the TypeScript runner")
            elif "expect" not in data:
                problems.append("expect is missing: record it with the TypeScript runner")
            if problems:
                raise AssertionError(f"{where}: {'; '.join(problems)}")
            cases.append((where, data))
    if not cases:
        raise AssertionError(f"No conformance cases found in {CASES_DIR}")
    return cases


def canonical(value: Any) -> str:
    return json.dumps(value, sort_keys=True, ensure_ascii=False, allow_nan=False)


def outcome_of(data: dict[str, Any]) -> dict[str, Any]:
    fn = data["input"]["fn"]
    if fn not in OPERATIONS:
        raise AssertionError(f'No Python mapping for fn "{fn}" in {__file__}')
    clock_text = data["input"].get("clock")
    clock = datetime.fromisoformat(clock_text.replace("Z", "+00:00")) if clock_text else None
    try:
        return {"result": OPERATIONS[fn](data["input"]["args"], clock)}
    except SolvaPayError as error:
        return {"error": {"code": error.code}}


CASES = load_cases()


def _fingerprints(path: Path) -> dict[str, str]:
    if not path.is_file():
        raise AssertionError(f"{path} does not exist")
    cases = json.loads(path.read_text(encoding="utf-8"))["cases"]
    assert isinstance(cases, dict)
    return cases


# A case runs when its fingerprint in conformance/cases.lock matches this
# package's pin. A newer or changed case is not adopted yet: it is reported, and
# publishing fails until scripts/pin_conformance.py adopts it.
LOCKED = _fingerprints(LOCK)
PINNED = _fingerprints(PIN)


def test_every_case_is_locked() -> None:
    on_disk = {where for where, _ in CASES}
    missing = sorted(on_disk - LOCKED.keys())
    assert not missing, (
        "conformance/cases.lock has no fingerprint for: "
        + ", ".join(missing)
        + ". Run the TypeScript runner's record."
    )


@pytest.mark.parametrize(("where", "data"), CASES, ids=[where for where, _ in CASES])
def test_case(where: str, data: dict[str, Any], monkeypatch: pytest.MonkeyPatch) -> None:
    if PINNED.get(where) != LOCKED.get(where):
        pytest.skip(
            "not adopted: newer than python/conformance.lock. Make it pass, then run "
            "scripts/pin_conformance.py"
        )
    if "steps" in data:
        # ---- agent-calls (see agent_calls_runner.py) ----
        if "agentCalls" in data["setup"]:
            from agent_calls_runner import run_agent_calls_scenario

            outcomes = asyncio.run(run_agent_calls_scenario(data, monkeypatch))
        else:
            outcomes = asyncio.run(run_scenario(data, monkeypatch))
        for index, (step, actual_step) in enumerate(zip(data["steps"], outcomes, strict=True)):
            assert canonical(actual_step) == canonical(step["expect"]), (
                f"{where} step {index + 1} ({step['fn']}): {data['description']}\n"
                f"expected: {canonical(step['expect'])}\n"
                f"actual:   {canonical(actual_step)}"
            )
        return
    actual = outcome_of(data)
    expected = data["expect"]
    assert canonical(actual) == canonical(expected), (
        f"{where}: {data['description']}\n"
        f"expected: {canonical(expected)}\n"
        f"actual:   {canonical(actual)}"
    )
