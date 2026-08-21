//! Authenticated-user resolution decision core (Step 26).
//!
//! Host inputs (header user id, Authorization value, JWT secret, strict mode,
//! include flags, clock) are explicit — no `Request`, no env reads, no timers.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::helper_error::HelperErrorResult;
use crate::hmac_util::{constant_time_eq, hmac_sha256};

/// Frozen `error` field for auth failures.
const ERR_UNAUTHORIZED: &str = "Unauthorized";
/// Bearer missing — middleware not configured.
const DETAILS_MIDDLEWARE: &str = "User ID not found. Ensure middleware is configured.";
/// HS256 verify / exp / nbf failure.
const DETAILS_INVALID: &str = "Invalid or expired authentication token";
/// Strict mode without a configured JWT secret.
const DETAILS_STRICT: &str = "Strict auth mode is enabled but no JWT secret is configured. Set SOLVAPAY_JWT_SECRET or SUPABASE_JWT_SECRET.";
/// Unverified decode failed (malformed compact JWT).
const DETAILS_MALFORMED: &str = "Malformed authentication token";
/// Payload missing string `sub` claim.
const DETAILS_MISSING_SUB: &str = "Authentication token missing subject (sub) claim";

/// Inputs for [`resolve_authenticated_user`] (facade resolves env / Request).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AuthResolutionInput {
    /// `x-user-id` header value when present.
    pub header_user_id: Option<String>,
    /// Raw `Authorization` header value when present.
    pub authorization_header: Option<String>,
    /// JWT secret (`SOLVAPAY_JWT_SECRET` || `SUPABASE_JWT_SECRET`).
    pub jwt_secret: Option<String>,
    /// `SOLVAPAY_AUTH_STRICT === 'true'`.
    pub strict_mode: bool,
    /// Facade default: `options.includeEmail !== false`.
    pub include_email: bool,
    /// Facade default: `options.includeName !== false`.
    pub include_name: bool,
    /// Explicit clock for `exp` / `nbf` (jose uses wall clock; fixtures use far dates).
    pub now_unix_secs: i64,
}

/// Successful authenticated-user payload (email/name serialize as explicit `null`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthenticatedUser {
    /// Subject / middleware user id.
    pub user_id: String,
    /// Email when extracted; otherwise JSON `null`.
    pub email: Option<String>,
    /// Display name when extracted; otherwise JSON `null`.
    pub name: Option<String>,
}

/// Resolve authenticated user from explicit host inputs.
///
/// # Arguments
///
/// * `input` - Header / bearer / secret / flags / clock.
///
/// # Returns
///
/// [`AuthenticatedUser`] on success, or a 401 [`HelperErrorResult`] on the
/// bearer failure paths. The header path never returns 401 for JWT problems.
pub fn resolve_authenticated_user(
    input: &AuthResolutionInput,
) -> Result<AuthenticatedUser, HelperErrorResult> {
    if let Some(header_user_id) = input.header_user_id.as_deref().filter(|s| !s.is_empty()) {
        let mut email = None;
        let mut name = None;
        if input.include_email || input.include_name {
            if let Some(token) = extract_bearer_token(input.authorization_header.as_deref()) {
                let payload = if let Some(secret) = input.jwt_secret.as_deref() {
                    verify_hs256(token, secret, input.now_unix_secs)
                } else if input.strict_mode {
                    None
                } else {
                    decode_jwt_unverified(token)
                };
                if let Some(payload) = payload {
                    if input.include_email {
                        email = pick_email(&payload);
                    }
                    if input.include_name {
                        name = pick_name(&payload);
                    }
                }
            }
        }
        return Ok(AuthenticatedUser {
            user_id: header_user_id.to_owned(),
            email,
            name,
        });
    }

    let Some(token) = extract_bearer_token(input.authorization_header.as_deref()) else {
        return Err(unauthorized(DETAILS_MIDDLEWARE));
    };

    let payload = if let Some(secret) = input.jwt_secret.as_deref() {
        match verify_hs256(token, secret, input.now_unix_secs) {
            Some(p) => p,
            None => return Err(unauthorized(DETAILS_INVALID)),
        }
    } else if input.strict_mode {
        return Err(unauthorized(DETAILS_STRICT));
    } else {
        match decode_jwt_unverified(token) {
            Some(p) => p,
            None => return Err(unauthorized(DETAILS_MALFORMED)),
        }
    };

    let Some(Value::String(user_id)) = payload.get("sub") else {
        return Err(unauthorized(DETAILS_MISSING_SUB));
    };

    Ok(AuthenticatedUser {
        user_id: user_id.clone(),
        email: if input.include_email {
            pick_email(&payload)
        } else {
            None
        },
        name: if input.include_name {
            pick_name(&payload)
        } else {
            None
        },
    })
}

