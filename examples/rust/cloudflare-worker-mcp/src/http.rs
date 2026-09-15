//! Framework-neutral request mapping and browser-origin CORS.

use std::collections::BTreeMap;

use solvapay_mcp::{McpHttpRequest, McpHttpResponse};

/// Headers exposed to browser MCP clients.
pub const CORS_EXPOSE: &str = "WWW-Authenticate, Mcp-Session-Id";
/// Preflight methods.
pub const CORS_ALLOW_METHODS: &str = "GET, POST, DELETE, OPTIONS";
/// Default preflight request headers.
pub const CORS_DEFAULT_ALLOW_HEADERS: &str =
    "authorization, content-type, mcp-session-id, mcp-protocol-version";

/// Fail when a required Worker binding is missing or blank.
///
/// # Errors
///
/// Empty or whitespace-only values.
pub fn require_binding(name: &str, value: Option<String>) -> Result<String, String> {
    match value {
        Some(raw) if !raw.trim().is_empty() => Ok(raw.trim().to_owned()),
        _ => Err(format!(
            "{name} is not set — check wrangler.jsonc `vars` or run `wrangler secret put {name}`"
        )),
    }
}

/// Build the engine request from already-extracted HTTP parts.
#[must_use]
pub fn mcp_request(
    method: String,
    path: String,
    headers: BTreeMap<String, String>,
    body: Vec<u8>,
) -> McpHttpRequest {
    McpHttpRequest {
        method,
        path,
        headers,
        body,
    }
}

/// Lowercase a header map, skipping empty names.
#[must_use]
pub fn lowercase_headers<I>(headers: I) -> BTreeMap<String, String>
where
    I: IntoIterator<Item = (String, String)>,
{
    let mut out = BTreeMap::new();
    for (name, value) in headers {
        let key = name.to_ascii_lowercase();
        if !key.is_empty() {
            out.insert(key, value);
        }
    }
    out
}

/// Browser CORS headers to merge onto an MCP response.
#[must_use]
pub fn browser_cors_headers(
    origin: Option<&str>,
    existing: &BTreeMap<String, String>,
    preflight: bool,
    requested_method: Option<&str>,
    requested_headers: Option<&str>,
) -> BTreeMap<String, String> {
    let mut headers = existing.clone();
    if let Some(origin) = origin.filter(|value| !value.is_empty()) {
        if !headers.contains_key("access-control-allow-origin") {
            headers.insert("access-control-allow-origin".to_owned(), origin.to_owned());
            let vary = headers
                .get("vary")
                .filter(|value| !value.is_empty())
                .map(|value| format!("{value}, Origin"))
                .unwrap_or_else(|| "Origin".to_owned());
            headers.insert("vary".to_owned(), vary);
        }
    }
    let exposed = headers.get("access-control-expose-headers").cloned();
    let expose_ok = exposed
        .as_deref()
        .is_some_and(|value| value.to_ascii_lowercase().contains("www-authenticate"));
    if !expose_ok {
        let next = match exposed.filter(|value| !value.is_empty()) {
            Some(value) => format!("{value}, {CORS_EXPOSE}"),
            None => CORS_EXPOSE.to_owned(),
        };
        headers.insert("access-control-expose-headers".to_owned(), next);
    }
    if preflight {
        let method = requested_method
            .filter(|value| !value.is_empty())
            .unwrap_or("POST");
        headers.insert(
            "access-control-allow-methods".to_owned(),
            format!("{method}, OPTIONS"),
        );
        let allow = requested_headers
            .filter(|value| !value.is_empty())
            .unwrap_or(CORS_DEFAULT_ALLOW_HEADERS);
        headers.insert("access-control-allow-headers".to_owned(), allow.to_owned());
        headers.insert("access-control-max-age".to_owned(), "600".to_owned());
    }
    headers
}

/// Empty CORS preflight response.
#[must_use]
pub fn preflight_response(
    origin: Option<&str>,
    requested_method: Option<&str>,
    requested_headers: Option<&str>,
) -> McpHttpResponse {
    McpHttpResponse {
        status: 204,
        headers: browser_cors_headers(
            origin,
            &BTreeMap::new(),
            true,
            requested_method,
            requested_headers,
        ),
        body: Vec::new(),
    }
}

/// Stamp browser CORS onto an engine response.
#[must_use]
pub fn apply_browser_cors(origin: Option<&str>, response: McpHttpResponse) -> McpHttpResponse {
    McpHttpResponse {
        status: response.status,
        headers: browser_cors_headers(origin, &response.headers, false, None, None),
        body: response.body,
    }
}

#[cfg(test)]
#[allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]
mod tests {
    use super::*;

    #[test]
    fn missing_binding_fails_loudly() {
        let err = require_binding("SOLVAPAY_SECRET_KEY", None).expect_err("required");
        assert!(err.contains("SOLVAPAY_SECRET_KEY"));
        let err = require_binding("SOLVAPAY_SECRET_KEY", Some("  ".to_owned())).expect_err("blank");
        assert!(err.contains("SOLVAPAY_SECRET_KEY"));
    }

    #[test]
    fn headers_are_lowercased() {
        let headers = lowercase_headers([
            ("Authorization".to_owned(), "Bearer x".to_owned()),
            ("Content-Type".to_owned(), "application/json".to_owned()),
        ]);
        assert_eq!(headers.get("authorization").map(String::as_str), Some("Bearer x"));
        assert_eq!(
            headers.get("content-type").map(String::as_str),
            Some("application/json")
        );
    }

    #[test]
    fn preflight_mirrors_origin_and_exposes_auth_headers() {
        let response = preflight_response(
            Some("https://chatgpt.com"),
            Some("POST"),
            Some("authorization, content-type"),
        );
        assert_eq!(response.status, 204);
        assert_eq!(
            response.headers.get("access-control-allow-origin").map(String::as_str),
            Some("https://chatgpt.com")
        );
        assert_eq!(
            response.headers.get("access-control-allow-methods").map(String::as_str),
            Some("POST, OPTIONS")
        );
        assert!(response
            .headers
            .get("access-control-expose-headers")
            .is_some_and(|value| value.contains("WWW-Authenticate")));
    }
}
