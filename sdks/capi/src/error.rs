//! JSON-envelope helpers for the native C ABI (Step 54).
//!
//! Re-exports [`solvapay_core`] envelope helpers so the C fuzz target covers
//! the same boundary as every other binding.

use serde::Serialize;
use solvapay_core::SdkError;

pub use solvapay_core::{
    envelope_from_panic_payload, err_envelope, internal_error_envelope, ok_envelope,
    parse_args_json, run_envelope_sync,
};

/// Awaits an async client call and returns a JSON envelope string.
pub async fn run_envelope<T, Fut>(fut: Fut) -> String
where
    T: Serialize,
    Fut: std::future::Future<Output = Result<T, SdkError>>,
{
    match fut.await {
        Ok(value) => ok_envelope(&value),
        Err(err) => err_envelope(&err),
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
    use serde_json::{json, Value};
    use solvapay_core::{PaywallGate, PaywallGateKind, SdkError};

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

    #[test]
    fn run_envelope_wraps_ok_and_err() {
        let ok = parse_envelope(&crate::runtime::runtime().block_on(run_envelope(async {
            Ok::<_, SdkError>(json!({"x": 1}))
        })));
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["value"]["x"], 1);

        let err = parse_envelope(&crate::runtime::runtime().block_on(run_envelope(async {
            Err::<Value, _>(SdkError::transport("nope", false))
        })));
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["kind"], "Transport");
        assert_eq!(err["error"]["message"], "nope");
    }
}
