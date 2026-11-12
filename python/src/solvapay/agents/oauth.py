"""OAuth helpers for a server agents call: its resource URL and the RFC 9728 document."""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit

AGENT_SCOPE = "usage"


def canonical_resource(resource: str) -> str:
    """The form SolvaPay compares resources in: scheme and host lowercased, default
    port dropped, no trailing slash. A fragment or credentials make it unusable."""
    parts = urlsplit(resource)
    if parts.fragment or parts.username or parts.password:
        raise ValueError(f"{resource} cannot be an OAuth resource: no fragment or credentials")
    if not parts.scheme or not parts.hostname:
        raise ValueError(f"{resource} is not an absolute URL")
    scheme = parts.scheme.lower()
    host = parts.hostname.lower()
    default = {"http": 80, "https": 443}.get(scheme)
    port = f":{parts.port}" if parts.port and parts.port != default else ""
    query = f"?{parts.query}" if parts.query else ""
    return f"{scheme}://{host}{port}{parts.path.rstrip('/')}{query}"


def protected_resource_metadata(
    *,
    resource: str,
    authorization_server: str,
    server_name: str | None = None,
    documentation: str | None = None,
) -> dict[str, Any]:
    """The RFC 9728 document naming SolvaPay's agent issuer as the authorization server."""
    out: dict[str, Any] = {
        "resource": canonical_resource(resource),
        "authorization_servers": [authorization_server],
        "scopes_supported": [AGENT_SCOPE],
        "bearer_methods_supported": ["header"],
    }
    if server_name:
        out["resource_name"] = server_name
    if documentation:
        out["resource_documentation"] = documentation
    return out


def challenge_header(*, resource: str, description: str) -> str:
    """The ``WWW-Authenticate`` value hosts look for, with ``error``, ``error_description``,
    the metadata URL and the one scope."""
    path = urlsplit(canonical_resource(resource)).path
    parts = urlsplit(resource)
    metadata = f"{parts.scheme}://{parts.netloc}/.well-known/oauth-protected-resource{path}"
    quoted = description.replace("\\", "\\\\").replace('"', '\\"')
    return (
        f'Bearer error="invalid_token", error_description="{quoted}", '
        f'resource_metadata="{metadata}", scope="{AGENT_SCOPE}"'
    )
