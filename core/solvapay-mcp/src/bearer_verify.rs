//! MCP OAuth bearer verification (`mcp_verify_bearer`).
//!
//! Pure: takes token + JWKS (or an explicit HS256 secret) + issuer/audience +
//! clock. No HTTP, no env, no timers. Asymmetric crypto is feature-gated
//! (`jwt-verify`) so the browser wasm graph never sees `rsa` / `p256`.

use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Frozen 401 status.
const STATUS_UNAUTHORIZED: u16 = 401;
/// Server profile required (browser / no `jwt-verify`).
#[cfg_attr(feature = "jwt-verify", allow(dead_code))]
const MSG_SERVER_PROFILE: &str = "JWT verification requires the server profile";
/// Neither JWKS nor an explicit HS256 secret was supplied.
#[cfg(feature = "jwt-verify")]
const MSG_MISSING_MATERIAL: &str = "Missing verification material (jwksJson or hs256Secret)";
/// Signature / exp / nbf / alg failure.
#[cfg(feature = "jwt-verify")]
const MSG_INVALID: &str = "Invalid or expired authentication token";
/// Compact JWT did not parse.
#[cfg(feature = "jwt-verify")]
const MSG_MALFORMED: &str = "Malformed authentication token";
/// `iss` did not match.
#[cfg(feature = "jwt-verify")]
const MSG_ISSUER: &str = "Token issuer mismatch";
/// `aud` did not match the resource identifier.
#[cfg(feature = "jwt-verify")]
const MSG_AUDIENCE: &str = "Token audience mismatch";
/// No customer-ref claim after a successful verify.
#[cfg(feature = "jwt-verify")]
const MSG_MISSING_REF: &str = "No customer reference claim found";

/// Input for [`mcp_verify_bearer`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VerifyBearerInput {
    /// Compact JWT (not the `Authorization` header).
    pub token: String,
    /// JWKS document (`{"keys":[...]}`) for RS256 / ES256.
    #[serde(default)]
    pub jwks_json: Option<Value>,
    /// Explicit HS256 secret for local / stub flows. Never inferred.
    #[serde(default)]
    pub hs256_secret: Option<String>,
    /// Required `iss` claim.
    pub expected_issuer: String,
    /// Required `aud` (the MCP resource identifier).
    pub expected_audience: String,
    /// Explicit clock for `exp` / `nbf` (no wall clock in core).
    pub now_unix_secs: i64,
    /// Claim names tried for `customerRef` (default `customerRef`, `customer_ref`, `sub`).
    #[serde(default)]
    pub claim_priority: Option<Vec<String>>,
}

/// Verified claims or a typed 401.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum VerifyBearerResult {
    /// Signature and claim checks passed.
    Ok {
        /// Verified payload object.
        claims: Value,
        /// Customer identity from the claim-priority walk.
        #[serde(rename = "customerRef")]
        customer_ref: String,
    },
    /// Do not trust the token.
    Unauthorized {
        /// HTTP status (401).
        status: u16,
        /// Stable reason string.
        message: String,
    },
}

fn unauthorized(message: &'static str) -> VerifyBearerResult {
    VerifyBearerResult::Unauthorized {
        status: STATUS_UNAUTHORIZED,
        message: message.to_owned(),
    }
}

