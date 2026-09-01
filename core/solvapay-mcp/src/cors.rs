//! Native-scheme CORS allowlist for MCP clients (`cursor` / `vscode` / `claude`).

use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};

/// Input for [`mcp_native_cors`].
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCorsInput {
    /// Request `Origin` header.
    #[serde(default)]
    pub origin: Option<String>,
    /// `Access-Control-Request-Method` (preflight).
    #[serde(default)]
    pub requested_method: Option<String>,
    /// `Access-Control-Request-Headers` (preflight).
    #[serde(default)]
    pub requested_headers: Option<String>,
    /// When true, emit preflight allow-methods / allow-headers / max-age.
    #[serde(default)]
    pub preflight: bool,
}

/// Allowlist decision plus response headers to merge.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeCorsResult {
    /// True when `origin` is a native MCP-client scheme we mirror.
    pub allowed: bool,
    /// Headers to set on the HTTP response (empty object when nothing applies).
    pub headers: Value,
}

/// Strict native-scheme match: `scheme://` plus a non-empty remainder.
///
/// Rejects loose prefixes such as `cursor:x` (no `://`).
#[must_use]
pub fn is_native_client_origin(origin: Option<&str>) -> bool {
    let Some(origin) = origin.map(str::trim).filter(|s| !s.is_empty()) else {
        return false;
    };
    let Some((scheme, rest)) = origin.split_once("://") else {
        return false;
    };
    matches!(scheme, "cursor" | "vscode" | "vscode-webview" | "claude") && !rest.is_empty()
}

/// Decide whether to mirror `Origin` and which CORS headers to emit.
#[must_use]
pub fn mcp_native_cors(input: &NativeCorsInput) -> NativeCorsResult {
    let origin = input
        .origin
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let allowed = is_native_client_origin(origin);
    let mut headers = Map::new();
    if allowed {
        if let Some(origin) = origin {
            headers.insert("Access-Control-Allow-Origin".to_owned(), json!(origin));
            headers.insert("Vary".to_owned(), json!("Origin"));
        }
    }
    if input.preflight {
        let method = input
            .requested_method
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("POST");
        let requested = input
            .requested_headers
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .unwrap_or("authorization, content-type");
        headers.insert(
            "Access-Control-Allow-Methods".to_owned(),
            json!(format!("{method}, OPTIONS")),
        );
        headers.insert("Access-Control-Allow-Headers".to_owned(), json!(requested));
        headers.insert("Access-Control-Max-Age".to_owned(), json!("600"));
    }
    NativeCorsResult {
        allowed,
        headers: Value::Object(headers),
    }
}

/// Flatten [`NativeCorsResult::headers`] into `(name, value)` pairs.
#[must_use]
pub fn native_cors_header_pairs(result: &NativeCorsResult) -> Vec<(String, String)> {
    let Some(map) = result.headers.as_object() else {
        return Vec::new();
    };
    map.iter()
        .filter_map(|(key, value)| value.as_str().map(|text| (key.clone(), text.to_owned())))
        .collect()
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;

    #[test]
    fn allows_strict_native_schemes() {
        for origin in [
            "cursor://mcp/x",
            "vscode://ms.copilot/callback",
            "vscode-webview://abcd1234",
            "claude://auth/return",
        ] {
            assert!(
                is_native_client_origin(Some(origin)),
                "{origin} must be allowed"
            );
        }
    }

    #[test]
    fn rejects_loose_prefix_and_unknown() {
        for origin in [
            Some("cursor:x"),
            Some("cursor:"),
            Some("https://example.com"),
            Some("file:///etc/passwd"),
            Some(""),
            None,
        ] {
            assert!(
                !is_native_client_origin(origin),
                "{origin:?} must be rejected"
            );
        }
    }

    #[test]
    fn mirrors_allowed_origin() {
        let got = mcp_native_cors(&NativeCorsInput {
            origin: Some("cursor://mcp/x".to_owned()),
            ..NativeCorsInput::default()
        });
        assert!(got.allowed);
        assert_eq!(got.headers["Access-Control-Allow-Origin"], "cursor://mcp/x");
        assert_eq!(got.headers["Vary"], "Origin");
    }

    #[test]
    fn preflight_without_origin_still_emits_allow_headers() {
        let got = mcp_native_cors(&NativeCorsInput {
            origin: None,
            requested_method: Some("POST".to_owned()),
            requested_headers: Some("authorization, content-type".to_owned()),
            preflight: true,
        });
        assert!(!got.allowed);
        assert!(got.headers.get("Access-Control-Allow-Origin").is_none());
        assert_eq!(got.headers["Access-Control-Allow-Methods"], "POST, OPTIONS");
        assert_eq!(
            got.headers["Access-Control-Allow-Headers"],
            "authorization, content-type"
        );
        assert_eq!(got.headers["Access-Control-Max-Age"], "600");
    }
}
