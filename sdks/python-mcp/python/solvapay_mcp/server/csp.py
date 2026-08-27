from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict

from solvapay_mcp.core import call


class SolvaPayMcpCsp(TypedDict, total=False):
    resourceDomains: list[str]
    connectDomains: list[str]
    frameDomains: list[str]


SOLVAPAY_DEFAULT_CSP: dict[str, list[str]] = {
    "resourceDomains": [
        "https://js.stripe.com",
        "https://*.stripe.com",
        "https://b.stripecdn.com",
    ],
    "connectDomains": [
        "https://api.stripe.com",
        "https://m.stripe.com",
        "https://r.stripe.com",
        "https://q.stripe.com",
        "https://errors.stripe.com",
    ],
    "frameDomains": ["https://js.stripe.com", "https://hooks.stripe.com"],
}


def merge_csp(
    overrides: Mapping[str, list[str]] | None = None,
    api_base_url: str | None = None,
) -> dict[str, list[str]]:
    payload: dict[str, object] = {}
    if overrides:
        payload["overrides"] = dict(overrides)
    if api_base_url:
        payload["apiBaseUrl"] = api_base_url
    value = call("mcpMergeCsp", payload)
    if not isinstance(value, dict):
        raise TypeError("mcpMergeCsp did not return an object")
    return {
        "resourceDomains": list(value["resourceDomains"]),
        "connectDomains": list(value["connectDomains"]),
        "frameDomains": list(value["frameDomains"]),
    }
