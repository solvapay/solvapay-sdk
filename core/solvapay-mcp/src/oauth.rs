//! OAuth discovery documents and upstream error normalization.

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Discovery document kind.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum OauthDiscoveryKind {
    /// RFC 9728 protected resource metadata.
    ProtectedResource,
    /// RFC 8414 authorization server metadata.
    AuthorizationServer,
}

/// Input for [`mcp_oauth_discovery`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OauthDiscoveryInput {
    /// Which document to build.
    pub kind: OauthDiscoveryKind,
    /// Public origin (trailing slash stripped).
    pub public_base_url: String,
    /// Optional MCP mount path (`/mcp`).
    #[serde(default)]
    pub mcp_path: Option<String>,
    /// Optional path overrides.
    #[serde(default)]
    pub paths: Option<OauthPaths>,
}

/// OAuth route path overrides.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct OauthPaths {
    /// DCR path.
    #[serde(default)]
    pub register: Option<String>,
    /// Authorize path.
    #[serde(default)]
    pub authorize: Option<String>,
    /// Token path.
    #[serde(default)]
    pub token: Option<String>,
    /// Revoke path.
    #[serde(default)]
    pub revoke: Option<String>,
}

fn without_trailing_slash(value: &str) -> &str {
    value.strip_suffix('/').unwrap_or(value)
}

fn with_leading_slash(value: &str) -> String {
    if value.starts_with('/') {
        value.to_owned()
    } else {
        format!("/{value}")
    }
}

/// MCP resource identifier (`origin` + optional path).
#[must_use]
pub fn mcp_resource_identifier(public_base_url: &str, mcp_path: Option<&str>) -> String {
    let origin = without_trailing_slash(public_base_url);
    let Some(path) = mcp_path.filter(|p| !p.is_empty()) else {
        return origin.to_owned();
    };
    let path = without_trailing_slash(&with_leading_slash(path)).to_owned();
    if path.is_empty() {
        origin.to_owned()
    } else {
        format!("{origin}{path}")
    }
}

/// Path-aware protected-resource well-known location.
#[must_use]
pub fn path_aware_protected_resource_path(mcp_path: &str) -> String {
    let path = without_trailing_slash(&with_leading_slash(mcp_path)).to_owned();
    if path.is_empty() {
        "/.well-known/oauth-protected-resource".to_owned()
    } else {
        format!("/.well-known/oauth-protected-resource{path}")
    }
}

fn resolve_paths(paths: Option<&OauthPaths>) -> (String, String, String, String) {
    let d = paths.cloned().unwrap_or_default();
    (
        d.register.unwrap_or_else(|| "/oauth/register".to_owned()),
        d.authorize.unwrap_or_else(|| "/oauth/authorize".to_owned()),
        d.token.unwrap_or_else(|| "/oauth/token".to_owned()),
        d.revoke.unwrap_or_else(|| "/oauth/revoke".to_owned()),
    )
}

/// Build an OAuth discovery document.
#[must_use]
pub fn mcp_oauth_discovery(input: &OauthDiscoveryInput) -> Value {
    let origin = without_trailing_slash(&input.public_base_url);
    match input.kind {
        OauthDiscoveryKind::ProtectedResource => {
            json!({
                "resource": mcp_resource_identifier(origin, input.mcp_path.as_deref()),
                "authorization_servers": [origin],
                "scopes_supported": ["openid", "profile", "email"],
                "bearer_methods_supported": ["header"],
            })
        }
        OauthDiscoveryKind::AuthorizationServer => {
            let (register, authorize, token, revoke) = resolve_paths(input.paths.as_ref());
            json!({
                "issuer": origin,
                "authorization_endpoint": format!("{origin}{authorize}"),
                "token_endpoint": format!("{origin}{token}"),
                "registration_endpoint": format!("{origin}{register}"),
                "revocation_endpoint": format!("{origin}{revoke}"),
                "token_endpoint_auth_methods_supported": ["client_secret_basic", "client_secret_post"],
                "response_types_supported": ["code"],
                "grant_types_supported": ["authorization_code", "refresh_token"],
                "scopes_supported": ["openid", "profile", "email"],
                "code_challenge_methods_supported": ["S256"],
            })
        }
    }
}