/// Case-insensitive `bearer ` prefix; empty → none.
#[must_use]
pub fn extract_bearer_token(authorization_header: Option<&str>) -> Option<&str> {
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

/// Walk `customerRef` → `customer_ref` → `sub` (or `claim_priority`).
#[must_use]
pub fn customer_ref_from_claims(
    claims: &Value,
    claim_priority: Option<&[String]>,
) -> Option<String> {
    let default = ["customerRef", "customer_ref", "sub"];
    let owned: Vec<String>;
    let names: Vec<&str> = if let Some(priority) = claim_priority.filter(|p| !p.is_empty()) {
        owned = priority.to_vec();
        owned.iter().map(String::as_str).collect()
    } else {
        default.to_vec()
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

/// Verify an MCP OAuth access token (RS256 / ES256 via JWKS, or explicit HS256).
#[must_use]
pub fn mcp_verify_bearer(input: &VerifyBearerInput) -> VerifyBearerResult {
    #[cfg(not(feature = "jwt-verify"))]
    {
        let _ = input;
        unauthorized(MSG_SERVER_PROFILE)
    }
    #[cfg(feature = "jwt-verify")]
    {
        verify_inner(input)
    }
}

#[cfg(feature = "jwt-verify")]
fn verify_inner(input: &VerifyBearerInput) -> VerifyBearerResult {
    let token = input.token.trim();
    if token.is_empty() {
        return unauthorized(MSG_MALFORMED);
    }
    let has_jwks = input
        .jwks_json
        .as_ref()
        .is_some_and(|v| v.get("keys").and_then(Value::as_array).is_some());
    let secret = input
        .hs256_secret
        .as_deref()
        .map(str::trim)
        .filter(|s| !s.is_empty());
    if !has_jwks && secret.is_none() {
        return unauthorized(MSG_MISSING_MATERIAL);
    }

    let Some(payload) =
        verify_compact(token, input.jwks_json.as_ref(), secret, input.now_unix_secs)
    else {
        return unauthorized(MSG_INVALID);
    };

    if !issuer_matches(&payload, &input.expected_issuer) {
        return unauthorized(MSG_ISSUER);
    }
    if !audience_matches(&payload, &input.expected_audience) {
        return unauthorized(MSG_AUDIENCE);
    }
    let Some(customer_ref) = customer_ref_from_claims(&payload, input.claim_priority.as_deref())
    else {
        return unauthorized(MSG_MISSING_REF);
    };
    VerifyBearerResult::Ok {
        claims: payload,
        customer_ref,
    }
}

#[cfg(feature = "jwt-verify")]
fn issuer_matches(payload: &Value, expected: &str) -> bool {
    payload
        .get("iss")
        .and_then(Value::as_str)
        .is_some_and(|iss| iss == expected)
}

#[cfg(feature = "jwt-verify")]
fn audience_matches(payload: &Value, expected: &str) -> bool {
    match payload.get("aud") {
        Some(Value::String(aud)) => aud == expected,
        Some(Value::Array(items)) => items.iter().any(|item| item.as_str() == Some(expected)),
        _ => false,
    }
}

#[cfg(feature = "jwt-verify")]
fn verify_compact(
    token: &str,
    jwks: Option<&Value>,
    hs256_secret: Option<&str>,
    now_unix_secs: i64,
) -> Option<Value> {
    let mut parts = token.split('.');
    let header_b64 = parts.next()?;
    let payload_b64 = parts.next()?;
    let sig_b64 = parts.next()?;
    if parts.next().is_some() {
        return None;
    }

    let header_json = base64url_decode_to_string(header_b64)?;
    let header: Value = serde_json::from_str(&header_json).ok()?;
    let alg = header.get("alg").and_then(Value::as_str)?;
    if alg.eq_ignore_ascii_case("none") {
        return None;
    }

    let signing_input = format!("{header_b64}.{payload_b64}");
    let sig = base64url_decode(sig_b64)?;

    match alg {
        "HS256" => {
            let secret = hs256_secret?;
            let expected = hmac_sha256(secret.as_bytes(), signing_input.as_bytes())?;
            if !constant_time_eq(&expected, &sig) {
                return None;
            }
        }
        "RS256" => {
            verify_rs256(
                jwks?,
                header.get("kid").and_then(Value::as_str),
                signing_input.as_bytes(),
                &sig,
            )?;
        }
        "ES256" => {
            verify_es256(
                jwks?,
                header.get("kid").and_then(Value::as_str),
                signing_input.as_bytes(),
                &sig,
            )?;
        }
        _ => return None,
    }

    let payload_json = base64url_decode_to_string(payload_b64)?;
    let payload: Value = serde_json::from_str(&payload_json).ok()?;
    if !payload.is_object() {
        return None;
    }
    let exp = payload.get("exp").and_then(claim_as_i64)?;
    if exp <= now_unix_secs {
        return None;
    }
    if let Some(nbf) = payload.get("nbf") {
        let nbf = claim_as_i64(nbf)?;
        if nbf > now_unix_secs {
            return None;
        }
    }
    Some(payload)
}

#[cfg(feature = "jwt-verify")]
fn hmac_sha256(key: &[u8], message: &[u8]) -> Option<[u8; 32]> {
    use hmac::{Hmac, KeyInit, Mac};
    use sha2::Sha256;
    type HmacSha256 = Hmac<Sha256>;
    let mut mac = HmacSha256::new_from_slice(key).ok()?;
    mac.update(message);
    let bytes = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Some(out)
}

#[cfg(feature = "jwt-verify")]
fn constant_time_eq(expected: &[u8], received: &[u8]) -> bool {
    use subtle::ConstantTimeEq;
    if expected.len() != received.len() {
        return false;
    }
    bool::from(expected.ct_eq(received))
}

#[cfg(feature = "jwt-verify")]
fn jwk_candidates<'a>(jwks: &'a Value, kid: Option<&str>, kty: &str) -> Vec<&'a Value> {
    let Some(keys) = jwks.get("keys").and_then(Value::as_array) else {
        return Vec::new();
    };
    keys.iter()
        .filter(|key| key.get("kty").and_then(Value::as_str) == Some(kty))
        .filter(|key| match kid {
            Some(kid) => key.get("kid").and_then(Value::as_str) == Some(kid),
            None => true,
        })
        .collect()
}

#[cfg(feature = "jwt-verify")]
fn verify_rs256(jwks: &Value, kid: Option<&str>, signing_input: &[u8], sig: &[u8]) -> Option<()> {
    use rsa::pkcs1v15::{Signature, VerifyingKey};
    use rsa::signature::Verifier;
    use rsa::{BigUint, RsaPublicKey};
    use sha2_rsa::Sha256;

    let signature = Signature::try_from(sig).ok()?;
    for key in jwk_candidates(jwks, kid, "RSA") {
        let n = BigUint::from_bytes_be(&base64url_decode(key.get("n").and_then(Value::as_str)?)?);
        let e = BigUint::from_bytes_be(&base64url_decode(key.get("e").and_then(Value::as_str)?)?);
        let Ok(pubkey) = RsaPublicKey::new(n, e) else {
            continue;
        };
        let vk = VerifyingKey::<Sha256>::new(pubkey);
        if vk.verify(signing_input, &signature).is_ok() {
            return Some(());
        }
    }
    None
}

#[cfg(feature = "jwt-verify")]
fn verify_es256(jwks: &Value, kid: Option<&str>, signing_input: &[u8], sig: &[u8]) -> Option<()> {
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::{Signature, VerifyingKey};
    use p256::EncodedPoint;
    use p256::FieldBytes;

    if sig.len() != 64 {
        return None;
    }
    let signature = Signature::from_slice(sig).ok()?;
    for key in jwk_candidates(jwks, kid, "EC") {
        if key.get("crv").and_then(Value::as_str) != Some("P-256") {
            continue;
        }
        let x = base64url_decode(key.get("x").and_then(Value::as_str)?)?;
        let y = base64url_decode(key.get("y").and_then(Value::as_str)?)?;
        if x.len() != 32 || y.len() != 32 {
            continue;
        }
        let x_arr: [u8; 32] = x.try_into().ok()?;
        let y_arr: [u8; 32] = y.try_into().ok()?;
        let x = FieldBytes::from(x_arr);
        let y = FieldBytes::from(y_arr);
        let point = EncodedPoint::from_affine_coordinates(&x, &y, false);
        let Ok(vk) = VerifyingKey::from_encoded_point(&point) else {
            continue;
        };
        if vk.verify(signing_input, &signature).is_ok() {
            return Some(());
        }
    }
    None
}

#[cfg(feature = "jwt-verify")]
fn claim_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        _ => None,
    }
}

