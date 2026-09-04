//! Fuzz oracles for webhook verification and FFI JSON envelopes (step 55-a).
//!
//! Production paths never panic. Unit tests inject a deliberately-wrong
//! implementation so the oracle is proven to *report* violations, not only to
//! pass against the real core.

#![allow(clippy::missing_docs_in_private_items)]

use std::panic::{catch_unwind, AssertUnwindSafe};

use serde_json::Value;

use crate::envelope::{err_envelope, parse_args_json};
use crate::error::SdkError;
#[cfg(feature = "webhook-verify")]
use crate::webhook::{verify_webhook, WebhookError, WebhookErrorCode};

/// Maximum UTF-8 bytes stored per length-prefixed corpus field.
const MAX_FIELD_BYTES: usize = 1_048_576;

/// Length-prefixed corpus encoding of a webhook fuzz input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebhookFuzzInput {
    /// Raw webhook body.
    pub body: String,
    /// `SV-Signature` header value.
    pub signature: String,
    /// Webhook secret (including `whsec_` when present).
    pub secret: String,
    /// Explicit clock as unix seconds.
    pub now_unix_secs: i64,
}

/// Length-prefixed corpus encoding of an FFI dispatch pair.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnvelopeFuzzInput {
    /// Dispatch operation name (`getMerchant`, unknown ops, …).
    pub op: String,
    /// JSON args string (may be malformed).
    pub args_json: String,
}

/// Why a fuzz oracle rejected an input.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OracleViolation {
    /// The implementation unwound.
    Panicked(String),
    /// Two successive calls disagreed.
    Nondeterministic,
    /// `Ok(value)` was not `serde_json::from_str(body)`.
    OkValueNotBodyJson,
    /// Error code was not one of the five [`WebhookErrorCode`] variants.
    InvalidErrorCode,
    /// Envelope JSON was missing, extra, or contradictory keys.
    MalformedEnvelope(String),
    /// `ok:false` payload was not an [`SdkError`].
    ErrorNotSdkError,
    /// Unknown op did not produce a Transport error envelope.
    UnknownOpNotTransport,
}

/// Result of [`check_webhook_invariants`] / [`check_envelope_invariants_with`].
pub type OracleResult = Result<(), OracleViolation>;

impl WebhookFuzzInput {
    /// Encodes this input as length-prefixed corpus bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        put_str(&mut buf, &self.body);
        put_str(&mut buf, &self.signature);
        put_str(&mut buf, &self.secret);
        buf.extend_from_slice(&self.now_unix_secs.to_le_bytes());
        buf
    }

    /// Decodes length-prefixed corpus bytes.
    ///
    /// Returns [`None`] when the buffer is truncated.
    pub fn decode(data: &[u8]) -> Option<Self> {
        let mut rest = data;
        let body = take_str(&mut rest)?;
        let signature = take_str(&mut rest)?;
        let secret = take_str(&mut rest)?;
        if rest.len() < 8 {
            return None;
        }
        let mut ts_bytes = [0u8; 8];
        ts_bytes.copy_from_slice(&rest[..8]);
        let now_unix_secs = i64::from_le_bytes(ts_bytes);
        Some(Self {
            body,
            signature,
            secret,
            now_unix_secs,
        })
    }
}

impl EnvelopeFuzzInput {
    /// Encodes this input as length-prefixed corpus bytes.
    pub fn encode(&self) -> Vec<u8> {
        let mut buf = Vec::new();
        put_str(&mut buf, &self.op);
        put_str(&mut buf, &self.args_json);
        buf
    }

    /// Decodes length-prefixed corpus bytes.
    ///
    /// Returns [`None`] when the buffer is truncated.
    pub fn decode(data: &[u8]) -> Option<Self> {
        let mut rest = data;
        let op = take_str(&mut rest)?;
        let args_json = take_str(&mut rest)?;
        Some(Self { op, args_json })
    }
}

/// Checks webhook invariants against [`verify_webhook`].
#[cfg(feature = "webhook-verify")]
pub fn check_webhook_invariants(input: &WebhookFuzzInput) -> OracleResult {
    check_webhook_invariants_with(input, |input| {
        verify_webhook(
            &input.body,
            &input.signature,
            &input.secret,
            input.now_unix_secs,
        )
    })
}

