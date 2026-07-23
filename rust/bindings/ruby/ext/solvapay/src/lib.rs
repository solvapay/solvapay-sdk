//! Magnus Ruby binding for `solvapay-core` / `solvapay-transport` (Step 44).
//!
//! Rust owns generated envelope functions; Ruby owns public orchestration.
//!
//! # Panic safety
//!
//! Sync FFI edges are wrapped in [`std::panic::catch_unwind`] (§7.6).
//!
//! # Tokio runtime
//!
//! Binding-owned multi-thread runtime (§15 note 3). Blocking client methods
//! release the GVL via [`runtime::without_gvl`].

#![deny(clippy::all)]
// `magnus::init` expands an undocumented `Init_*` entry symbol.
#![allow(missing_docs)]
// `SdkError` is intentionally large (paywall gate); returned by value at the
// envelope boundary rather than `Box<SdkError>` (§4.4).
#![allow(clippy::result_large_err)]
// Magnus signatures pass owned Strings across the FFI.
#![allow(clippy::needless_pass_by_value)]

mod args;
mod client;
mod decisions;
mod error;
mod fixture_host;
mod payload_builders;
mod register;
mod runtime;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{SystemTime, UNIX_EPOCH};

use error::BindingError;
use magnus::method;
use magnus::prelude::*;
use magnus::{function, Error, Exception, Ruby};
use solvapay_core::verify_webhook as core_verify_webhook;

pub use client::SolvaPayClient;

/// Inner pure helper: verifies a webhook and returns the JSON body string.
///
/// Clock is explicit so Rust unit tests can reuse frozen Step-4 fixtures.
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

/// Returns the crate / release-train version string.
fn version() -> String {
    option_env!("SOLVAPAY_RELEASE_VERSION")
        .unwrap_or(env!("CARGO_PKG_VERSION"))
        .to_owned()
}

/// Returns `{version, coreSha}` JSON for §7.7 version stamping diagnostics.
fn native_build_info() -> String {
    let version = option_env!("SOLVAPAY_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
    let core_sha = option_env!("SOLVAPAY_CORE_SHA").unwrap_or("unknown");
    format!(r#"{{"version":"{version}","coreSha":"{core_sha}"}}"#)
}

/// Verifies a SolvaPay webhook signature using the host wall clock.
///
/// Returns the parsed JSON body as a string on success. On failure raises
/// `SolvaPay::Error` whose `code` is the snake_case webhook error code.
///
/// # Errors
///
/// Returns a Magnus [`Error`] when verification fails or the binding panics.
fn verify_webhook(body: String, signature: String, secret: String) -> Result<String, Error> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| BindingError::clock_failed(e.to_string()))?
            .as_secs() as i64;
        verify_webhook_json(&body, &signature, &secret, now)
    }));

    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(err)) => Err(err.into_magnus_err()),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into_magnus_err()),
    }
}

/// Test-only webhook verification with an injected unix-seconds clock.
///
/// # Errors
///
/// Returns a Magnus [`Error`] when verification fails or the binding panics.
fn verify_webhook_at(
    body: String,
    signature: String,
    secret: String,
    now_unix_secs: i64,
) -> Result<String, Error> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        verify_webhook_json(&body, &signature, &secret, now_unix_secs)
    }));
    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(err)) => Err(err.into_magnus_err()),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into_magnus_err()),
    }
}

/// `SolvaPay::Error#code` — returns the snake_case `@code` ivar (or `nil`).
fn error_code(ex: Exception) -> Result<magnus::Value, Error> {
    ex.funcall("instance_variable_get", ("@code",))
}

/// Compiled extension entry point for the `solvapay` gem.
///
/// # Errors
///
/// Propagates Magnus errors from module / class / method registration.
#[magnus::init]
fn init(ruby: &Ruby) -> Result<(), Error> {
    runtime::init();

    let module = ruby.define_module("SolvaPay")?;
    let error_class = module.define_error("Error", ruby.exception_standard_error())?;
    error_class.define_method("code", method!(error_code, 0))?;

    module.define_singleton_method("version", function!(version, 0))?;
    module.define_singleton_method("native_build_info", function!(native_build_info, 0))?;
    module.define_singleton_method("verify_webhook", function!(verify_webhook, 3))?;
    module.define_singleton_method("_verify_webhook_at", function!(verify_webhook_at, 4))?;

    let native = module.define_module("Native")?;
    let client = native.define_class("Client", ruby.class_object())?;
    client.define_singleton_method("new", function!(SolvaPayClient::new, -1))?;
    client.define_singleton_method("_for_fixtures", function!(SolvaPayClient::for_fixtures, -1))?;
    register::register_generated(native, client)?;
    fixture_host::register(native)?;
    let _: magnus::Value = module.funcall("private_constant", ("Native",))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic, missing_docs)]

    use super::verify_webhook_json;
    use crate::client::build_solvapay_client;
    use crate::error::{err_envelope, ok_envelope};
    use serde_json::Value;
    use solvapay_core::SdkError;

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
        let value: Value = serde_json::from_str(&json).expect("json");
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

    #[test]
    fn client_constructs_offline() {
        let client = build_solvapay_client("sk_test_offline".to_owned(), None);
        assert!(client.is_ok(), "build_solvapay_client must succeed offline");
    }

    #[test]
    fn client_constructs_with_base_url() {
        let client = build_solvapay_client(
            "sk_test_offline".to_owned(),
            Some("https://api.example.com".to_owned()),
        );
        assert!(client.is_ok());
    }

    #[test]
    fn ok_and_err_envelope_helpers_round_trip() {
        let ok = ok_envelope(&serde_json::json!({"customerRef": "cus_x"}));
        let parsed: Value = serde_json::from_str(&ok).unwrap();
        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["value"]["customerRef"], "cus_x");

        let err = err_envelope(&SdkError::transport("nope", false));
        let parsed: Value = serde_json::from_str(&err).unwrap();
        assert_eq!(parsed["ok"], false);
        assert_eq!(parsed["error"]["kind"], "Transport");
    }
}
