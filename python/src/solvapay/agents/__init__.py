"""Agent payments: verify an agent, authorize and complete each paid call.

Install with ``pip install 'solvapay[agents]'``. Everything else runs in
SolvaPay: the customer, the spend policy, the hold against budget and balance,
and the owner's approval. Access is gated per merchant by SolvaPay's
``agent_payments`` feature.
"""

from .calls import (
    AUTHORIZE_WAIT_MAX_SECONDS,
    AgentCall,
    AgentCalls,
    Allowed,
    CallResult,
    Money,
    PromptFacts,
    RefusalReason,
    Refused,
    amount_string,
    prompt_facts,
    refusal_status,
)
from .identity import (
    AGENT_KEY_PREFIX,
    AgentKeyVerifier,
    AgentLayer,
    AgentRejected,
    AgentTokenVerifier,
    NotAgent,
    VerifiedAgent,
    is_agent_key,
    looks_like_jwt,
)
from .oauth import (
    AGENT_SCOPE,
    canonical_resource,
    challenge_header,
    protected_resource_metadata,
)

__all__ = [
    "AGENT_KEY_PREFIX",
    "AGENT_SCOPE",
    "AUTHORIZE_WAIT_MAX_SECONDS",
    "AgentCall",
    "AgentCalls",
    "AgentKeyVerifier",
    "AgentLayer",
    "AgentRejected",
    "AgentTokenVerifier",
    "Allowed",
    "CallResult",
    "Money",
    "NotAgent",
    "PromptFacts",
    "RefusalReason",
    "Refused",
    "VerifiedAgent",
    "amount_string",
    "canonical_resource",
    "challenge_header",
    "is_agent_key",
    "looks_like_jwt",
    "prompt_facts",
    "protected_resource_metadata",
    "refusal_status",
]
