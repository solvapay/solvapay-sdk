"""Who is calling: SolvaPay agent tokens and agent keys.

Agent tokens are ES256 JWTs signed by SolvaPay's agent service, with keys at
``<issuer>/jwks.json``, issued for one merchant (``aud`` is its provider
reference, or this server's resource URL for OAuth tokens). Agent keys
(``agk_…``) are opaque: SolvaPay says whose they are.
"""

from __future__ import annotations

import re
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Literal

import jwt

from ..client import AsyncApiClient
from ..errors import SolvaPayError
from .oauth import canonical_resource

AgentEnvironment = Literal["sandbox", "live"]
AGENT_ENVIRONMENTS: tuple[AgentEnvironment, ...] = ("sandbox", "live")
AGENT_KEY_PREFIX = "agk_"
AGENT_TOKEN_EXCERPT_CLAIM = "px"
AGENT_TOKEN_CLIENT_CLAIM = "cid"
AGENT_TOKEN_ENV_CLAIM = "env"
CLOCK_TOLERANCE_SECONDS = 30
AGENT_KEY_CACHE_SECONDS = 30.0

RejectionReason = Literal["expired", "invalid", "environment_mismatch"]


@dataclass(frozen=True)
class VerifiedAgent:
    agent_ref: str
    """The agent, ``agt_…`` (the token's ``sub``)."""
    principal_ref: str
    """Pairwise reference of the account at this merchant, ``ppl_…``."""
    prompt_excerpt: bool
    """The prompt's end may go to SolvaPay with this agent's calls (``px`` claim)."""
    environment: AgentEnvironment
    token_id: str | None = None
    expires_at: datetime | None = None
    client_id: str | None = None


@dataclass(frozen=True)
class AgentRejected:
    reason: RejectionReason
    detail: str


AgentResult = VerifiedAgent | AgentRejected


def _check_environment(agent: VerifiedAgent, merchant: AgentEnvironment | None) -> AgentResult:
    if merchant is not None and agent.environment != merchant:
        return AgentRejected(
            "environment_mismatch",
            f"This agent spends in {agent.environment}, and this secret key is for {merchant}",
        )
    return agent


class AgentTokenVerifier:
    """Verifies agent tokens against SolvaPay's published keys."""

    def __init__(
        self,
        *,
        issuer: str,
        provider_ref: str,
        resource: str | None = None,
        environment: AgentEnvironment | None = None,
        jwks: jwt.PyJWKClient | None = None,
    ) -> None:
        self.issuer = issuer
        self.audiences = [provider_ref] + ([canonical_resource(resource)] if resource else [])
        self.environment = environment
        self._jwks = jwks or jwt.PyJWKClient(f"{issuer.rstrip('/')}/jwks.json", cache_keys=True)

    def verify(self, token: str) -> AgentResult:
        try:
            key = self._jwks.get_signing_key_from_jwt(token)
            claims: dict[str, Any] = jwt.decode(
                token,
                key.key,
                algorithms=["ES256"],
                audience=self.audiences,
                issuer=self.issuer,
                leeway=CLOCK_TOLERANCE_SECONDS,
                options={"require": ["sub", "exp", "iat", "jti"]},
            )
        except jwt.ExpiredSignatureError as error:
            return AgentRejected("expired", str(error))
        except jwt.PyJWTError as error:
            return AgentRejected("invalid", str(error))

        client_id = claims.get(AGENT_TOKEN_CLIENT_CLAIM)
        if client_id is not None and not isinstance(client_id, str):
            return AgentRejected("invalid", "cid is not a string")
        sub, principal = claims.get("sub"), claims.get("principal")
        if not isinstance(sub, str) or not sub.startswith("agt_"):
            return AgentRejected("invalid", "sub is not an agent reference")
        if not isinstance(principal, str) or not principal.startswith("ppl_"):
            return AgentRejected("invalid", "principal is missing")
        if claims.get("scope") != "usage":
            return AgentRejected("invalid", "scope is not usage")
        env = claims.get(AGENT_TOKEN_ENV_CLAIM)
        if env not in AGENT_ENVIRONMENTS:
            return AgentRejected("invalid", "env is not sandbox or live")
        return _check_environment(
            VerifiedAgent(
                agent_ref=sub,
                principal_ref=principal,
                prompt_excerpt=claims.get(AGENT_TOKEN_EXCERPT_CLAIM) is True,
                environment=env,
                token_id=str(claims["jti"]),
                expires_at=datetime.fromtimestamp(int(claims["exp"]), tz=timezone.utc),
                client_id=client_id,
            ),
            self.environment,
        )


class AgentKeyVerifier:
    """Asks SolvaPay whose an agent key is, reusing each answer for 30 seconds.

    SolvaPay out of reach raises: every paid call would fail the same way.
    """

    def __init__(
        self,
        api: AsyncApiClient,
        *,
        environment: AgentEnvironment | None = None,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.api = api
        self.environment = environment
        self._clock = clock
        self._answers: dict[str, tuple[float, AgentResult]] = {}

    async def verify(self, agent_key: str) -> AgentResult:
        cached = self._answers.get(agent_key)
        if cached and cached[0] > self._clock():
            return cached[1]
        try:
            verified = await self.api.verify_agent_key(body={"agentKey": agent_key})
            result: AgentResult = _check_environment(
                VerifiedAgent(
                    agent_ref=verified.agent_ref,
                    principal_ref=verified.principal_ref,
                    prompt_excerpt=verified.prompt_excerpt,
                    environment=verified.environment,
                ),
                self.environment,
            )
        except SolvaPayError as error:
            if error.status not in (401, 403):
                raise
            mismatch = error.status == 403 and error.code == "environment_mismatch"
            result = AgentRejected("environment_mismatch" if mismatch else "invalid", error.message)
        self._answers[agent_key] = (self._clock() + AGENT_KEY_CACHE_SECONDS, result)
        return result


_JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


def looks_like_jwt(value: str) -> bool:
    return bool(_JWT.match(value))


def is_agent_key(value: str) -> bool:
    return value.startswith(AGENT_KEY_PREFIX) and len(value) > len(AGENT_KEY_PREFIX)


@dataclass(frozen=True)
class NotAgent:
    """The credential is not an agent's: the merchant's own auth decides."""


Identification = VerifiedAgent | AgentRejected | NotAgent


class AgentLayer:
    """Tells an agent's credential from the merchant's own, and verifies it."""

    def __init__(
        self,
        *,
        verify_token: Callable[[str], AgentResult],
        verify_key: Callable[[str], Awaitable[AgentResult]] | None = None,
    ) -> None:
        self._verify_token = verify_token
        self._verify_key = verify_key

    async def identify(self, presented: str) -> Identification:
        if is_agent_key(presented) and self._verify_key is not None:
            return await self._verify_key(presented)
        if not looks_like_jwt(presented):
            return NotAgent()
        return self._verify_token(presented)
