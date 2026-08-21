//! wasm-bindgen binding for `solvapay-core` / `solvapay-transport` (Phase 6
//! steps 38 / 38R).
//!
//! Profiles (exactly one required):
//! - `edge`: full server surface — [`wasm_version`] + [`verify_webhook`], sync
//!   decision / paywall / retry JSON envelopes ([`decisions`]), sync core + MCP
//!   payload builders ([`payload_builders`]), and the async
//!   [`wasm_client::WasmClient`] Groups A–C methods over `FetchTransport`.
//! - `browser`: public-safe pure surface only — [`wasm_version`] + the
//!   business-details / credit-display / seller-identity subset of
//!   [`payload_builders`]. No webhook, no secret-key client, no MCP symbols.
//!
//! # Panic safety
//!
//! The `wasm-release` profile sets `panic = "abort"`. Recoverable unwinding across
//! the JS boundary is therefore unavailable; prevention and Clippy
//! `unwrap_used` / `expect_used` / `panic` denies are the primary safety
//! mechanism (§7.6). Sync envelope edges only map `Result` (no `catch_unwind`).
//! Native `rlib` unit tests of pure helpers may still use `catch_unwind` where
//! the host allows it.

#![deny(clippy::all)]
// `SdkError` is intentionally large (paywall gate payload); returned by value at
// the envelope boundary rather than `Box<SdkError>` (§4.4).
#![allow(clippy::result_large_err)]

#[cfg(all(feature = "edge", feature = "browser"))]
compile_error!("solvapay-wasm: enable exactly one of features `edge` or `browser`, not both");

#[cfg(not(any(feature = "edge", feature = "browser")))]
compile_error!("solvapay-wasm: enable exactly one of features `edge` or `browser`");

mod args;
mod error;
pub mod payload_builders;

#[cfg(feature = "edge")]
pub mod decisions;
#[cfg(all(feature = "edge", target_arch = "wasm32"))]
mod wasm_client;

use wasm_bindgen::prelude::*;

/// Returns the crate version string (`CARGO_PKG_VERSION`).
///
/// Used as a hello-world smoke export proving the WASM module loads under both
/// edge and browser profiles.
#[wasm_bindgen(js_name = wasmVersion)]
pub fn wasm_version() -> String {
    env!("CARGO_PKG_VERSION").to_owned()
}

/// Edge-only wasm-bindgen exports (`verifyWebhook`).
#[cfg(feature = "edge")]
mod edge_api {
    use super::error::BindingError;
    use solvapay_core::verify_webhook as core_verify_webhook;
    use wasm_bindgen::prelude::*;

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
    ) -> Result<String, BindingError> {
        let value = core_verify_webhook(body, signature, secret, now_unix_secs)
            .map_err(BindingError::from_webhook)?;
        serde_json::to_string(&value).map_err(|e| BindingError::serialize_failed(e.to_string()))
    }

    /// Verifies a SolvaPay webhook signature with an explicit clock.
    ///
    /// Returns the parsed JSON body as a string on success. On failure throws a JS
    /// `Error` whose `code` is the snake_case webhook error code.
    ///
    /// # Arguments
    ///
    /// * `body` - Raw request body string.
    /// * `signature` - `SV-Signature` header value.
    /// * `secret` - Webhook secret (`whsec_…`).
    /// * `now_unix_secs` - Host clock as unix seconds (typically `Math.floor(Date.now()/1000)`).
    ///   Accepted as `f64` so the JS binding stays a Number (wasm-bindgen maps `i64` to BigInt).
    #[wasm_bindgen(js_name = verifyWebhook)]
    pub fn verify_webhook(
        body: &str,
        signature: &str,
        secret: &str,
        now_unix_secs: f64,
    ) -> Result<String, JsValue> {
        verify_webhook_json(body, signature, secret, now_unix_secs as i64)
            .map_err(BindingError::into_js)
    }
}

#[cfg(feature = "edge")]
pub use edge_api::{verify_webhook, verify_webhook_json};

#[cfg(all(feature = "edge", target_arch = "wasm32"))]
pub use wasm_client::WasmClient;

#[cfg(test)]
#[cfg(feature = "edge")]
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
        assert_eq!(err.message(), "Invalid webhook signature");
    }

    #[test]
    fn verify_webhook_json_rejects_invalid_payload() {
        // Valid HMAC over non-JSON body at frozen clock (precomputed).
        const SIG: &str =
            "t=1782864000,v1=2af781f2f109fb7c235499b4e6eee2ebf683c6fb8b8c4d4c93649be5600cda54";
        let err = verify_webhook_json("not-json", SIG, FIXTURE_SECRET, FIXTURE_NOW)
            .expect_err("non-json body must reject");
        assert_eq!(err.code(), "invalid_payload");
        assert_eq!(
            err.message(),
            "Invalid webhook payload: body is not valid JSON"
        );
    }
}
