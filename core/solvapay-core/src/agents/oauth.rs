//! A merchant's MCP server or API as an OAuth 2.1 protected resource (RFC 9728).
//!
//! The document tells a host where to sign the owner in, and the 401 challenge
//! sends it there. SolvaPay's agent issuer is the authorization server. The
//! access token it issues is an ordinary agent token whose `aud` is this
//! resource.

use serde_json::{json, Map, Value};

use super::{failure, str_field, AGENT_SCOPE};

/// Path prefix of the RFC 9728 metadata document.
const WELL_KNOWN_PREFIX: &str = "/.well-known/oauth-protected-resource";

/// An absolute `http` or `https` URL, split the way a resource is compared.
struct ResourceUrl {
    /// `http` or `https`, lowercased.
    scheme: String,
    /// Host lowercased, with the port unless it is the scheme's default.
    host: String,
    /// Path with dot segments resolved, always starting with `/`.
    path: String,
    /// `?query`, or empty.
    search: String,
    /// Whether the URL carries a non-empty fragment.
    has_fragment: bool,
    /// Whether the URL carries a username or password.
    has_credentials: bool,
}

impl ResourceUrl {
    /// `scheme://host`.
    fn origin(&self) -> String {
        format!("{}://{}", self.scheme, self.host)
    }
}

/// Resolve `.` and `..` segments of an absolute path.
fn remove_dot_segments(path: &str) -> String {
    let mut segments: Vec<&str> = Vec::new();
    let ends_with_dir = path.ends_with('/') || path.ends_with("/.") || path.ends_with("/..");
    for segment in path.split('/').skip(1) {
        match segment {
            "." => {}
            ".." => {
                segments.pop();
            }
            other => segments.push(other),
        }
    }
    let mut out = String::from("/");
    out.push_str(&segments.join("/"));
    if ends_with_dir && !out.ends_with('/') {
        out.push('/');
    }
    out
}

/// Parse an absolute `http(s)` URL. `None` when it is not one.
fn parse_resource_url(raw: &str) -> Option<ResourceUrl> {
    let trimmed = raw.trim();
    let (scheme_raw, rest) = trimmed.split_once(':')?;
    let scheme = scheme_raw.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return None;
    }
    let rest = rest.strip_prefix("//")?;
    let (before_fragment, fragment) = match rest.split_once('#') {
        Some((before, fragment)) => (before, fragment),
        None => (rest, ""),
    };
    let (before_query, query) = match before_fragment.split_once('?') {
        Some((before, query)) => (before, query),
        None => (before_fragment, ""),
    };
    let (authority, path_raw) = match before_query.find('/') {
        Some(index) => before_query.split_at(index),
        None => (before_query, "/"),
    };
    let (userinfo, host_port) = match authority.rsplit_once('@') {
        Some((userinfo, host_port)) => (userinfo, host_port),
        None => ("", authority),
    };
    let (host_raw, port_raw) = match host_port.rsplit_once(':') {
        // An IPv6 literal keeps its colons inside the brackets.
        Some((host, port)) if !port.contains(']') => (host, port),
        _ => (host_port, ""),
    };
    if host_raw.is_empty() || host_raw.contains(char::is_whitespace) {
        return None;
    }
    let default_port: u16 = if scheme == "https" { 443 } else { 80 };
    let mut host = host_raw.to_ascii_lowercase();
    if !port_raw.is_empty() {
        let port: u16 = port_raw.parse().ok()?;
        if port != default_port {
            host = format!("{host}:{port}");
        }
    }
    Some(ResourceUrl {
        scheme,
        host,
        path: remove_dot_segments(path_raw),
        search: if query.is_empty() {
            String::new()
        } else {
            format!("?{query}")
        },
        has_fragment: !fragment.is_empty(),
        has_credentials: !userinfo.is_empty(),
    })
}

/// The canonical form, or the sentence for why `resource` has none.
pub(crate) fn canonical_resource(resource: &str) -> Result<String, String> {
    let url = parse_resource_url(resource).ok_or_else(|| "Invalid URL".to_owned())?;
    if url.has_fragment || url.has_credentials {
        return Err(format!(
            "{resource} cannot be an OAuth resource: no fragment or credentials"
        ));
    }
    Ok(format!(
        "{}{}{}",
        url.origin(),
        url.path.trim_end_matches('/'),
        url.search
    ))
}

/// Path of a canonical resource, `/` when it has none.
fn canonical_pathname(canonical: &str) -> String {
    parse_resource_url(canonical).map_or_else(|| "/".to_owned(), |url| url.path)
}

