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


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool)


def _key_matches(jwk: dict[str, Any], kid: str | None) -> bool:
    """Whether a JWKS member may verify an ES256 token with this ``kid``, by the rules
    TypeScript's ``jose`` applies: a token without a ``kid`` may use any matching key."""
    if jwk.get("kty") != "EC" or jwk.get("crv") != "P-256":
        return False
    if kid is not None and jwk.get("kid") != kid:
        return False
    if isinstance(jwk.get("alg"), str) and jwk["alg"] != "ES256":
        return False
    if isinstance(jwk.get("use"), str) and jwk["use"] != "sig":
        return False
    key_ops = jwk.get("key_ops")
    return not isinstance(key_ops, list) or "verify" in key_ops


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
        clock: Callable[[], float] = time.time,
    ) -> None:
        self.issuer = issuer
        self.audiences = [provider_ref] + ([canonical_resource(resource)] if resource else [])
        self.environment = environment
        self._jwks = jwks or jwt.PyJWKClient(f"{issuer.rstrip('/')}/jwks.json", cache_keys=True)
        self._clock = clock

    def _key(self, kid: str | None) -> Any:
        """The one key that may have signed the token. The set is fetched again once when
        none matches, as after SolvaPay rotates its key; more than one is ambiguous."""
        for refresh in (False, True):
            keys = [
                key.key
                for key in self._jwks.get_jwk_set(refresh=refresh).keys
                if _key_matches(getattr(key, "_jwk_data", {}), kid)
            ]
            if len(keys) > 1:
                raise jwt.PyJWKClientError("More than one key in the JWKS matches the token")
            if keys:
                return keys[0]
        raise jwt.PyJWKClientError("No key in the JWKS matches the token")

    def _claims(self, token: str) -> dict[str, Any]:
        header = jwt.get_unverified_header(token)
        if header.get("alg") != "ES256":
            raise jwt.InvalidAlgorithmError("The token is not signed with ES256")
        kid = header.get("kid")
        claims: dict[str, Any] = jwt.decode(
            token,
            self._key(kid if isinstance(kid, str) else None),
            algorithms=["ES256"],
            audience=self.audiences,
            issuer=self.issuer,
            # The times are checked below, as TypeScript's jose checks them: claims must
            # be numbers, and an iat in the future is not refused.
            options={
                "require": ["sub", "exp", "iat", "jti"],
                "verify_exp": False,
                "verify_nbf": False,
                "verify_iat": False,
                "verify_sub": False,
                "verify_jti": False,
            },
        )
        now = int(self._clock())
        if not _is_number(claims["iat"]):
            raise jwt.InvalidIssuedAtError("iat must be a number")
        nbf = claims.get("nbf")
        if nbf is not None:
            if not _is_number(nbf):
                raise jwt.ImmatureSignatureError("nbf must be a number")
            if nbf > now + CLOCK_TOLERANCE_SECONDS:
                raise jwt.ImmatureSignatureError("The token is not yet valid (nbf)")
        if not _is_number(claims["exp"]):
            raise jwt.DecodeError("exp must be a number")
        if claims["exp"] <= now - CLOCK_TOLERANCE_SECONDS:
            raise jwt.ExpiredSignatureError("Signature has expired")
        return claims

    def verify(self, token: str) -> AgentResult:
        try:
            claims = self._claims(token)
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
                expires_at=datetime.fromtimestamp(claims["exp"], tz=timezone.utc),
                client_id=client_id or None,
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
            # Only a refusal of the key itself is the agent's. SolvaPay failing, or
            # refusing the merchant (agent payments off, a secret key for the other
            # environment), is raised for the merchant to fix.
            reason = agent_refusal(error)
            if reason is None:
                raise
            result = AgentRejected(reason, error.message)
        self._answers[agent_key] = (self._clock() + AGENT_KEY_CACHE_SECONDS, result)
        return result


def agent_refusal(error: SolvaPayError) -> Literal["invalid", "environment_mismatch"] | None:
    """Whose a 401 or 403 from SolvaPay's agent endpoints is, as in TypeScript.

    The agent's: the token or key is unknown, revoked or another merchant's (401,
    or 403 with no code), or from the other environment (403
    ``environment_mismatch``). Any other code, such as ``feature_not_enabled``
    (agent payments are off for this merchant) or ``key_env_mismatch`` (the
    secret key is for the other environment), is the merchant's: ``None``."""
    if error.status == 401:
        return "invalid"
    if error.status != 403:
        return None
    if error.code == "http_403":  # SolvaPay sent no code
        return "invalid"
    if error.code == "environment_mismatch":
        return "environment_mismatch"
    return None


_JWT = re.compile(r"^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$")


def looks_like_jwt(value: str) -> bool:
    return bool(_JWT.fullmatch(value))


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