/// Builds the frozen 401 Unauthorized helper error.
fn unauthorized(details: &str) -> HelperErrorResult {
    HelperErrorResult::with_details(ERR_UNAUTHORIZED, 401, details)
}

/// Case-insensitive `bearer ` prefix; `slice(7).trim()`; empty → none.
fn extract_bearer_token(authorization_header: Option<&str>) -> Option<&str> {
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

/// Name precedence: `user_metadata.full_name` → `user_metadata.name` → `name`.
fn pick_name(payload: &Value) -> Option<String> {
    let metadata = payload.get("user_metadata");
    if let Some(Value::String(s)) = metadata.and_then(|m| m.get("full_name")) {
        return Some(s.clone());
    }
    if let Some(Value::String(s)) = metadata.and_then(|m| m.get("name")) {
        return Some(s.clone());
    }
    if let Some(Value::String(s)) = payload.get("name") {
        return Some(s.clone());
    }
    None
}

/// Email when `payload.email` is a string.
fn pick_email(payload: &Value) -> Option<String> {
    match payload.get("email") {
        Some(Value::String(s)) => Some(s.clone()),
        _ => None,
    }
}

/// Unverified JWT payload decode. Returns `None` if the token is malformed.
fn decode_jwt_unverified(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload_b64 = parts.next()?;
    let _sig = parts.next()?;
    if parts.next().is_some() {
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

/// HS256 verify with jose-equivalent claim checks (`alg`, `exp`, `nbf`, tolerance 0).
fn verify_hs256(token: &str, secret: &str, now_unix_secs: i64) -> Option<Value> {
    let mut parts = token.split('.');
    let header_b64 = parts.next()?;
    let payload_b64 = parts.next()?;
    let sig_b64 = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let header_json = base64url_decode_to_string(header_b64)?;
    let header: Value = serde_json::from_str(&header_json).ok()?;
    match header.get("alg") {
        Some(Value::String(alg)) if alg == "HS256" => {}
        _ => return None,
    }

    let signing_input = format!("{header_b64}.{payload_b64}");
    let expected = hmac_sha256(secret.as_bytes(), signing_input.as_bytes())?;
    let received = base64url_decode(sig_b64)?;
    if !constant_time_eq(&expected, &received) {
        return None;
    }

    let payload_json = base64url_decode_to_string(payload_b64)?;
    let payload: Value = serde_json::from_str(&payload_json).ok()?;
    if !payload.is_object() {
        return None;
    }

    if let Some(exp) = payload.get("exp") {
        let exp = claim_as_i64(exp)?;
        // jose: reject when `exp <= now` (clockTolerance 0).
        if exp <= now_unix_secs {
            return None;
        }
    }
    if let Some(nbf) = payload.get("nbf") {
        let nbf = claim_as_i64(nbf)?;
        // jose: reject when `nbf > now` (clockTolerance 0).
        if nbf > now_unix_secs {
            return None;
        }
    }

    Some(payload)
}

/// Coerce a JWT numeric claim to `i64` (rejects non-numbers).
fn claim_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        _ => None,
    }
}

/// Hand-rolled base64url decode (no new crate — step 8 frozen deps).
fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut std = String::with_capacity(input.len() + 3);
    for ch in input.chars() {
        match ch {
            '-' => std.push('+'),
            '_' => std.push('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => std.push(c),
            '=' => {} // strip; we re-pad
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
fn base64url_decode_to_string(input: &str) -> Option<String> {
    let bytes = base64url_decode(input)?;
    String::from_utf8(bytes).ok()
}

/// Standard base64 decode (padded alphabet `+/`).
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
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        let b2 = bytes[i + 2];
        let b3 = bytes[i + 3];
        let v0 = val(b0)?;
        let v1 = val(b1)?;
        out.push((v0 << 2) | (v1 >> 4));
        if b2 == b'=' {
            if b3 != b'=' {
                return None;
            }
            break;
        }
        let v2 = val(b2)?;
        out.push(((v1 & 0x0f) << 4) | (v2 >> 2));
        if b3 == b'=' {
            break;
        }
        let v3 = val(b3)?;
        out.push(((v2 & 0x03) << 6) | v3);
        i += 4;
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;

    fn b64url(input: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        let mut i = 0;
        while i < input.len() {
            let b0 = input[i];
            let b1 = if i + 1 < input.len() { input[i + 1] } else { 0 };
            let b2 = if i + 2 < input.len() { input[i + 2] } else { 0 };
            out.push(TABLE[(b0 >> 2) as usize] as char);
            out.push(TABLE[(((b0 & 0x03) << 4) | (b1 >> 4)) as usize] as char);
            if i + 1 < input.len() {
                out.push(TABLE[(((b1 & 0x0f) << 2) | (b2 >> 6)) as usize] as char);
            }
            if i + 2 < input.len() {
                out.push(TABLE[(b2 & 0x3f) as usize] as char);
            }
            i += 3;
        }
        out
    }

    fn sign_hs256(payload: &str, secret: &str) -> String {
        let header = b64url(br#"{"alg":"HS256"}"#);
        let body = b64url(payload.as_bytes());
        let signing = format!("{header}.{body}");
        let dig = hmac_sha256(secret.as_bytes(), signing.as_bytes()).expect("hmac");
        format!("{signing}.{}", b64url(&dig))
    }

    #[test]
    fn base64url_roundtrip_padding_and_url_alphabet() {
        let cases: &[&[u8]] = &[
            b"f",
            b"fo",
            b"foo",
            b"foob",
            b"fooba",
            b"foobar",
            b"\xff\xfe",
        ];
        for case in cases {
            let encoded = b64url(case);
            let decoded = base64url_decode(&encoded).unwrap();
            assert_eq!(&decoded, case, "encoded={encoded}");
        }
    }

    #[test]
    fn hs256_accept_and_reject() {
        let secret = "fixture-secret-at-least-32-chars-long!!";
        let token = sign_hs256(r#"{"sub":"u1"}"#, secret);
        let now = 1_700_000_000;
        assert!(verify_hs256(&token, secret, now).is_some());
        assert!(verify_hs256(&token, "wrong-secret-at-least-32-chars-long!!", now).is_none());
    }

    #[test]
    fn exp_nbf_boundaries_at_explicit_clock() {
        let secret = "fixture-secret-at-least-32-chars-long!!";
        let now = 1_000;
        let expired = sign_hs256(r#"{"sub":"u","exp":1000}"#, secret);
        assert!(verify_hs256(&expired, secret, now).is_none());
        let valid_exp = sign_hs256(r#"{"sub":"u","exp":1001}"#, secret);
        assert!(verify_hs256(&valid_exp, secret, now).is_some());
        let future_nbf = sign_hs256(r#"{"sub":"u","nbf":1001}"#, secret);
        assert!(verify_hs256(&future_nbf, secret, now).is_none());
        let ok_nbf = sign_hs256(r#"{"sub":"u","nbf":1000}"#, secret);
        assert!(verify_hs256(&ok_nbf, secret, now).is_some());
    }

    #[test]
    fn name_precedence() {
        let payload = serde_json::json!({
            "user_metadata": { "full_name": "Full", "name": "Meta" },
            "name": "Top"
        });
        assert_eq!(pick_name(&payload).as_deref(), Some("Full"));
    }

    #[test]
    fn error_shape_details_present_vs_absent() {
        let with = unauthorized(DETAILS_MALFORMED);
        let json = serde_json::to_value(&with).unwrap();
        assert_eq!(json["details"], DETAILS_MALFORMED);
        assert_eq!(json["error"], "Unauthorized");
        assert_eq!(json["status"], 401);
    }

    #[test]
    fn header_path_never_401s_on_bad_jwt() {
        let input = AuthResolutionInput {
            header_user_id: Some("mw".into()),
            authorization_header: Some("Bearer not.a.jwt".into()),
            jwt_secret: Some("fixture-secret-at-least-32-chars-long!!".into()),
            strict_mode: false,
            include_email: true,
            include_name: true,
            now_unix_secs: 1_700_000_000,
        };
        let user = resolve_authenticated_user(&input).unwrap();
        assert_eq!(user.user_id, "mw");
        assert_eq!(user.email, None);
        assert_eq!(user.name, None);
        let json = serde_json::to_value(&user).unwrap();
        assert_eq!(json["email"], Value::Null);
        assert_eq!(json["name"], Value::Null);
    }

    #[test]
    fn bearer_casing_and_empty_token() {
        assert!(extract_bearer_token(Some("BEARER abc")).is_some());
        assert!(extract_bearer_token(Some("Bearer    ")).is_none());
    }
}
