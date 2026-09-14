//! Shared bearer / JWT structural helpers. Not an authorization path.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Case-insensitive `Bearer ` prefix. Empty token → none.
#[must_use]
pub fn extract_bearer_token_ref(authorization_header: Option<&str>) -> Option<&str> {
    let header = authorization_header?;
    if header.len() < 7 {
        return None;
    }
    if !header[..7].eq_ignore_ascii_case("bearer ") {
        return None;
    }
    let token = header[7..].trim();
    if token.is_empty() {
        None
    } else {
        Some(token)
    }
}

/// Case-insensitive `Bearer ` prefix; empty → none.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "auth",
    emit_order = 80
)]
#[must_use]
pub fn extract_bearer_token(authorization_header: Option<&str>) -> Option<String> {
    extract_bearer_token_ref(authorization_header).map(str::to_owned)
}

/// Unverified JWT payload decode. `None` when the token is malformed.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "auth",
    emit_order = 81
)]
#[must_use]
pub fn decode_jwt_payload_unverified(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload_b64 = parts.next()?;
    if payload_b64.is_empty() {
        return None;
    }
    let json = base64url_decode_to_string(payload_b64)?;
    let payload: Value = serde_json::from_str(&json).ok()?;
    if payload.is_object() {
        Some(payload)
    } else {
        None
    }
}

/// Walk `customerRef` → `customer_ref` → `sub` (or `claim_priority` string array).
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "auth",
    emit_order = 82
)]
#[must_use]
pub fn customer_ref_from_claims(claims: &Value, claim_priority: Option<&Value>) -> Option<String> {
    let default = ["customerRef", "customer_ref", "sub"];
    let owned: Vec<String> = match claim_priority {
        Some(Value::Array(items)) => items
            .iter()
            .filter_map(|item| item.as_str().map(str::to_owned))
            .collect(),
        _ => Vec::new(),
    };
    let names: Vec<&str> = if owned.is_empty() {
        default.to_vec()
    } else {
        owned.iter().map(String::as_str).collect()
    };
    for claim in names {
        if let Some(s) = claims.get(claim).and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }
    None
}

/// Issuer / audience / clock defaults matching `mcp_auth_gate`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultMcpBearerExpectations {
    /// `iss` — public origin without a trailing slash.
    pub expected_issuer: String,
    /// `aud` — origin plus optional MCP path.
    pub expected_audience: String,
    /// Unix seconds forwarded to bearer verify.
    pub now_unix_secs: i64,
}

/// Issuer/audience URL building for MCP bearer verification.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "auth",
    emit_order = 83
)]
#[must_use]
pub fn default_mcp_bearer_expectations(
    public_base_url: &str,
    mcp_path: Option<&str>,
    now_unix_secs: i64,
) -> DefaultMcpBearerExpectations {
    let issuer = public_base_url.trim_end_matches('/').to_owned();
    let raw = mcp_path.unwrap_or("").trim();
    let path = raw.trim_end_matches('/');
    let audience = if path.is_empty() {
        issuer.clone()
    } else if path.starts_with('/') {
        format!("{issuer}{path}")
    } else {
        format!("{issuer}/{path}")
    };
    DefaultMcpBearerExpectations {
        expected_issuer: issuer,
        expected_audience: audience,
        now_unix_secs,
    }
}

/// Hand-rolled base64url decode (no extra crate).
#[must_use]
pub fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut std = String::with_capacity(input.len() + 3);
    for ch in input.chars() {
        match ch {
            '-' => std.push('+'),
            '_' => std.push('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => std.push(c),
            '=' => {}
            _ => return None,
        }
    }
    let pad = (4 - (std.len() % 4)) % 4;
    for _ in 0..pad {
        std.push('=');
    }
    decode_standard_base64(&std)
}

/// Base64url-decode into a UTF-8 string.
#[must_use]
pub fn base64url_decode_to_string(input: &str) -> Option<String> {
    let bytes = base64url_decode(input)?;
    String::from_utf8(bytes).ok()
}

/// Decode standard base64 (after url-safe remap + padding).
fn decode_standard_base64(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            b'=' => None,
            _ => None,
        }
    }
    let bytes = input.as_bytes();
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut i = 0;
    while i < bytes.len() {
        let a = val(bytes[i])?;
        let b = val(bytes[i + 1])?;
        out.push((a << 2) | (b >> 4));
        if bytes[i + 2] != b'=' {
            let c = val(bytes[i + 2])?;
            out.push((b << 4) | (c >> 2));
            if bytes[i + 3] != b'=' {
                let d = val(bytes[i + 3])?;
                out.push((c << 6) | d);
            }
        }
        i += 4;
    }
    Some(out)
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn bearer_prefix_is_case_insensitive() {
        assert_eq!(
            extract_bearer_token(Some("bearer abc")),
            Some("abc".to_owned())
        );
        assert_eq!(
            extract_bearer_token(Some("BEARER abc")),
            Some("abc".to_owned())
        );
        assert_eq!(extract_bearer_token(Some("Basic abc")), None);
    }

    #[test]
    fn expectations_join_path() {
        let got = default_mcp_bearer_expectations("https://mcp.example.com/", Some("/mcp"), 1);
        assert_eq!(got.expected_issuer, "https://mcp.example.com");
        assert_eq!(got.expected_audience, "https://mcp.example.com/mcp");
        assert_eq!(got.now_unix_secs, 1);
    }

    #[test]
    fn customer_ref_walks_claims() {
        let claims = json!({"sub": "cus_1"});
        assert_eq!(
            customer_ref_from_claims(&claims, None).as_deref(),
            Some("cus_1")
        );
        let claims = json!({"email": "a@b.c", "sub": "cus_1"});
        let priority = json!(["email"]);
        assert_eq!(
            customer_ref_from_claims(&claims, Some(&priority)).as_deref(),
            Some("a@b.c")
        );
    }
}
