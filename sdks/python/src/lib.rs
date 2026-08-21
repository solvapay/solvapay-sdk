//! PyO3 Python binding for `solvapay-core` / `solvapay-transport` (Step 41/42).
//!
//! Surface: sync [`version`] + [`verify_webhook`], generated sync decision /
//! paywall / retry / payload-builder JSON envelopes, plus async
//! [`client::SolvaPayClient`] Groups A–C methods (`future_into_py`) and their
//! blocking twins (interpreter detached).
//!
//! # Panic safety
//!
//! Sync FFI edges are wrapped in [`std::panic::catch_unwind`] (§7.6). Async /
//! blocking client methods return envelope strings for domain errors; panics
//! during sync prep map to Transport envelopes via
//! [`error::envelope_from_panic_payload`].
//!
//! # Tokio runtime
//!
//! Binding-owned multi-thread runtime via `pyo3-async-runtimes` (§15 note 2).
//! Modules stay on PyO3 0.28's default thread-safe declaration (no
//! `gil_used = true` opt-out) after a lock-light core audit.

#![deny(clippy::all)]
// `SdkError` is intentionally large (paywall gate); returned by value at the
// envelope boundary rather than `Box<SdkError>` (§4.4).
#![allow(clippy::result_large_err)]
// PyO3 / pyo3-async-runtimes signatures pass owned Strings across the FFI.
#![allow(clippy::needless_pass_by_value)]

mod args;
mod client;
pub mod decisions;
mod error;
mod fixture_host;
pub mod payload_builders;
mod register;
mod runtime;

use std::panic::{catch_unwind, AssertUnwindSafe};
use std::time::{SystemTime, UNIX_EPOCH};

use error::{BindingError, SolvaPayError};
use pyo3::prelude::*;
use solvapay_core::verify_webhook as core_verify_webhook;

pub use client::SolvaPayClient;

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

/// Returns the crate / release-train version string.
///
/// Prefers `SOLVAPAY_RELEASE_VERSION` (set by the publish workflow) and falls
/// back to `CARGO_PKG_VERSION`.
#[pyfunction]
fn version() -> PyResult<String> {
    match catch_unwind(|| {
        option_env!("SOLVAPAY_RELEASE_VERSION")
            .unwrap_or(env!("CARGO_PKG_VERSION"))
            .to_owned()
    }) {
        Ok(version) => Ok(version),
        Err(payload) => {
            Python::attach(|py| Err(BindingError::from_panic_payload(payload).into_py_err(py)))
        }
    }
}

/// Returns `{version, coreSha}` JSON for §7.7 version stamping diagnostics.
#[pyfunction]
fn native_build_info() -> PyResult<String> {
    match catch_unwind(|| {
        let version = option_env!("SOLVAPAY_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
        let core_sha = option_env!("SOLVAPAY_CORE_SHA").unwrap_or("unknown");
        format!(r#"{{"version":"{version}","coreSha":"{core_sha}"}}"#)
    }) {
        Ok(info) => Ok(info),
        Err(payload) => {
            Python::attach(|py| Err(BindingError::from_panic_payload(payload).into_py_err(py)))
        }
    }
}

/// Verifies a SolvaPay webhook signature using the host wall clock.
///
/// Returns the parsed JSON body as a string on success. On failure raises
/// [`SolvaPayError`] whose `code` is the snake_case webhook error code.
///
/// # Arguments
///
/// * `body` - Raw request body string.
/// * `signature` - `SV-Signature` header value.
/// * `secret` - Webhook secret (`whsec_…`).
#[pyfunction]
fn verify_webhook(
    py: Python<'_>,
    body: String,
    signature: String,
    secret: String,
) -> PyResult<String> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|e| BindingError::clock_failed(e.to_string()))?
            .as_secs() as i64;
        verify_webhook_json(&body, &signature, &secret, now)
    }));

    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(err)) => Err(err.into_py_err(py)),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into_py_err(py)),
    }
}

/// Test-only webhook verification with an injected unix-seconds clock (Step 42).
///
/// Used by the offline golden-fixture suite so frozen `input.clock` values replay
/// deterministically. Not part of the public idiomatic facade.
#[pyfunction]
fn _verify_webhook_at(
    py: Python<'_>,
    body: String,
    signature: String,
    secret: String,
    now_unix_secs: i64,
) -> PyResult<String> {
    let result = catch_unwind(AssertUnwindSafe(|| {
        verify_webhook_json(&body, &signature, &secret, now_unix_secs)
    }));
    match result {
        Ok(Ok(json)) => Ok(json),
        Ok(Err(err)) => Err(err.into_py_err(py)),
        Err(payload) => Err(BindingError::from_panic_payload(payload).into_py_err(py)),
    }
}

/// Compiled extension module `solvapay._solvapay`.
///
/// Default thread-safe (no `gil_used = true` opt-out) — core is lock-light
/// (§15 note 2 / Step 40 audit).
#[pymodule]
fn _solvapay(m: &Bound<'_, PyModule>) -> PyResult<()> {
    runtime::init();
    m.add_class::<SolvaPayClient>()?;
    m.add("SolvaPayError", m.py().get_type::<SolvaPayError>())?;
    m.add_function(wrap_pyfunction!(version, m)?)?;
    m.add_function(wrap_pyfunction!(native_build_info, m)?)?;
    m.add_function(wrap_pyfunction!(verify_webhook, m)?)?;
    m.add_function(wrap_pyfunction!(_verify_webhook_at, m)?)?;
    register::register_generated(m)?;
    fixture_host::register(m)?;
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

    #[test]
    fn classify_customer_ref_decision_envelope_round_trips() {
        let env = crate::decisions::classify_customer_ref_binding(
            r#"{"customerRef":"cus_abc123"}"#.to_owned(),
        );
        let parsed: Value = serde_json::from_str(&env).unwrap();
        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["value"], "backend");
    }
}
