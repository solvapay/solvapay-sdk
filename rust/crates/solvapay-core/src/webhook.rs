//! Webhook signature verification (§6.1).
//!
//! Pure: clock is an explicit `now_unix_secs` parameter (no timers). HMAC-SHA256
//! over `"{timestamp}.{body}"`, hex-string constant-time compare via `subtle`.

use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;
use solvapay_dto::error_templates::webhook as webhook_messages;
use subtle::ConstantTimeEq;

/// Stable webhook verification error codes (snake_case on the wire).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum WebhookErrorCode {
    /// Signature header was missing or empty.
    MissingSignature,
    /// Signature header could not be parsed (`t=` / `v1=`).
    MalformedSignature,
    /// Timestamp outside the ±300 s tolerance window.
    TimestampTooOld,
    /// HMAC mismatch (including length / non-hex `v1` compared as hex text).
    InvalidSignature,
    /// Body is not valid JSON.
    InvalidPayload,
}

impl WebhookErrorCode {
    /// Returns the snake_case wire string for this code.
    ///
    /// # Returns
    ///
    /// One of `missing_signature`, `malformed_signature`, `timestamp_too_old`,
    /// `invalid_signature`, or `invalid_payload`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::MissingSignature => "missing_signature",
            Self::MalformedSignature => "malformed_signature",
            Self::TimestampTooOld => "timestamp_too_old",
            Self::InvalidSignature => "invalid_signature",
            Self::InvalidPayload => "invalid_payload",
        }
    }
}

/// Thin domain error for webhook verification failures.
///
/// Folds into [`crate::SdkError::Webhook`] via [`From`]; do not build a parallel taxonomy.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookError {
    /// Stable machine-readable code.
    pub code: WebhookErrorCode,
}

impl WebhookError {
    /// Builds a [`WebhookError`] for the given code.
    ///
    /// # Arguments
    ///
    /// * `code` - Stable webhook error code.
    ///
    /// # Returns
    ///
    /// A new [`WebhookError`] wrapping `code`.
    pub fn new(code: WebhookErrorCode) -> Self {
        Self { code }
    }

    /// Returns the frozen human-readable message for this error code.
    ///
    /// Messages are pinned by the golden fixtures and must not change.
    ///
    /// # Returns
    ///
    /// One of the five fixture-pinned message strings.
    pub fn message(&self) -> &'static str {
        match self.code {
            WebhookErrorCode::MissingSignature => webhook_messages::MISSING_SIGNATURE,
            WebhookErrorCode::MalformedSignature => webhook_messages::MALFORMED_SIGNATURE,
            WebhookErrorCode::TimestampTooOld => webhook_messages::TIMESTAMP_TOO_OLD,
            WebhookErrorCode::InvalidSignature => webhook_messages::INVALID_SIGNATURE,
            WebhookErrorCode::InvalidPayload => webhook_messages::INVALID_PAYLOAD,
        }
    }
}

/// Absolute tolerance window in seconds (`|now − t| > 300` → `timestamp_too_old`).
const TOLERANCE_SECS: u64 = 300;