/// Checks webhook invariants against an injectable implementation (tests + replay).
#[cfg(feature = "webhook-verify")]
pub fn check_webhook_invariants_with<F>(input: &WebhookFuzzInput, mut verify: F) -> OracleResult
where
    F: FnMut(&WebhookFuzzInput) -> Result<Value, WebhookError>,
{
    let first = match catch_unwind(AssertUnwindSafe(|| verify(input))) {
        Ok(result) => result,
        Err(payload) => return Err(OracleViolation::Panicked(panic_message(payload))),
    };
    let second = match catch_unwind(AssertUnwindSafe(|| verify(input))) {
        Ok(result) => result,
        Err(payload) => return Err(OracleViolation::Panicked(panic_message(payload))),
    };
    if results_differ(&first, &second) {
        return Err(OracleViolation::Nondeterministic);
    }
    match first {
        Ok(value) => match serde_json::from_str::<Value>(&input.body) {
            Ok(parsed) if parsed == value => Ok(()),
            _ => Err(OracleViolation::OkValueNotBodyJson),
        },
        Err(err) => {
            if is_known_webhook_code(err.code) {
                Ok(())
            } else {
                Err(OracleViolation::InvalidErrorCode)
            }
        }
    }
}

/// Checks that `output` is a well-formed success or error envelope.
pub fn check_envelope_output(output: &str) -> OracleResult {
    let value: Value = match serde_json::from_str(output) {
        Ok(v) => v,
        Err(_) => {
            return Err(OracleViolation::MalformedEnvelope(
                "output is not JSON".to_owned(),
            ));
        }
    };
    let obj = match value.as_object() {
        Some(o) => o,
        None => {
            return Err(OracleViolation::MalformedEnvelope(
                "output is not a JSON object".to_owned(),
            ));
        }
    };
    let ok = match obj.get("ok").and_then(Value::as_bool) {
        Some(b) => b,
        None => {
            return Err(OracleViolation::MalformedEnvelope(
                "missing boolean ok".to_owned(),
            ));
        }
    };
    if ok {
        if !obj.contains_key("value") || obj.contains_key("error") {
            return Err(OracleViolation::MalformedEnvelope(
                "ok:true must have value and no error".to_owned(),
            ));
        }
        if obj.len() != 2 {
            return Err(OracleViolation::MalformedEnvelope(
                "ok:true must have exactly keys ok,value".to_owned(),
            ));
        }
        Ok(())
    } else {
        if !obj.contains_key("error") || obj.contains_key("value") {
            return Err(OracleViolation::MalformedEnvelope(
                "ok:false must have error and no value".to_owned(),
            ));
        }
        if obj.len() != 2 {
            return Err(OracleViolation::MalformedEnvelope(
                "ok:false must have exactly keys ok,error".to_owned(),
            ));
        }
        match serde_json::from_value::<SdkError>(obj["error"].clone()) {
            Ok(_) => Ok(()),
            Err(_) => Err(OracleViolation::ErrorNotSdkError),
        }
    }
}

/// Checks envelope invariants for one `(op, args_json)` pair via `produce`.
pub fn check_envelope_invariants_with<F>(op: &str, args_json: &str, mut produce: F) -> OracleResult
where
    F: FnMut(&str, &str) -> String,
{
    let first = match catch_unwind(AssertUnwindSafe(|| produce(op, args_json))) {
        Ok(s) => s,
        Err(payload) => return Err(OracleViolation::Panicked(panic_message(payload))),
    };
    let second = match catch_unwind(AssertUnwindSafe(|| produce(op, args_json))) {
        Ok(s) => s,
        Err(payload) => return Err(OracleViolation::Panicked(panic_message(payload))),
    };
    if first != second {
        return Err(OracleViolation::Nondeterministic);
    }
    check_envelope_output(&first)?;
    if !is_known_op(op) {
        let value: Value = match serde_json::from_str(&first) {
            Ok(v) => v,
            Err(_) => {
                return Err(OracleViolation::MalformedEnvelope(
                    "output is not JSON".to_owned(),
                ));
            }
        };
        let kind = value.get("error").and_then(|e| e.get("kind"));
        if kind != Some(&Value::String("Transport".to_owned())) {
            return Err(OracleViolation::UnknownOpNotTransport);
        }
    }
    // parse_args_json is part of the FFI boundary: it must not panic.
    let _parsed: Result<Value, SdkError> = parse_args_json(args_json);
    Ok(())
}

