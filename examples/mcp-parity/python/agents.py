"""The agents server in Python. One /mcp serves two kinds of caller:

- An agent presenting a SolvaPay agent token or agent key goes to the agent
  route. Each get_quote call is authorized by SolvaPay first (spend policy,
  budget, balance, and the owner's approval when asked), then completed at the
  cost it reports.
- Everyone else goes to the legacy paywall server behind it, as in paywall.py.

    uv run python agents.py    # http://127.0.0.1:3071/mcp
"""

from __future__ import annotations

import json
import logging

import jwt
import uvicorn
from common import AGENT_COST, AGENT_ESTIMATE, quote, required
from mcp.types import CallToolResult, TextContent
from paywall import build
from pydantic import BaseModel, Field

from solvapay.agents import (
    AgentCalls,
    AgentKeyVerifier,
    AgentLayer,
    AgentTokenVerifier,
    Money,
)
from solvapay.agents.mcp import (
    PaidCall,
    PaidTool,
    PaidToolRun,
    ProtectedResource,
    create_agent_mcp_route,
)
from solvapay.client import AsyncApiClient

PORT = 3071


class Quote(BaseModel):
    symbol: str = Field(min_length=1, max_length=8)


async def run_quote(args: Quote, _call: PaidCall) -> PaidToolRun:
    text = json.dumps(quote(args.symbol), separators=(",", ":"))
    return PaidToolRun(
        status=200,
        cost=AGENT_COST,
        result=CallToolResult(content=[TextContent(type="text", text=text)]),
    )


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    secret_key = required("SOLVAPAY_SECRET_KEY")
    issuer = required("SOLVAPAY_AGENT_ISSUER")
    public_base_url = required("AGENTS_PY_URL")
    agent_oauth = required("AGENT_OAUTH")
    if agent_oauth not in ("on", "off"):
        raise SystemExit("AGENT_OAUTH must be on or off")
    mcp_resource = f"{public_base_url}/mcp"

    # A held authorize waits up to 55 seconds for the owner: the client's timeout allows it.
    api = AsyncApiClient(
        api_key=secret_key, api_base_url=required("SOLVAPAY_API_BASE_URL"), timeout=70
    )
    layer = AgentLayer(
        verify_token=AgentTokenVerifier(
            issuer=issuer,
            provider_ref=required("SOLVAPAY_PROVIDER_REF"),
            # A host that signed in by OAuth holds a token for this resource.
            resource=mcp_resource if agent_oauth == "on" else None,
            jwks=jwt.PyJWKClient(required("SOLVAPAY_AGENT_JWKS_URL"), cache_keys=True),
        ).verify,
        verify_key=AgentKeyVerifier(api).verify,
    )
    route = create_agent_mcp_route(
        issuer=issuer,
        agent_layer=layer,
        calls=AgentCalls(api, max_wait_seconds=int(required("APPROVAL_WAIT_SECONDS"))),
        mcp_path="/mcp",
        server_name="agents-python",
        protected_resource=ProtectedResource(resource=mcp_resource)
        if agent_oauth == "on"
        else None,
        tools=lambda _server, paid, _call: paid(
            PaidTool(
                name="get_quote",
                title="Get quote",
                description=(
                    "A made-up price for a ticker symbol. "
                    f"Up to {AGENT_ESTIMATE[0]} {AGENT_ESTIMATE[1]} per call."
                ),
                input=Quote,
                item=lambda _args: "get_quote",
                estimate=lambda _args: Money(*AGENT_ESTIMATE),
                prompt=lambda args: args.symbol,
                run=run_quote,
            )
        ),
    )
    customers = build(public_base_url, "agents-python").http_app()
    print(
        f"[agents-py] http://127.0.0.1:{PORT}/mcp, public {mcp_resource}, "
        f"agent OAuth {agent_oauth}",
        flush=True,
    )
    uvicorn.run(route.middleware(customers), host="127.0.0.1", port=PORT, log_level="warning")


if __name__ == "__main__":
    main()
