"""SolvaPay for Python: paywalls, usage billing, webhooks and paid MCP tools."""

from ._generated import models
from .client import ApiClient, AsyncApiClient
from .errors import SolvaPayError
from .paywall import build_paywall_gate
from .paywall.decide import FreeLimit, Paywall, PaywallDecision, PaywallError
from .solvapay import SolvaPay, create_solvapay
from .webhooks import WEBHOOK_ERROR_CODES, WEBHOOK_TOLERANCE_SECONDS, verify_webhook

__all__ = [
    "WEBHOOK_ERROR_CODES",
    "WEBHOOK_TOLERANCE_SECONDS",
    "ApiClient",
    "AsyncApiClient",
    "FreeLimit",
    "Paywall",
    "PaywallDecision",
    "PaywallError",
    "SolvaPay",
    "SolvaPayError",
    "build_paywall_gate",
    "create_solvapay",
    "models",
    "verify_webhook",
]
