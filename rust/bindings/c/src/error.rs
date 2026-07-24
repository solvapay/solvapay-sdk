//! JSON-envelope helpers for the native C ABI (Step 54).
//!
//! Domain errors never unwind across the FFI — they serialize into
//! `{"ok":false,"error":<SdkError JSON>}`. Panics map to a Transport
//! `internal_error`-style envelope (§7.6 / §15 note 32).

use std::panic::AssertUnwindSafe;

use serde::Serialize;
use serde_json::json;
use solvapay_core::SdkError;

/// Success envelope: `{"ok":true,"value":…}`.
///
/// Serialization failure becomes an error envelope (never panics).
pub fn ok_envelope<T: Serialize>(value: &T) -> String {
    match serde_json::to_value(value) {
        Ok(v) => json!({ "ok": true, "value": v }).to_string(),
        Err(err) => internal_error_envelope(format!("serialize success value: {err}")),
    }
}

/// Failure envelope: `{"ok":false,"error":<SdkError JSON>}`.
///
/// Serialization failure becomes a Transport envelope (never panics).
pub fn err_envelope(err: &SdkError) -> String {
    match serde_json::to_value(err) {
        Ok(error) => json!({ "ok": false, "error": error }).to_string(),
        Err(ser_err) => internal_error_envelope(format!("serialize SdkError: {ser_err}")),
    }
}

/// Panic / internal failure envelope as `SdkError::Transport` (non-retryable).
pub fn internal_error_envelope(message: impl Into<String>) -> String {
    err_envelope(&SdkError::transport(message.into(), false))
}

/// Maps a catch_unwind panic payload to an envelope string.
pub fn envelope_from_panic_payload(payload: Box<dyn std::any::Any + Send>) -> String {
    let message = if let Some(s) = payload.downcast_ref::<&str>() {
        (*s).to_owned()
    } else if let Some(s) = payload.downcast_ref::<String>() {
        s.clone()
    } else {
        "native binding panicked".to_owned()
    };
    internal_error_envelope(message)
}

/// Parses a JSON object string into `T`, mapping failures to [`SdkError::Transport`].
///
/// # Errors
///
/// Returns [`SdkError::Transport`] (non-retryable) when `args_json` is not valid JSON for `T`.
pub fn parse_args_json<T: serde::de::DeserializeOwned>(args_json: &str) -> Result<T, SdkError> {
    serde_json::from_str(args_json)
        .map_err(|err| SdkError::transport(format!("invalid args JSON: {err}"), false))
}

/// Runs a sync pure-core call and returns a JSON envelope string.
///
/// Catches panics (§7.6) and maps [`SdkError`] to an error envelope.
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError> + std::panic::UnwindSafe,
{
    match std::panic::catch_unwind(AssertUnwindSafe(f)) {
        Ok(Ok(value)) => ok_envelope(&value),
        Ok(Err(err)) => err_envelope(&err),
        Err(payload) => envelope_from_panic_payload(payload),
    }
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use serde_json::Value;
    use solvapay_core::{PaywallGate, PaywallGateKind};

    fn parse_envelope(json: &str) -> Value {
        serde_json::from_str(json).expect("envelope must be JSON")
    }

    #[test]
    fn ok_envelope_wraps_value() {
        let env = parse_envelope(&ok_envelope(&json!({"customerRef": "cus_1"})));
        assert_eq!(env["ok"], true);
        assert_eq!(env["value"]["customerRef"], "cus_1");
    }

    #[test]
    fn err_envelope_api_with_status() {
        let err = SdkError::Api {
            message: "Create customer failed (400): bad".to_owned(),
            status: Some(400),
            code: None,
        };
        let env = parse_envelope(&err_envelope(&err));
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Api");
        assert_eq!(env["error"]["message"], "Create customer failed (400): bad");
        assert_eq!(env["error"]["status"], 400);
        assert!(env["error"]["code"].is_null());
    }

    #[test]
    fn err_envelope_api_without_status() {
        let err = SdkError::Api {
            message: "One of customerRef, externalRef, or email must be provided".to_owned(),
            status: None,
            code: None,
        };
        let env = parse_envelope(&err_envelope(&err));
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Api");
        assert!(env["error"]["status"].is_null());
    }

    #[test]
    fn err_envelope_paywall_gate_rides_through() {
        let gate = PaywallGate {
            kind: PaywallGateKind::PaymentRequired,
            product: "prod_1".to_owned(),
            checkout_url: "https://checkout.example/x".to_owned(),
            message: "Payment required".to_owned(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
        };
        let err = SdkError::paywall("Payment required", gate);
        let env = parse_envelope(&err_envelope(&err));
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Paywall");
        assert_eq!(env["error"]["message"], "Payment required");
        assert_eq!(env["error"]["gate"]["kind"], "payment_required");
        assert_eq!(env["error"]["gate"]["product"], "prod_1");
        assert_eq!(
            env["error"]["gate"]["checkoutUrl"],
            "https://checkout.example/x"
        );
    }

    #[test]
    fn err_envelope_transport() {
        let err = SdkError::transport("connection reset", true);
        let env = parse_envelope(&err_envelope(&err));
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Transport");
        assert_eq!(env["error"]["message"], "connection reset");
        assert_eq!(env["error"]["retryable"], true);
    }

    #[test]
    fn panic_payload_maps_to_internal_error_envelope() {
        let payload: Box<dyn std::any::Any + Send> = Box::new("boom");
        let env = parse_envelope(&envelope_from_panic_payload(payload));
        assert_eq!(env["ok"], false);
        assert_eq!(env["error"]["kind"], "Transport");
        assert_eq!(env["error"]["message"], "boom");
        assert_eq!(env["error"]["retryable"], false);
    }

    #[test]
    fn run_envelope_sync_wraps_ok_err_and_panic() {
        let ok = parse_envelope(&run_envelope_sync(|| Ok::<_, SdkError>(json!({"x": 1}))));
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["value"]["x"], 1);

        let err = parse_envelope(&run_envelope_sync(|| {
            Err::<Value, _>(SdkError::transport("nope", false))
        }));
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["kind"], "Transport");
        assert_eq!(err["error"]["message"], "nope");

        let panicked = parse_envelope(&run_envelope_sync(|| -> Result<Value, SdkError> {
            panic!("sync boom");
        }));
        assert_eq!(panicked["ok"], false);
        assert_eq!(panicked["error"]["kind"], "Transport");
        assert_eq!(panicked["error"]["message"], "sync boom");
        assert_eq!(panicked["error"]["retryable"], false);
    }
}
