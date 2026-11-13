"""Mappings for the ``agent-identity`` suite: ``solvapay.agents`` identity, OAuth
helpers and prompt facts.

Kept apart from ``test_conformance.py`` so the other agent suites can add their
mappings without touching these. Operations: ``verifyAgentTokens``,
``promptFacts``, ``oauthResources``. Scenario steps: ``verifyAgentKey``,
``identify``.
"""

from __future__ import annotations

import json
import re
import weakref
from collections.abc import Callable
from datetime import datetime
from typing import Any

import jwt

from solvapay import AsyncApiClient, SolvaPayError
from solvapay.agents import (
    AgentKeyVerifier,
    AgentLayer,
    AgentRejected,
    AgentTokenVerifier,
    NotAgent,
    VerifiedAgent,
    canonical_resource,
    prompt_facts,
    protected_resource_metadata,
)
from solvapay.agents.identity import Identification
from solvapay.agents.mcp import ProtectedResource, auth_challenge
from solvapay.agents.oauth import protected_resource_metadata_path

CONFORMANCE_API = "https://api.conformance.test"

# The SDK's own refusal sentences. Any other detail comes from the JWT library or the
# API's error text, which differ by language and are for people, so it compares as a
# placeholder.
SDK_DETAILS = [
    re.compile(p)
    for p in (
        r"cid is not a string",
        r"sub is not an agent reference",
        r"principal is missing",
        r"scope is not usage",
        r"env is not sandbox or live",
        r"This agent spends in (sandbox|live), and this secret key is for (sandbox|live)",
        r".* cannot be an OAuth resource: no fragment or credentials",
    )
]
NOT_COMPARED = "<not compared>"


def _detail(detail: str) -> str:
    return detail if any(p.fullmatch(detail) for p in SDK_DETAILS) else NOT_COMPARED


def _iso(value: datetime) -> str:
    """As JavaScript's ``toISOString``: milliseconds and ``Z``."""
    return value.isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _agent(agent: VerifiedAgent) -> dict[str, Any]:
    out: dict[str, Any] = {
        "agentRef": agent.agent_ref,
        "principalRef": agent.principal_ref,
        "promptExcerpt": agent.prompt_excerpt,
        "environment": agent.environment,
    }
    if agent.token_id is not None:
        out["tokenId"] = agent.token_id
    if agent.expires_at is not None:
        out["expiresAt"] = _iso(agent.expires_at)
    if agent.client_id is not None:
        out["clientId"] = agent.client_id
    return out


def _token_outcome(result: VerifiedAgent | AgentRejected) -> dict[str, Any]:
    if isinstance(result, VerifiedAgent):
        return {"ok": True, "agent": _agent(result)}
    return {"ok": False, "reason": result.reason, "detail": _detail(result.detail)}


def _identification(result: Identification) -> dict[str, Any]:
    if isinstance(result, VerifiedAgent):
        return {"kind": "agent", "agent": _agent(result)}
    if isinstance(result, NotAgent):
        return {"kind": "not_agent"}
    return {"kind": "rejected", "reason": result.reason, "detail": _detail(result.detail)}


class _CaseJwks(jwt.PyJWKClient):
    """The JWKS endpoint, answering with the case's ``jwks``."""

    def __init__(self, jwks: dict[str, Any]) -> None:
        super().__init__(f"{CONFORMANCE_API}/v1/agent/jwks.json")
        self._case_jwks = jwks

    def fetch_data(self) -> Any:
        return self._case_jwks


def _token_verifier(args: dict[str, Any], now: Callable[[], float]) -> AgentTokenVerifier:
    return AgentTokenVerifier(
        issuer=args["issuer"],
        provider_ref=args["providerRef"],
        resource=args.get("resource"),
        environment=args.get("environment"),
        jwks=_CaseJwks(args["jwks"]),
        clock=now,
    )


def verify_agent_tokens(args: dict[str, Any], clock: datetime | None) -> dict[str, Any]:
    assert clock is not None, "verifyAgentTokens needs input.clock"
    verifier = _token_verifier(args, clock.timestamp)
    return {label: _token_outcome(verifier.verify(t)) for label, t in args["tokens"].items()}