#[cfg(feature = "jwt-verify")]
fn base64url_decode(input: &str) -> Option<Vec<u8>> {
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

#[cfg(feature = "jwt-verify")]
fn base64url_decode_to_string(input: &str) -> Option<String> {
    String::from_utf8(base64url_decode(input)?).ok()
}

#[cfg(feature = "jwt-verify")]
fn decode_standard_base64(input: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
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
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    const HS256_SECRET: &str = "solvapay-mcp-fixture-hs256-secret-32b!!";
    const HS256_MCP: &str = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMSIsImlzcyI6Imh0dHBzOi8vbWNwLmV4YW1wbGUuY29tIiwiYXVkIjoiaHR0cHM6Ly9tY3AuZXhhbXBsZS5jb20iLCJleHAiOjQxMDI0NDQ4MDB9.FuGJM6mAh6TgYiVB7tI5y4ctnGYQOqGUozKIuiQztDA";
    const NOW: i64 = 1_700_000_000;

    fn input(token: &str) -> VerifyBearerInput {
        VerifyBearerInput {
            token: token.to_owned(),
            jwks_json: None,
            hs256_secret: Some(HS256_SECRET.to_owned()),
            expected_issuer: "https://mcp.example.com".into(),
            expected_audience: "https://mcp.example.com".into(),
            now_unix_secs: NOW,
            claim_priority: None,
        }
    }

    #[test]
    fn hs256_accepts_valid_token() {
        let result = mcp_verify_bearer(&input(HS256_MCP));
        match result {
            VerifyBearerResult::Ok { customer_ref, .. } => assert_eq!(customer_ref, "cus_1"),
            other => panic!("expected ok, got {other:?}"),
        }
    }

    #[test]
    fn rejects_alg_none() {
        let none = "eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9.";
        match mcp_verify_bearer(&input(none)) {
            VerifyBearerResult::Unauthorized { message, .. } => assert_eq!(message, MSG_INVALID),
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn rejects_missing_material() {
        let mut inp = input(HS256_MCP);
        inp.hs256_secret = None;
        match mcp_verify_bearer(&inp) {
            VerifyBearerResult::Unauthorized { message, .. } => {
                assert_eq!(message, MSG_MISSING_MATERIAL)
            }
            other => panic!("{other:?}"),
        }
    }
}