const VALID_OAUTH_TOKEN_ERROR_CODES: &[&str] = &[
    "invalid_request",
    "invalid_client",
    "invalid_grant",
    "unauthorized_client",
    "unsupported_grant_type",
    "invalid_scope",
    "server_error",
    "temporarily_unavailable",
    "access_denied",
];

fn has_oauth_error_shape(body: &Value) -> bool {
    body.get("error")
        .and_then(Value::as_str)
        .is_some_and(|err| VALID_OAUTH_TOKEN_ERROR_CODES.contains(&err))
}

fn zod_errors(body: &Map<String, Value>) -> Vec<&Map<String, Value>> {
    body.get("errors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_object)
        .collect()
}

fn path_has(err: &Map<String, Value>, field: &str) -> bool {
    err.get("path")
        .and_then(Value::as_array)
        .is_some_and(|path| path.iter().any(|item| item.as_str() == Some(field)))
}

fn derive_oauth_error_code(status: i64, nest_body: &Map<String, Value>) -> &'static str {
    if status == 401 || status == 403 {
        return "invalid_client";
    }
    if status >= 500 {
        return "server_error";
    }
    let errs = zod_errors(nest_body);
    let touches = |field: &str| errs.iter().any(|err| path_has(err, field));
    if touches("grant_type") {
        let grant_err = errs.iter().find(|err| path_has(err, "grant_type"));
        let received = grant_err.and_then(|err| err.get("received"));
        if received.is_some() && received != Some(&Value::String("undefined".to_owned())) && received != Some(&Value::String(String::new())) {
            return "unsupported_grant_type";
        }
        return "invalid_request";
    }
    if touches("code") || touches("refresh_token") {
        return "invalid_grant";
    }
    if touches("scope") {
        return "invalid_scope";
    }
    if touches("client_id") || touches("client_secret") {
        return "invalid_client";
    }
    "invalid_request"
}

fn build_error_description(nest_body: &Map<String, Value>) -> Option<String> {
    let mut parts = Vec::new();
    for err in zod_errors(nest_body) {
        let path_str = err
            .get("path")
            .and_then(Value::as_array)
            .map(|path| {
                path.iter()
                    .filter_map(Value::as_str)
                    .collect::<Vec<_>>()
                    .join(".")
            })
            .unwrap_or_default();
        let msg_str = err.get("message").and_then(Value::as_str).unwrap_or("");
        if !path_str.is_empty() && !msg_str.is_empty() {
            parts.push(format!("{path_str}: {msg_str}"));
        } else if !path_str.is_empty() || !msg_str.is_empty() {
            parts.push(if path_str.is_empty() {
                msg_str.to_owned()
            } else {
                path_str
            });
        }
    }
    if !parts.is_empty() {
        return Some(parts.join("; "));
    }
    match nest_body.get("message") {
        Some(Value::String(s)) => Some(s.clone()),
        Some(Value::Array(items)) => {
            let strings: Vec<&str> = items.iter().filter_map(Value::as_str).collect();
            if strings.is_empty() {
                None
            } else {
                Some(strings.join("; "))
            }
        }
        _ => None,
    }
}

/// Normalize an upstream OAuth error body to RFC 6749.
#[must_use]
pub fn mcp_normalize_oauth_error(body: &Value, text: &str, status: i64) -> Value {
    if has_oauth_error_shape(body) {
        return body.clone();
    }
    if let Some(obj) = body.as_object() {
        let error = derive_oauth_error_code(status, obj);
        return match build_error_description(obj) {
            Some(desc) => json!({ "error": error, "error_description": desc }),
            None => json!({ "error": error }),
        };
    }
    let fallback = if status >= 500 {
        "server_error"
    } else {
        "invalid_request"
    };
    if !text.is_empty() && text.len() < 500 {
        json!({ "error": fallback, "error_description": text })
    } else {
        json!({ "error": fallback })
    }
}