def prompt_facts_of(args: dict[str, Any], _clock: datetime | None) -> dict[str, Any]:
    """Each prompt's text is its parts joined, each repeated ``repeat`` times (default 1)."""
    out = {}
    for label, prompt in args["prompts"].items():
        text = "".join(part["text"] * part.get("repeat", 1) for part in prompt["parts"])
        # TypeScript's default when ``toolError`` is left out is false, as Python's.
        facts = (
            prompt_facts(text, prompt["toolError"]) if "toolError" in prompt else prompt_facts(text)
        )
        out[label] = {
            "promptHash": facts.prompt_hash,
            "toolError": facts.tool_error,
            "excerpt": facts.excerpt,
        }
    return out


def oauth_resources(args: dict[str, Any], _clock: datetime | None) -> dict[str, Any]:
    out: dict[str, Any] = {}
    for label, given in args["resources"].items():
        try:
            canonical = canonical_resource(given["resource"])
        except ValueError as error:
            out[label] = {"refused": _detail(str(error))}
            continue
        resource = ProtectedResource(
            resource=given["resource"],
            authorization_server=given["authorizationServer"],
            documentation=given.get("documentation"),
            metadata_path=given.get("metadataPath"),
        )
        response = auth_challenge(resource, given["description"], given.get("jsonRpcId"))
        out[label] = {
            "canonical": canonical,
            "metadata": protected_resource_metadata(
                resource=given["resource"],
                authorization_server=given["authorizationServer"],
                server_name=given.get("serverName"),
                documentation=given.get("documentation"),
            ),
            "metadataPath": protected_resource_metadata_path(
                given["resource"], given.get("metadataPath")
            ),
            "challenge": {
                "status": response.status_code,
                "headers": {
                    "www-authenticate": response.headers["www-authenticate"],
                    "access-control-expose-headers": response.headers[
                        "access-control-expose-headers"
                    ],
                    "content-type": response.headers["content-type"],
                },
                "body": json.loads(response.body),
            },
        }
    return out


OPERATIONS: dict[str, Callable[[dict[str, Any], datetime | None], Any]] = {
    "verifyAgentTokens": verify_agent_tokens,
    "promptFacts": prompt_facts_of,
    "oauthResources": oauth_resources,
}


# ---- scenario steps --------------------------------------------------------
#
# One agent key verifier per scenario and merchant environment (``environment``,
# unset by default), so its 30-second cache carries across steps. Its clock and the
# token verifier's are the step's.

_KEY_VERIFIERS: weakref.WeakKeyDictionary[Any, dict[str, AgentKeyVerifier]] = (
    weakref.WeakKeyDictionary()
)


def _key_verifier(session: Any, environment: Any, now: Callable[[], float]) -> AgentKeyVerifier:
    by_environment = _KEY_VERIFIERS.setdefault(session, {})
    key = environment or "unset"
    if key not in by_environment:
        api = AsyncApiClient(
            api_key="sk_sandbox_conformance",
            api_base_url=CONFORMANCE_API,
            max_retries=0,  # TypeScript never retries; see Known divergences
        )
        by_environment[key] = AgentKeyVerifier(api, environment=environment, clock=now)
    return by_environment[key]


def _thrown(error: SolvaPayError) -> dict[str, Any]:
    """An error the verifier raises (SolvaPay failing or misanswering): its HTTP status."""
    return {"thrown": {"status": error.status}}


STEPS = {"verifyAgentKey", "identify"}


async def scenario_step(
    session: Any, fn: str, args: dict[str, Any], now: Callable[[], float]
) -> dict[str, Any]:
    """``now`` reads the step's clock, in seconds."""
    if fn == "verifyAgentKey":
        verifier = _key_verifier(session, args.get("environment"), now)
        try:
            return {"result": _token_outcome(await verifier.verify(args["agentKey"]))}
        except SolvaPayError as error:
            return {"result": _thrown(error)}
    if fn == "identify":
        layer = AgentLayer(
            verify_token=_token_verifier(args, now).verify,
            verify_key=_key_verifier(session, args.get("environment"), now).verify
            if args.get("acceptAgentKeys") is True
            else None,
        )
        try:
            return {"result": _identification(await layer.identify(args["presentedKey"]))}
        except SolvaPayError as error:
            return {"result": _thrown(error)}
    raise AssertionError(f'No Python mapping for scenario step "{fn}"')
