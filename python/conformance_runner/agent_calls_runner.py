"""agent-calls scenarios: an agent's paid call (authorize → upstream → complete).

A scenario whose ``setup`` has ``agentCalls`` runs against ONE ``AgentCalls``
session, so the ``Allowed`` handle ``beginCall`` returns is what later
``finishCall`` / ``releaseCall`` steps act on. Mirrors
``conformance/runners/typescript/src/agent-calls.ts``:

- Time is virtual: each step starts at its ``clock``, and waiting for the owner
  advances it by the ``retryAfterSeconds`` SolvaPay asked for, without sleeping.
  ``clientGoneAfterSeconds`` makes the caller go away that many seconds in.
- The API answers from the step's ``api`` list; every request is compared, with
  its body. Paths are compared as sent (percent-encoded).
- The step's result is ``{ outcome, log }``: what the SDK returned, and every log
  line (event and fields, without ``error``, whose text is for people).
"""

from __future__ import annotations

import json
import logging
import types
from datetime import datetime
from typing import Any

import httpx
import pytest
import respx
from _api_answer import api_response

import solvapay.agents.calls as calls_module
from solvapay import SolvaPayError
from solvapay.agents import (
    AgentCall,
    AgentCalls,
    Allowed,
    CallResult,
    Money,
    VerifiedAgent,
    prompt_facts,
)
from solvapay.client import AsyncApiClient

CONFORMANCE_API = "https://api.conformance.test"


class _Capture(logging.Handler):
    def __init__(self) -> None:
        super().__init__(logging.DEBUG)
        self.lines: list[dict[str, Any]] = []

    def emit(self, record: logging.LogRecord) -> None:
        fields = dict(record.args) if isinstance(record.args, dict) else {}
        fields.pop("error", None)
        self.lines.append({"event": str(record.msg).split(" ")[0], "fields": fields})


def _money(value: Any) -> dict[str, Any]:
    return {"amount": value.amount, "currency": value.currency}


def _begun(begun: Allowed | Any) -> dict[str, Any]:
    if isinstance(begun, Allowed):
        reservation = begun.reservation
        return {
            "kind": "allow",
            "callRef": begun.call_ref,
            "item": begun.item,
            "estimate": _money(begun.estimate),
            "reservation": {
                "held": _money(reservation.held),
                "expiresAt": reservation.expires_at,
            },
        }
    return {"kind": "refused", "reason": begun.reason, "message": begun.message}


def _completed(answer: Any) -> Any:
    if answer is None:
        return None
    return {
        "callRef": answer.call_ref,
        "settled": answer.settled,
        "source": answer.source,
        "amount": _money(answer.amount),
        "duplicate": answer.duplicate,
    }


async def run_agent_calls_scenario(
    data: dict[str, Any], monkeypatch: pytest.MonkeyPatch
) -> list[dict[str, Any]]:
    setup = data["setup"]["agentCalls"]
    now = [0.0]  # seconds
    gone_at: list[float | None] = [None]

    async def sleep(seconds: float) -> None:
        at = gone_at[0]
        if at is not None and at <= now[0] + seconds:
            now[0] = max(now[0], at)
            return
        now[0] += seconds

    monkeypatch.setattr(calls_module, "asyncio", types.SimpleNamespace(sleep=sleep))
    capture = _Capture()
    logger = logging.getLogger("solvapay.agents")
    level = logger.level
    logger.addHandler(capture)
    logger.setLevel(logging.INFO)

    api = AsyncApiClient(
        api_key="sk_sandbox_conformance",
        api_base_url=CONFORMANCE_API,
        max_retries=0,  # TypeScript never retries; see Known divergences
    )
    session = AgentCalls(api, max_wait_seconds=setup["maxWaitSeconds"], clock=lambda: now[0])
    allowed: dict[str, Allowed] = {}
    pending: list[dict[str, Any]] = []
    calls: list[dict[str, Any]] = []

    def answer(request: httpx.Request) -> httpx.Response:
        path = request.url.raw_path.decode("ascii").split("?")[0]
        call: dict[str, Any] = {"method": request.method, "path": path}
        if request.content:
            call["body"] = json.loads(request.content)
        calls.append(call)
        for i, exchange in enumerate(pending):
            if exchange["method"] == request.method and exchange["path"] == path:
                pending.pop(i)
                return api_response(exchange)
        raise AssertionError(f"Unexpected API call: {request.method} {path}")

    async def run_step(fn: str, args: dict[str, Any]) -> Any:
        if fn == "beginCall":
            agent = args["agent"]
            after = args.get("clientGoneAfterSeconds")
            gone_at[0] = None if after is None else now[0] + after
            prompt = args.get("prompt")
            begun = await session.begin(
                AgentCall(
                    request_id=args["requestId"],
                    agent_token=args["agentToken"],
                    agent=VerifiedAgent(
                        agent_ref=agent["agentRef"],
                        principal_ref=agent["principalRef"],
                        prompt_excerpt=agent["promptExcerpt"],
                        environment=agent["environment"],
                    ),
                    item=args["item"],
                    estimate=Money(args["estimate"]["amount"], args["estimate"]["currency"]),
                    prompt=None
                    if prompt is None
                    else prompt_facts(prompt["text"], prompt.get("toolError", False)),
                    cancelled=lambda: gone_at[0] is not None and now[0] >= gone_at[0],
                    log_fields=args.get("logFields", {}),
                )
            )
            if isinstance(begun, Allowed):
                allowed[args["requestId"]] = begun
            return _begun(begun)
        if fn in ("finishCall", "releaseCall"):
            handle = allowed[args["requestId"]]
            try:
                if fn == "releaseCall":
                    await handle.release(args["reason"])
                    return None
                cost = args["cost"]
                return _completed(
                    await handle.finish(
                        CallResult(
                            status=args["status"],
                            cost=None if cost is None else (cost["amount"], cost["currency"]),
                            interrupted=args.get("interrupted"),
                        )
                    )
                )
            except SolvaPayError:
                # Completing a call twice raises; the message is for people.
                return "threw"
        raise AssertionError(f'No Python mapping for agent-calls step "{fn}" in {__file__}')

    outcomes = []
    try:
        with respx.mock(assert_all_mocked=True) as router:
            router.route(host=CONFORMANCE_API.removeprefix("https://")).mock(side_effect=answer)
            for index, step in enumerate(data["steps"]):
                clock = datetime.fromisoformat(step["clock"].replace("Z", "+00:00"))
                now[0] = clock.timestamp()
                pending[:] = list(step.get("api", []))
                calls.clear()
                capture.lines.clear()
                outcome = await run_step(step["fn"], step["args"])
                assert not pending, (
                    f"step {index + 1} ({step['fn']}): API exchanges not used: "
                    + ", ".join(f"{e['method']} {e['path']}" for e in pending)
                )
                outcomes.append(
                    {
                        "result": {"outcome": outcome, "log": list(capture.lines)},
                        "apiCalls": list(calls),
                    }
                )
    finally:
        logger.removeHandler(capture)
        logger.setLevel(level)
        await api.aclose()
    return outcomes