/// Default envelope producer used when no binding dispatch is available:
/// `parse_args_json` plus a Transport envelope for every op (including the
/// scaffold allowlist name). Real C dispatch is checked from `solvapay-c`.
pub fn check_envelope_invariants(op: &str, args_json: &str) -> OracleResult {
    check_envelope_invariants_with(op, args_json, core_envelope_producer)
}

fn core_envelope_producer(op: &str, args_json: &str) -> String {
    match parse_args_json::<Value>(args_json) {
        Err(err) => err_envelope(&err),
        Ok(_) if is_known_op(op) => {
            err_envelope(&SdkError::transport("core envelope oracle: no http", false))
        }
        Ok(_) => err_envelope(&SdkError::transport(format!("unknown op: {op}"), false)),
    }
}

/// Client ops the C dispatch table (and live-contract invoke table) serve.
/// Unknown names must still be Transport envelopes; known names may fail
/// validation or transport depending on args.
fn is_known_op(op: &str) -> bool {
    matches!(
        op,
        "createCustomer"
            | "updateCustomer"
            | "getCustomer"
            | "assignCredits"
            | "getCustomerBalance"
            | "getUserInfo"
            | "createCheckoutSession"
            | "createCustomerSession"
            | "getMerchant"
            | "getPlatformConfig"
            | "createPaymentIntent"
            | "createTopupPaymentIntent"
            | "processPaymentIntent"
            | "attachBusinessDetails"
            | "activatePlan"
            | "checkLimits"
            | "trackUsage"
            | "trackUsageBulk"
            | "getProduct"
            | "listProducts"
            | "createProduct"
            | "updateProduct"
            | "deleteProduct"
            | "cloneProduct"
            | "bootstrapMcpProduct"
            | "configureMcpPlans"
            | "listPlans"
            | "createPlan"
            | "updatePlan"
            | "deletePlan"
            | "cancelPurchase"
            | "reactivatePurchase"
            | "getPaymentMethod"
            | "getAutoRecharge"
            | "saveAutoRecharge"
            | "disableAutoRecharge"
    )
}

#[cfg(feature = "webhook-verify")]
fn is_known_webhook_code(code: WebhookErrorCode) -> bool {
    matches!(
        code,
        WebhookErrorCode::MissingSignature
            | WebhookErrorCode::MalformedSignature
            | WebhookErrorCode::TimestampTooOld
            | WebhookErrorCode::InvalidSignature
            | WebhookErrorCode::InvalidPayload
    )
}

#[cfg(feature = "webhook-verify")]
fn results_differ(a: &Result<Value, WebhookError>, b: &Result<Value, WebhookError>) -> bool {
    match (a, b) {
        (Ok(x), Ok(y)) => x != y,
        (Err(x), Err(y)) => x != y,
        _ => true,
    }
}

fn panic_message(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "fuzz oracle captured a panic".to_owned()
    }
}

fn put_str(buf: &mut Vec<u8>, s: &str) {
    let bytes = s.as_bytes();
    let n = bytes.len().min(MAX_FIELD_BYTES);
    let len = u32::try_from(n).unwrap_or(0);
    buf.extend_from_slice(&len.to_le_bytes());
    buf.extend_from_slice(&bytes[..n]);
}