/// Where the metadata is served for `resource`.
fn metadata_path(resource: &Value, canonical: &str) -> String {
    match str_field(resource, "metadataPath") {
        Some(path) => path.to_owned(),
        None => format!("{WELL_KNOWN_PREFIX}{}", canonical_pathname(canonical)),
    }
}

/// The absolute URL a challenge points hosts at: `path` resolved against the resource.
fn metadata_url(resource_raw: &str, path: &str) -> Result<String, String> {
    if parse_resource_url(path).is_some() {
        return Ok(path.to_owned());
    }
    let base = parse_resource_url(resource_raw).ok_or_else(|| "Invalid URL".to_owned())?;
    if path.starts_with('/') {
        return Ok(format!("{}{}", base.origin(), remove_dot_segments(path)));
    }
    let directory = match base.path.rfind('/') {
        Some(index) => &base.path[..=index],
        None => "/",
    };
    Ok(format!(
        "{}{}",
        base.origin(),
        remove_dot_segments(&format!("{directory}{path}"))
    ))
}

/// Everything derived from a protected resource description.
struct ResolvedResource {
    /// Canonical resource URL.
    canonical: String,
    /// Metadata document path.
    path: String,
    /// Absolute metadata document URL.
    url: String,
}

/// Canonical form, metadata path and metadata URL of `resource`.
fn resolve(resource: &Value) -> Result<ResolvedResource, String> {
    let raw = str_field(resource, "resource")
        .ok_or_else(|| "resource must be a non-empty string".to_owned())?;
    let canonical = canonical_resource(raw)?;
    let path = metadata_path(resource, &canonical);
    let url = metadata_url(raw, &path)?;
    Ok(ResolvedResource {
        canonical,
        path,
        url,
    })
}

/// The canonical form SolvaPay compares resources in.
///
/// Scheme and host lowercased, default port dropped, no trailing slash.
/// Returns `{ ok: true, value }`, or `{ ok: false, error }` when the URL is
/// not absolute `http(s)` or carries a fragment or credentials.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 158
)]
#[must_use]
pub fn agent_canonical_resource(resource: &str) -> Value {
    match canonical_resource(resource) {
        Ok(value) => json!({ "ok": true, "value": value }),
        Err(message) => failure(message),
    }
}

/// The RFC 9728 view of a protected resource.
///
/// `resource` carries `resource`, `authorizationServer`, and optional
/// `documentation`, `metadataPath` and `serverName`. Returns
/// `{ ok: true, resource, path, url, metadata }`: the canonical resource, the
/// path-suffixed metadata path hosts try first, its absolute URL, and the
/// document. `{ ok: false, error }` when the resource is not usable.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 159
)]
#[must_use]
pub fn agent_protected_resource(resource: &Value) -> Value {
    let resolved = match resolve(resource) {
        Ok(resolved) => resolved,
        Err(message) => return failure(message),
    };
    let mut metadata = Map::new();
    metadata.insert("resource".to_owned(), json!(resolved.canonical));
    metadata.insert(
        "authorization_servers".to_owned(),
        json!([resource
            .get("authorizationServer")
            .cloned()
            .unwrap_or(Value::Null)]),
    );
    metadata.insert("scopes_supported".to_owned(), json!([AGENT_SCOPE]));
    metadata.insert("bearer_methods_supported".to_owned(), json!(["header"]));
    if let Some(name) = str_field(resource, "serverName") {
        metadata.insert("resource_name".to_owned(), json!(name));
    }
    if let Some(documentation) = str_field(resource, "documentation") {
        metadata.insert("resource_documentation".to_owned(), json!(documentation));
    }
    json!({
        "ok": true,
        "resource": resolved.canonical,
        "path": resolved.path,
        "url": resolved.url,
        "metadata": Value::Object(metadata),
    })
}

/// Escape `\` and `"` for a quoted header parameter.
fn quoted(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    for ch in value.chars() {
        if ch == '\\' || ch == '"' {
            out.push('\\');
        }
        out.push(ch);
    }
    out
}

/// The challenge header map, or why the resource is not usable.
pub(crate) fn challenge_headers(resource: &Value, description: &str) -> Result<Value, String> {
    let resolved = resolve(resource)?;
    Ok(json!({
        "WWW-Authenticate": format!(
            "Bearer error=\"invalid_token\", error_description=\"{}\", \
             resource_metadata=\"{}\", scope=\"{AGENT_SCOPE}\"",
            quoted(description),
            resolved.url
        ),
        "Access-Control-Expose-Headers": "WWW-Authenticate",
    }))
}