/// Verifies a SolvaPay webhook signature and parses the JSON body (§6.1).
///
/// Steps: parse `t=`/`v1=` header → ±300 s tolerance → HMAC-SHA256 over
/// `"{timestamp}.{body}"` → constant-time hex-string compare → `JSON.parse(body)`.
///
/// # Arguments
///
/// * `body` - Raw request body string (must match the signed bytes).
/// * `signature` - `SV-Signature` header value (`t=…,v1=…`).
/// * `secret` - Webhook secret including the `whsec_` prefix.
/// * `now_unix_secs` - Explicit clock as unix seconds (host-owned; no timers in core).
///
/// # Returns
///
/// Parsed JSON [`serde_json::Value`] on success (typed `WebhookEvent` DTO arrives at step 15).
///
/// # Errors
///
/// Returns [`WebhookError`] with one of the five [`WebhookErrorCode`] values:
/// - [`WebhookErrorCode::MissingSignature`] — empty signature
/// - [`WebhookErrorCode::MalformedSignature`] — missing/empty parts or non-numeric `t`
/// - [`WebhookErrorCode::TimestampTooOld`] — outside ±300 s
/// - [`WebhookErrorCode::InvalidSignature`] — HMAC / length mismatch
/// - [`WebhookErrorCode::InvalidPayload`] — body is not valid JSON
///
/// # Examples
///
/// ```
/// use hmac::{Hmac, KeyInit, Mac};
/// use sha2::Sha256;
/// use solvapay_core::verify_webhook;
///
/// let body = r#"{"type":"purchase.created"}"#;
/// let secret = "whsec_test";
/// let timestamp = 1_000_000_i64;
/// let Ok(mut mac) = Hmac::<Sha256>::new_from_slice(secret.as_bytes()) else {
///     panic!("HMAC-SHA256 accepts any key length");
/// };
/// mac.update(format!("{timestamp}.{body}").as_bytes());
/// let hex: String = mac
///     .finalize()
///     .into_bytes()
///     .iter()
///     .map(|b| format!("{b:02x}"))
///     .collect();
/// let signature = format!("t={timestamp},v1={hex}");
/// let value = verify_webhook(body, &signature, secret, timestamp).unwrap();
/// assert_eq!(value["type"], "purchase.created");
/// ```
pub fn verify_webhook(
    body: &str,
    signature: &str,
    secret: &str,
    now_unix_secs: i64,
) -> Result<serde_json::Value, WebhookError> {
    if signature.is_empty() {
        return Err(WebhookError::new(WebhookErrorCode::MissingSignature));
    }

    let (timestamp, received_hmac) = parse_signature_header(signature)?;

    if now_unix_secs.abs_diff(timestamp) > TOLERANCE_SECS {
        return Err(WebhookError::new(WebhookErrorCode::TimestampTooOld));
    }

    let expected_hmac = compute_hmac_hex(secret, timestamp, body)?;
    if !constant_time_hex_eq(&expected_hmac, received_hmac) {
        return Err(WebhookError::new(WebhookErrorCode::InvalidSignature));
    }

    serde_json::from_str(body).map_err(|_| WebhookError::new(WebhookErrorCode::InvalidPayload))
}

/// Parses `t={unix},v1={hex}` from a comma-separated signature header (§6.1 step 1).
///
/// First matching `t=` / `v1=` part wins (extra comma parts are ignored).
///
/// # Arguments
///
/// * `signature` - Non-empty `SV-Signature` header value.
///
/// # Returns
///
/// `(timestamp, v1_hex_slice)` on success.
///
/// # Errors
///
/// Returns [`WebhookErrorCode::MalformedSignature`] when either part is missing,
/// `v1` is empty, or the timestamp is not parseable via [`parse_int_base10`].
fn parse_signature_header(signature: &str) -> Result<(i64, &str), WebhookError> {
    let mut t_part: Option<&str> = None;
    let mut v1_part: Option<&str> = None;

    for part in signature.split(',') {
        if t_part.is_none() && part.starts_with("t=") {
            t_part = Some(part);
        } else if v1_part.is_none() && part.starts_with("v1=") {
            v1_part = Some(part);
        }
    }

    let (Some(t_raw), Some(v1_raw)) = (t_part, v1_part) else {
        return Err(WebhookError::new(WebhookErrorCode::MalformedSignature));
    };

    let timestamp_str = &t_raw[2..];
    let received_hmac = &v1_raw[3..];
    if received_hmac.is_empty() {
        return Err(WebhookError::new(WebhookErrorCode::MalformedSignature));
    }

    let timestamp = match parse_int_base10(timestamp_str) {
        Some(value) => value,
        None => return Err(WebhookError::new(WebhookErrorCode::MalformedSignature)),
    };

    Ok((timestamp, received_hmac))
}

/// Mirrors JavaScript `parseInt(s, 10)` for webhook timestamps.
///
/// Accepts an optional leading `+`/`-`, then digits; stops at the first non-digit.
/// Returns `None` when there are no digits (JS `NaN`).
///
/// # Arguments
///
/// * `input` - Substring after `t=` in the signature header.
///
/// # Returns
///
/// Parsed `i64` when at least one digit is present; `None` otherwise.
fn parse_int_base10(input: &str) -> Option<i64> {
    let bytes = input.as_bytes();
    if bytes.is_empty() {
        return None;
    }

    let mut index = 0usize;
    let mut negative = false;
    match bytes[0] {
        b'+' => index = 1,
        b'-' => {
            negative = true;
            index = 1;
        }
        _ => {}
    }

    if index >= bytes.len() || !bytes[index].is_ascii_digit() {
        return None;
    }

    let mut value: i64 = 0;
    while index < bytes.len() && bytes[index].is_ascii_digit() {
        let digit = i64::from(bytes[index] - b'0');
        value = value.saturating_mul(10).saturating_add(digit);
        index = index.saturating_add(1);
    }

    Some(if negative { -value } else { value })
}

