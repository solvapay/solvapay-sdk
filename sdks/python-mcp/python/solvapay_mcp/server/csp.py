from __future__ import annotations

from collections.abc import Mapping
from typing import TypedDict


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


def _parse_origin(url: str | None) -> str | None:
    if not url:
        return None
    try:
        from urllib.parse import urlparse

        parsed = urlparse(url)
        if not parsed.scheme or not parsed.netloc:
            return None
        return f"{parsed.scheme}://{parsed.netloc}"
    except ValueError:
        return None


def merge_csp(
    overrides: Mapping[str, list[str]] | None = None,
    api_base_url: str | None = None,
) -> dict[str, list[str]]:
    api_origin = _parse_origin(api_base_url)
    extra_resource = [api_origin] if api_origin else None
    extra_connect = [api_origin] if api_origin else None

    def merge(base: list[str], *extras: list[str] | None) -> list[str]:
        combined: list[str] = []
        for extra in extras:
            if extra:
                combined.extend(extra)
        if not combined:
            return list(base)
        seen: list[str] = []
        for item in [*base, *combined]:
            if item not in seen:
                seen.append(item)
        return seen

    return {
        "resourceDomains": merge(
            SOLVAPAY_DEFAULT_CSP["resourceDomains"],
            overrides.get("resourceDomains") if overrides else None,
            extra_resource,
        ),
        "connectDomains": merge(
            SOLVAPAY_DEFAULT_CSP["connectDomains"],
            overrides.get("connectDomains") if overrides else None,
            extra_connect,
        ),
        "frameDomains": merge(
            SOLVAPAY_DEFAULT_CSP["frameDomains"],
            overrides.get("frameDomains") if overrides else None,
        ),
    }
