"""OAuth helpers for a server agents call: its resource URL and the RFC 9728 document.

Ported from ``@solvapay/agents``' ``oauth.ts``, which reads URLs as browsers do (the
WHATWG URL standard); the canonical form below follows it for the URLs a server
can have.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import quote, urljoin, urlsplit

AGENT_SCOPE = "usage"
METADATA_PREFIX = "/.well-known/oauth-protected-resource"

# What the URL standard leaves unescaped in a path and in a query (everything printable
# but space, ``"``, ``#``, ``<``, ``>``, and ``?``, `````, ``{``, ``}`` in a path or ``'`` in a
# query); ``%`` stays, so an escape is never escaped twice.
_PATH_SAFE = "!$%&'()*+,-./:;=@[\\]^_|~"
_QUERY_SAFE = "!$%&()*+,-./:;=?@[\\]^_`{|}~"


def _remove_dot_segments(path: str) -> str:
    """RFC 3986 section 5.2.4: ``/a/../b/./c`` is ``/b/c``."""
    out: list[str] = []
    segments = path.split("/")
    for i, segment in enumerate(segments):
        last = i == len(segments) - 1
        if segment == ".":
            if last:
                out.append("")
        elif segment == "..":
            if len(out) > 1:
                out.pop()
            if last:
                out.append("")
        else:
            out.append(segment)
    return "/".join(out)


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
    if ":" in host:
        host = f"[{host}]"  # an IPv6 address keeps its brackets
    default = {"http": 80, "https": 443}.get(scheme)
    port = f":{parts.port}" if parts.port and parts.port != default else ""
    path = quote(_remove_dot_segments(parts.path or "/"), safe=_PATH_SAFE).rstrip("/")
    query = f"?{quote(parts.query, safe=_QUERY_SAFE)}" if parts.query else ""
    return f"{scheme}://{host}{port}{path}{query}"


def protected_resource_metadata_path(resource: str, metadata_path: str | None = None) -> str:
    """Where the metadata is served: ``metadata_path``, else the RFC 9728 path-suffixed
    form hosts try first, ``/.well-known/oauth-protected-resource/mcp``."""
    if metadata_path:
        return metadata_path
    return f"{METADATA_PREFIX}{urlsplit(canonical_resource(resource)).path}"


def protected_resource_metadata_url(resource: str, metadata_path: str | None = None) -> str:
    """The absolute URL a challenge points hosts at, on the resource's origin."""
    path = protected_resource_metadata_path(resource, metadata_path)
    return urljoin(canonical_resource(resource), path)


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


def challenge_header(*, resource: str, description: str, metadata_url: str | None = None) -> str:
    """The ``WWW-Authenticate`` value hosts look for, with ``error``, ``error_description``,
    the metadata URL (default: the path-suffixed form on the resource's origin) and the
    one scope."""
    metadata = metadata_url or protected_resource_metadata_url(resource)
    quoted = description.replace("\\", "\\\\").replace('"', '\\"')
    return (
        f'Bearer error="invalid_token", error_description="{quoted}", '
        f'resource_metadata="{metadata}", scope="{AGENT_SCOPE}"'
    )