/// The `WWW-Authenticate` challenge hosts look for.
///
/// `error` and `error_description` are both present and the one scope is
/// named, so hosts ask for nothing broader. Returns `{ ok: true, headers }`
/// or `{ ok: false, error }`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 160
)]
#[must_use]
pub fn agent_challenge_headers(resource: &Value, description: &str) -> Value {
    match challenge_headers(resource, description) {
        Ok(headers) => json!({ "ok": true, "headers": headers }),
        Err(message) => failure(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn canonical(resource: &str) -> String {
        canonical_resource(resource).unwrap_or_else(|error| format!("ERR {error}"))
    }

    #[test]
    fn canonical_lowercases_and_drops_default_port_and_trailing_slash() {
        assert_eq!(
            canonical("HTTPS://MCP.Example.COM:443/mcp/"),
            "https://mcp.example.com/mcp"
        );
        assert_eq!(canonical("https://example.com"), "https://example.com");
        assert_eq!(canonical("https://example.com/"), "https://example.com");
        assert_eq!(
            canonical("http://localhost:3000/mcp?x=1"),
            "http://localhost:3000/mcp?x=1"
        );
        assert_eq!(
            canonical("http://example.com:80/a/../b"),
            "http://example.com/b"
        );
    }

    #[test]
    fn canonical_refuses_fragments_credentials_and_relative_urls() {
        assert_eq!(
            canonical("https://example.com/mcp#frag"),
            "ERR https://example.com/mcp#frag cannot be an OAuth resource: no fragment or credentials"
        );
        assert_eq!(
            canonical("https://user:pw@example.com/mcp"),
            "ERR https://user:pw@example.com/mcp cannot be an OAuth resource: no fragment or credentials"
        );
        assert_eq!(canonical("/mcp"), "ERR Invalid URL");
        assert_eq!(canonical("ftp://example.com"), "ERR Invalid URL");
    }

    #[test]
    fn protected_resource_builds_the_document() {
        let view = agent_protected_resource(&json!({
            "resource": "https://mcp.example.com/mcp/",
            "authorizationServer": "https://api.solvapay.com/v1/agent",
            "serverName": "Example",
            "documentation": "https://example.com/docs",
        }));
        assert_eq!(
            view,
            json!({
                "ok": true,
                "resource": "https://mcp.example.com/mcp",
                "path": "/.well-known/oauth-protected-resource/mcp",
                "url": "https://mcp.example.com/.well-known/oauth-protected-resource/mcp",
                "metadata": {
                    "resource": "https://mcp.example.com/mcp",
                    "authorization_servers": ["https://api.solvapay.com/v1/agent"],
                    "scopes_supported": ["usage"],
                    "bearer_methods_supported": ["header"],
                    "resource_name": "Example",
                    "resource_documentation": "https://example.com/docs",
                },
            })
        );
    }

    #[test]
    fn protected_resource_at_the_origin_keeps_the_root_path() {
        let view = agent_protected_resource(&json!({
            "resource": "https://api.example.com",
            "authorizationServer": "https://api.solvapay.com/v1/agent",
        }));
        assert_eq!(view["path"], "/.well-known/oauth-protected-resource/");
    }

    #[test]
    fn metadata_path_override_wins() {
        let view = agent_protected_resource(&json!({
            "resource": "https://api.example.com/v1",
            "authorizationServer": "https://issuer",
            "metadataPath": "/meta",
        }));
        assert_eq!(view["path"], "/meta");
        assert_eq!(view["url"], "https://api.example.com/meta");
    }

    #[test]
    fn challenge_quotes_the_description() {
        let headers = agent_challenge_headers(
            &json!({ "resource": "https://mcp.example.com/mcp", "authorizationServer": "x" }),
            "Sign in to \"pay\"",
        );
        assert_eq!(
            headers["headers"]["WWW-Authenticate"],
            "Bearer error=\"invalid_token\", error_description=\"Sign in to \\\"pay\\\"\", \
             resource_metadata=\"https://mcp.example.com/.well-known/oauth-protected-resource/mcp\", \
             scope=\"usage\""
        );
        assert_eq!(
            headers["headers"]["Access-Control-Expose-Headers"],
            "WWW-Authenticate"
        );
    }

    #[test]
    fn unusable_resource_fails_in_band() {
        assert_eq!(
            agent_protected_resource(&json!({ "resource": "nope" })),
            json!({ "ok": false, "error": "Invalid URL" })
        );
    }
}
