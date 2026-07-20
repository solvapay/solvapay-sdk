//! napi-rs Node binding for `solvapay-core` (Phase 6 step 36 scaffold).
//!
//! Minimal smoke surface: [`napi_version`] + [`verify_webhook`]. Full client
//! methods arrive in step 37.
//!
//! # Panic safety
//!
//! Every FFI edge is wrapped in [`std::panic::catch_unwind`] (§7.6) so a panic
//! becomes a mapped JS Error and never unwinds across the language boundary.
//!
//! # Tokio runtime
//!
//! Uses napi-rs's built-in shared multi-thread tokio runtime (`tokio_rt` feature
//! — per-addon, not per-process). Safe under Node `worker_threads` because each
//! addon instance owns its runtime. Async client methods (step 37) will exercise
//! this; the sync smoke path does not.

#![deny(clippy::all)]
// #[napi] macro expansion can emit patterns that trip workspace denies; keep
// allows narrowly scoped to this binding crate's generated surface (§4.4).
#![allow(clippy::needless_pass_by_value)]

mod error;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{SystemTime, UNIX_EPOCH};

use error::BindingError;
use napi::bindgen_prelude::*;
use napi_derive::napi;
use solvapay_core::verify_webhook as core_verify_webhook;

/// Inner pure helper: verifies a webhook and returns the JSON body string.
///
/// Clock is explicit so Rust unit tests can reuse frozen Step-4 fixtures.
///
/// # Arguments
///
/// * `body` - Raw request body string.
/// * `signature` - `SV-Signature` header value.
/// * `secret` - Webhook secret (`whsec_…`).
/// * `now_unix_secs` - Host clock as unix seconds.
///
/// # Errors
///
/// Returns [`BindingError`] with a stable `code` on verification or serialize failure.
pub fn verify_webhook_json(
    body: &str,
    signature: &str,
    secret: &str,
    now_unix_secs: i64,
) -> std::result::Result<String, BindingError> {
    let value = core_verify_webhook(body, signature, secret, now_unix_secs)
        .map_err(BindingError::from_webhook)?;
    serde_json::to_string(&value).map_err(|e| BindingError::serialize_failed(e.to_string()))
}

/// Returns the crate version string (`CARGO_PKG_VERSION`).
///
/// Used as a hello-world smoke export proving the native addon loads.
#[napi(js_name = "napiVersion")]
pub fn napi_version() -> Result<String> {
    match catch_unwind(|| env!("CARGO_PKG_VERSION").to_owned()) {
        Ok(version) => Ok(version),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into()),
    }
}

/// Verifies a SolvaPay webhook signature using the host wall clock.
///
/// Returns the parsed JSON body as a string on success. On failure throws a JS
/// `Error` whose `code` is the snake_case webhook error code (via napi
/// `Error.status` → JS `Error.code`).
///
/// # Arguments
///
/// * `body` - Raw request body string.
/// * `signature` - `SV-Signature` header value.
/// * `secret` - Webhook secret (`whsec_…`).
#[napi(js_name = "verifyWebhook")]
pub fn verify_webhook(
    body: String,
    signature: String,
    secret: String,
) -> std::result::Result<String, Error<&'static str>> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| BindingError::clock_failed(e.to_string()))?
            .as_secs() as i64;
        verify_webhook_json(&body, &signature, &secret, now)
    }));

    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(err)) => Err(err.into_napi()),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into_napi()),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]

    use super::verify_webhook_json;

    /// Frozen Step-4 accept fixture (clock `2026-07-01T00:00:00Z` = 1782864000).
    const FIXTURE_BODY: &str = concat!(
        r#"{"type":"purchase.created","id":"evt_fixture_1","created":1782864000,"#,
        r#""api_version":"2025-10-01","data":{"object":{"id":"pur_fixture_1"},"#,
        r#""previous_attributes":null},"livemode":false,"request":{"id":null,"#,
        r#""idempotency_key":null}}"#
    );
    const FIXTURE_SECRET: &str = "whsec_test_fixture_secret";
    const FIXTURE_SIGNATURE: &str =
        "t=1782864000,v1=04834cba2241fe998a4fb5b8bb4632b2c2e18a3e330dba1905f62b365521ca82";
    const FIXTURE_NOW: i64 = 1_782_864_000;

    #[test]
    fn verify_webhook_json_accepts_known_fixture() {
        let json =
            verify_webhook_json(FIXTURE_BODY, FIXTURE_SIGNATURE, FIXTURE_SECRET, FIXTURE_NOW)
                .expect("accept fixture must verify");
        let value: serde_json::Value = serde_json::from_str(&json).expect("json");
        assert_eq!(value["type"], "purchase.created");
        assert_eq!(value["id"], "evt_fixture_1");
    }

    #[test]
    fn verify_webhook_json_rejects_bad_signature() {
        let bad_sig =
            "t=1782864000,v1=ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff";
        let err = verify_webhook_json(FIXTURE_BODY, bad_sig, FIXTURE_SECRET, FIXTURE_NOW)
            .expect_err("bad hmac must reject");
        assert_eq!(err.code(), "invalid_signature");
    }
}
