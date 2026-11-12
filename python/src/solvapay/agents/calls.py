"""One agent's paid call, start to finish.

SolvaPay decides everything: ``authorize`` before the upstream call finds the
customer, checks the spend policy, holds the estimate against the budget and
the balance, and waits for the owner when they must approve; ``complete``
after it settles at the cost the upstream reported. This module only drives
those two requests and turns their answers into ``Allowed`` or ``Refused``.
"""

from __future__ import annotations

import asyncio
import hashlib
import logging
import math
import time
from collections.abc import Callable
from dataclasses import dataclass, field
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Literal

from ..client import AsyncApiClient
from ..errors import SolvaPayError
from .identity import VerifiedAgent

logger = logging.getLogger("solvapay.agents")

AUTHORIZE_WAIT_MAX_SECONDS = 55
PROMPT_EXCERPT_MAX = 1500

RefusalReason = Literal[
    "customer_not_linked",
    "ask",
    "deny",
    "topup_required",
    "approval_declined",
    "approval_expired",
    "agent_not_accepted",
    "approval_timed_out",
    "approval_client_closed",
    "unavailable",
]

NOT_ACCEPTED = "SolvaPay did not accept this agent (revoked or not for this merchant)."
UNAVAILABLE = "SolvaPay could not be reached to authorize this call. Try again shortly."


@dataclass(frozen=True)
class Money:
    amount: str
    """A decimal amount with up to 8 places."""
    currency: str
    """ISO 4217, such as USD."""


@dataclass(frozen=True)
class PromptFacts:
    prompt_hash: str
    tool_error: bool
    excerpt: str


def prompt_facts(text: str, tool_error: bool = False) -> PromptFacts:
    """A hash of the prompt (repeats show loops), and its end, sent only if the owner opted in."""
    return PromptFacts(
        prompt_hash=f"sha256:{hashlib.sha256(text.encode('utf-8')).hexdigest()}",
        tool_error=tool_error,
        excerpt=text[-PROMPT_EXCERPT_MAX:],
    )


def amount_string(amount: float | Decimal | str) -> str:
    """An amount as a decimal string with up to 8 places, trailing zeros trimmed."""
    fixed = Decimal(str(amount)).quantize(Decimal("0.00000001"), rounding=ROUND_HALF_UP)
    text = f"{fixed:f}".rstrip("0").rstrip(".")
    return text or "0"


@dataclass
class AgentCall:
    request_id: str
    """The merchant's id for the call; SolvaPay keys the call on it."""
    agent_token: str
    """The token as presented: SolvaPay verifies it again."""
    agent: VerifiedAgent
    item: str
    """What is used: a model id, a tool name."""
    estimate: Money
    prompt: PromptFacts | None = None
    cancelled: Callable[[], bool] = lambda: False
    """True once the caller has gone away, to stop waiting for the owner."""
    log_fields: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class Refused:
    reason: RefusalReason
    message: str
    """The sentence for the human, in every case."""


@dataclass(frozen=True)
class CallResult:
    status: int
    """The status the upstream answered with."""
    cost: tuple[float | Decimal | str, str] | None
    """The cost the upstream reported, (amount, currency), or None when none arrived."""
    interrupted: str | None = None


class Allowed:
    """The call may go ahead. Finish it once, when the upstream has answered."""

    def __init__(self, api: AsyncApiClient, call: AgentCall, answer: Any) -> None:
        self._api = api
        self._call = call
        self.call_ref: str = answer.call_ref
        self.reservation = answer.reservation
        self.item = call.item
        self.estimate = call.estimate
        self._completed = False

    async def finish(self, result: CallResult) -> Any:
        """Settles the call at how the upstream answered. ``None`` when SolvaPay could not
        be told: logged, and the reservation lapses at the estimate."""
        body: dict[str, Any] = {
            "status": result.status,
            "cost": None
            if result.cost is None
            else {"amount": amount_string(result.cost[0]), "currency": result.cost[1]},
        }
        if result.interrupted:
            body["interrupted"] = result.interrupted
        return await self._complete(body)

    async def release(self, reason: str) -> None:
        """The call never reached the upstream: completed as a failure, so nothing is charged."""
        await self._complete({"status": 502, "cost": None, "interrupted": reason})

    async def _complete(self, body: dict[str, Any]) -> Any:
        if self._completed:
            raise SolvaPayError(
                f"Call {self.call_ref} was already completed", code="call_completed"
            )
        self._completed = True
        try:
            return await self._api.complete_agent_call(call_ref=self.call_ref, body=body)
        except SolvaPayError as error:
            logger.error(
                "call.complete_failed %s",
                {**_fields(self._call), "callRef": self.call_ref, "status": error.status,
                 "error": error.message},
            )  # fmt: skip
            return None