/// Computes lowercase hex HMAC-SHA256 over `"{timestamp}.{body}"` (§6.1 step 3).
///
/// # Arguments
///
/// * `secret` - Full webhook secret (including `whsec_`).
/// * `timestamp` - Parsed signature timestamp (used as decimal string in the signed payload).
/// * `body` - Raw request body.
///
/// # Returns
///
/// Lowercase hex digest string (64 characters for SHA-256).
///
/// # Errors
///
/// Returns [`WebhookErrorCode::InvalidSignature`] if HMAC key init fails (should not
/// happen for HMAC-SHA256, which accepts any key length — mapped without panic).
fn compute_hmac_hex(secret: &str, timestamp: i64, body: &str) -> Result<String, WebhookError> {
    type HmacSha256 = Hmac<Sha256>;

    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .map_err(|_| WebhookError::new(WebhookErrorCode::InvalidSignature))?;
    let signed = format!("{timestamp}.{body}");
    mac.update(signed.as_bytes());
    Ok(bytes_to_hex_lower(&mac.finalize().into_bytes()))
}

/// Encodes bytes as lowercase hexadecimal (no `hex` crate).
///
/// # Arguments
///
/// * `bytes` - Digest or other binary input.
///
/// # Returns
///
/// Lowercase hex string with two characters per input byte.
fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len().saturating_mul(2));
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Constant-time equality of two hex strings after a length check (§6.1 step 4).
///
/// Matches Node: compare hex UTF-8 bytes with `timingSafeEqual` — never hex-decode,
/// so non-hex `v1` values fail as `invalid_signature`, not malformed.
///
/// # Arguments
///
/// * `expected` - Lowercase hex HMAC computed locally.
/// * `received` - `v1=` value from the signature header.
///
/// # Returns
///
/// `true` when lengths match and bytes are equal under [`ConstantTimeEq`].
fn constant_time_hex_eq(expected: &str, received: &str) -> bool {
    if expected.len() != received.len() {
        return false;
    }
    bool::from(expected.as_bytes().ct_eq(received.as_bytes()))
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

    const SECRET: &str = "whsec_test_fixture_secret";
    const BODY: &str = r#"{"type":"purchase.created","id":"evt_fixture_1"}"#;
    const NOW: i64 = 1_782_864_000;

    fn sign(timestamp: i64, body: &str) -> String {
        let hex = compute_hmac_hex(SECRET, timestamp, body).expect("hmac");
        format!("t={timestamp},v1={hex}")
    }

    #[test]
    fn accept_valid_signature() {
        let signature = sign(NOW, BODY);
        let value = verify_webhook(BODY, &signature, SECRET, NOW).expect("accept");
        assert_eq!(value["type"], "purchase.created");
    }

    #[test]
    fn missing_signature() {
        let err = verify_webhook(BODY, "", SECRET, NOW).expect_err("missing");
        assert_eq!(err.code, WebhookErrorCode::MissingSignature);
        assert_eq!(err.message(), "Missing webhook signature");
    }

    #[test]
    fn malformed_missing_parts() {
        let err = verify_webhook(BODY, "not-a-sig", SECRET, NOW).expect_err("malformed");
        assert_eq!(err.code, WebhookErrorCode::MalformedSignature);
    }

    #[test]
    fn malformed_empty_v1() {
        let err = verify_webhook(BODY, &format!("t={NOW},v1="), SECRET, NOW).expect_err("empty v1");
        assert_eq!(err.code, WebhookErrorCode::MalformedSignature);
    }

    #[test]
    fn malformed_non_numeric_timestamp() {
        let err = verify_webhook(BODY, "t=abc,v1=deadbeef", SECRET, NOW).expect_err("NaN");
        assert_eq!(err.code, WebhookErrorCode::MalformedSignature);
    }

    #[test]
    fn timestamp_too_old_past() {
        let ts = NOW - 301;
        let signature = sign(ts, BODY);
        let err = verify_webhook(BODY, &signature, SECRET, NOW).expect_err("too old");
        assert_eq!(err.code, WebhookErrorCode::TimestampTooOld);
    }

    #[test]
    fn timestamp_too_old_future() {
        let ts = NOW + 301;
        let signature = sign(ts, BODY);
        let err = verify_webhook(BODY, &signature, SECRET, NOW).expect_err("too future");
        assert_eq!(err.code, WebhookErrorCode::TimestampTooOld);
    }

    #[test]
    fn accept_boundary_exactly_300s() {
        let ts = NOW - 300;
        let signature = sign(ts, BODY);
        verify_webhook(BODY, &signature, SECRET, NOW).expect("boundary 300");
    }

    #[test]
    fn accept_boundary_past_299s() {
        let ts = NOW - 299;
        let signature = sign(ts, BODY);
        verify_webhook(BODY, &signature, SECRET, NOW).expect("boundary 299 past");
    }

    #[test]
    fn accept_first_t_and_v1_parts() {
        let hex = compute_hmac_hex(SECRET, NOW, BODY).expect("hmac");
        let signature = format!("t={NOW},v1={hex},t=0,v1=00");
        verify_webhook(BODY, &signature, SECRET, NOW).expect("extra parts");
    }

    #[test]
    fn invalid_signature_wrong_hmac() {
        let signature = format!("t={NOW},v1={}", "ab".repeat(32));
        let err = verify_webhook(BODY, &signature, SECRET, NOW).expect_err("wrong hmac");
        assert_eq!(err.code, WebhookErrorCode::InvalidSignature);
    }

    #[test]
    fn invalid_signature_non_hex_v1() {
        let signature = format!("t={NOW},v1={}", "z".repeat(64));
        let err = verify_webhook(BODY, &signature, SECRET, NOW).expect_err("non-hex");
        assert_eq!(err.code, WebhookErrorCode::InvalidSignature);
    }

    #[test]
    fn invalid_signature_length_mismatch() {
        let signature = format!("t={NOW},v1=abcd");
        let err = verify_webhook(BODY, &signature, SECRET, NOW).expect_err("length");
        assert_eq!(err.code, WebhookErrorCode::InvalidSignature);
    }

    #[test]
    fn invalid_payload_not_json() {
        let body = "not-json";
        let signature = sign(NOW, body);
        let err = verify_webhook(body, &signature, SECRET, NOW).expect_err("payload");
        assert_eq!(err.code, WebhookErrorCode::InvalidPayload);
        assert_eq!(
            err.message(),
            "Invalid webhook payload: body is not valid JSON"
        );
    }

    #[test]
    fn parse_int_base10_mirrors_js() {
        assert_eq!(parse_int_base10("1782864000"), Some(1_782_864_000));
        assert_eq!(parse_int_base10("+42"), Some(42));
        assert_eq!(parse_int_base10("-7"), Some(-7));
        assert_eq!(parse_int_base10("12abc"), Some(12));
        assert_eq!(parse_int_base10("abc"), None);
        assert_eq!(parse_int_base10(""), None);
        assert_eq!(parse_int_base10("-"), None);
        assert_eq!(parse_int_base10("+"), None);
    }

    #[test]
    fn bytes_to_hex_lower_encodes() {
        assert_eq!(bytes_to_hex_lower(&[0x0a, 0xff]), "0aff");
        assert_eq!(bytes_to_hex_lower(&[]), "");
    }

    #[test]
    fn error_code_as_str_snake_case() {
        assert_eq!(
            WebhookErrorCode::MissingSignature.as_str(),
            "missing_signature"
        );
        assert_eq!(
            WebhookErrorCode::MalformedSignature.as_str(),
            "malformed_signature"
        );
        assert_eq!(
            WebhookErrorCode::TimestampTooOld.as_str(),
            "timestamp_too_old"
        );
        assert_eq!(
            WebhookErrorCode::InvalidSignature.as_str(),
            "invalid_signature"
        );
        assert_eq!(WebhookErrorCode::InvalidPayload.as_str(), "invalid_payload");
    }
}