fn take_str(rest: &mut &[u8]) -> Option<String> {
    if rest.len() < 4 {
        return None;
    }
    let mut len_bytes = [0u8; 4];
    len_bytes.copy_from_slice(&rest[..4]);
    let len = usize::try_from(u32::from_le_bytes(len_bytes)).unwrap_or(usize::MAX);
    if len > MAX_FIELD_BYTES {
        return None;
    }
    *rest = &rest[4..];
    if rest.len() < len {
        return None;
    }
    let bytes = &rest[..len];
    *rest = &rest[len..];
    Some(String::from_utf8_lossy(bytes).into_owned())
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
    use serde_json::json;

    #[cfg(feature = "webhook-verify")]
    #[test]
    fn webhook_oracle_reports_panic() {
        let input = WebhookFuzzInput {
            body: "{}".to_owned(),
            signature: "t=1,v1=ab".to_owned(),
            secret: "whsec_x".to_owned(),
            now_unix_secs: 1,
        };
        let err = check_webhook_invariants_with(&input, |_| panic!("stub boom")).unwrap_err();
        assert!(matches!(err, OracleViolation::Panicked(msg) if msg.contains("stub boom")));
    }

    #[cfg(feature = "webhook-verify")]
    #[test]
    fn webhook_oracle_reports_wrong_ok_value() {
        let input = WebhookFuzzInput {
            body: r#"{"a":1}"#.to_owned(),
            signature: String::new(),
            secret: String::new(),
            now_unix_secs: 0,
        };
        let err = check_webhook_invariants_with(&input, |_| Ok(json!({"a": 2}))).unwrap_err();
        assert_eq!(err, OracleViolation::OkValueNotBodyJson);
    }

    #[cfg(feature = "webhook-verify")]
    #[test]
    fn webhook_oracle_reports_nondeterministic() {
        let input = WebhookFuzzInput {
            body: "{}".to_owned(),
            signature: String::new(),
            secret: String::new(),
            now_unix_secs: 0,
        };
        let mut n = 0u8;
        let err = check_webhook_invariants_with(&input, |_| {
            n = n.saturating_add(1);
            if n == 1 {
                Err(WebhookError::new(WebhookErrorCode::MissingSignature))
            } else {
                Err(WebhookError::new(WebhookErrorCode::InvalidPayload))
            }
        })
        .unwrap_err();
        assert_eq!(err, OracleViolation::Nondeterministic);
    }

    #[cfg(feature = "webhook-verify")]
    #[test]
    fn webhook_oracle_accepts_real_verify() {
        let input = WebhookFuzzInput {
            body: "not-json".to_owned(),
            signature: String::new(),
            secret: "whsec_x".to_owned(),
            now_unix_secs: 0,
        };
        check_webhook_invariants(&input).expect("empty signature is missing_signature");
    }

    #[cfg(feature = "webhook-verify")]
    #[test]
    fn webhook_round_trip_corpus_bytes() {
        let input = WebhookFuzzInput {
            body: r#"{"type":"x"}"#.to_owned(),
            signature: "t=1,v1=aa".to_owned(),
            secret: "whsec_x".to_owned(),
            now_unix_secs: 42,
        };
        let decoded = WebhookFuzzInput::decode(&input.encode()).expect("round trip");
        assert_eq!(decoded, input);
    }

    #[test]
    fn envelope_oracle_reports_malformed() {
        let err = check_envelope_output("{\"ok\":true}").unwrap_err();
        assert!(matches!(err, OracleViolation::MalformedEnvelope(_)));
    }

    #[test]
    fn envelope_oracle_reports_error_not_sdk() {
        let err = check_envelope_output("{\"ok\":false,\"error\":\"nope\"}").unwrap_err();
        assert_eq!(err, OracleViolation::ErrorNotSdkError);
    }

    #[test]
    fn envelope_oracle_reports_unknown_op_not_transport() {
        let err = check_envelope_invariants_with("noSuchOp", "{}", |_op, _args| {
            json!({"ok": true, "value": 1}).to_string()
        })
        .unwrap_err();
        assert_eq!(err, OracleViolation::UnknownOpNotTransport);
    }

    #[test]
    fn envelope_oracle_accepts_unknown_op_transport() {
        check_envelope_invariants("noSuchOp", "{}").expect("core producer");
    }

    #[test]
    fn envelope_oracle_treats_full_client_surface_as_known() {
        check_envelope_invariants("getCustomer", "{}").expect("known op");
        check_envelope_invariants("disableAutoRecharge", "{}").expect("known op");
    }

    #[test]
    fn envelope_round_trip_corpus_bytes() {
        let input = EnvelopeFuzzInput {
            op: "getMerchant".to_owned(),
            args_json: "{}".to_owned(),
        };
        let decoded = EnvelopeFuzzInput::decode(&input.encode()).expect("round trip");
        assert_eq!(decoded, input);
    }
}