def _fields(call: AgentCall) -> dict[str, Any]:
    return {
        "requestId": call.request_id,
        **call.log_fields,
        "agentRef": call.agent.agent_ref,
        "userRef": call.agent.principal_ref,
        "item": call.item,
        "estimate": f"{call.estimate.amount} {call.estimate.currency}",
    }


class AgentCalls:
    """Authorizes agent calls with SolvaPay, waiting up to ``max_wait_seconds`` for the owner."""

    def __init__(
        self,
        api: AsyncApiClient,
        *,
        max_wait_seconds: int,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api = api
        self.max_wait_seconds = max_wait_seconds
        self._clock = clock

    def _refuse(
        self, call: AgentCall, reason: RefusalReason, message: str, **fields: Any
    ) -> Refused:
        logger.info("call.refused %s", {**_fields(call), "reason": reason, **fields})
        return Refused(reason, message)

    async def begin(self, call: AgentCall) -> Allowed | Refused:
        deadline = self._clock() + self.max_wait_seconds
        while True:
            wait = max(0, min(AUTHORIZE_WAIT_MAX_SECONDS, math.floor(deadline - self._clock())))
            body: dict[str, Any] = {
                "agentToken": call.agent_token,
                "requestId": call.request_id,
                "item": call.item,
                "estimate": {"amount": call.estimate.amount, "currency": call.estimate.currency},
                "wait": wait,
            }
            if call.prompt:
                body["promptHash"] = call.prompt.prompt_hash
                body["toolError"] = call.prompt.tool_error
                # Only when the token SolvaPay minted says the owner opted in.
                if call.agent.prompt_excerpt:
                    body["promptExcerpt"] = call.prompt.excerpt
            try:
                answer = (await self.api.authorize_agent_call(body=body)).root
            except SolvaPayError as error:
                logger.error(
                    "call.authorize_failed %s",
                    {**_fields(call), "status": error.status, "error": error.message},
                )
                if error.status in (401, 403):
                    return self._refuse(call, "agent_not_accepted", NOT_ACCEPTED)
                return self._refuse(call, "unavailable", UNAVAILABLE)

            if answer.status == "allowed":
                logger.info("call.allowed %s", {**_fields(call), "callRef": answer.call_ref})
                return Allowed(self.api, call, answer)
            if answer.status == "refused":
                return self._refuse(call, answer.reason, answer.message, callRef=answer.call_ref)
            held = {"callRef": answer.call_ref, "approvalRef": answer.approval.reference}
            if self.max_wait_seconds == 0:
                return self._refuse(call, "ask", answer.message, **held)
            if call.cancelled():
                return self._refuse(call, "approval_client_closed", answer.message, **held)
            if self._clock() >= deadline:
                return self._refuse(call, "approval_timed_out", answer.message, **held)
            logger.info("call.waiting %s", {**_fields(call), **held})
            await asyncio.sleep(answer.retry_after_seconds)


def refusal_status(reason: RefusalReason) -> int:
    """The HTTP status for a refusal: 402 for what money or the owner can settle, 422 for a
    policy deny, 401 for an agent SolvaPay did not accept, 502 when it could not be reached."""
    if reason == "agent_not_accepted":
        return 401
    if reason == "unavailable":
        return 502
    if reason == "deny":
        return 422
    return 402
