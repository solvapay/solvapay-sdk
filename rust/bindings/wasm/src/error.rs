//! Binding error surface: webhook JS throws + JSON-envelope helpers (Step 38R-a).
//!
//! Mirrors `rust/bindings/node/src/error.rs` for the wasm-bindgen edge/browser
//! profiles. Domain client errors never throw from Rust — they return
//! `{"ok":false,"error":<SdkError JSON>}`. The sync webhook path still throws a
//! JS `Error` (via [`BindingError`]) for public error-shape parity.
//!
//! # Panic safety
//!
//! The `wasm-release` profile sets `panic = "abort"`, so `catch_unwind` cannot
//! recover across the JS boundary. [`run_envelope_sync`] therefore only maps a
//! `Result` — Clippy `unwrap_used` / `expect_used` / `panic` denies are the
//! primary safety mechanism (§7.6 / §15 note 32).

#[cfg(feature = "edge")]
use js_sys::Error as JsError;
#[cfg(feature = "edge")]
use js_sys::Reflect;
use serde::Serialize;
use serde_json::json;
use solvapay_core::SdkError;
#[cfg(feature = "edge")]
use solvapay_core::WebhookError;
#[cfg(feature = "edge")]
use wasm_bindgen::JsValue;

/// Stable binding-level error carrying a snake_case `code` for JS.
///
/// Used by the sync webhook path that still throws across the FFI (edge only).
#[cfg(feature = "edge")]
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingError {
    /// Snake_case machine code (also JS `Error.code`).
    code: &'static str,
    /// Human-readable message (also JS `Error.message`).
    message: String,
}

#[cfg(feature = "edge")]
impl BindingError {
    /// Builds a [`BindingError`] from a core [`WebhookError`].
    pub fn from_webhook(err: WebhookError) -> Self {
        Self {
            code: err.code.as_str(),
            message: err.message().to_owned(),
        }
    }

    /// Builds an error when JSON serialization of a verified payload fails.
    pub fn serialize_failed(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Returns the stable snake_case error code (also set as JS `Error.code`).
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// Returns the human-readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Converts into a JavaScript `Error` with `message` and snake_case `code`.
    pub fn into_js(self) -> JsValue {
        let js_err = JsError::new(&self.message);
        // Best-effort: if Reflect fails the Error still carries the message.
        let _ = Reflect::set(
            &js_err,
            &JsValue::from_str("code"),
            &JsValue::from_str(self.code),
        );
        JsValue::from(js_err)
    }
}

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

/// Parses a JSON object string into `T`, mapping failures to [`SdkError::Transport`].
pub fn parse_args_json<T: serde::de::DeserializeOwned>(args_json: &str) -> Result<T, SdkError> {
    serde_json::from_str(args_json)
        .map_err(|err| SdkError::transport(format!("invalid args JSON: {err}"), false))
}

/// Runs a sync pure-core call and returns a JSON envelope string.
///
/// On `wasm32` with `panic = "abort"` recoverable unwinding is unavailable, so
/// this only maps the `Result` — it does NOT `catch_unwind` (§7.6). Success
/// values serialize into `{"ok":true,"value":…}`; [`SdkError`] maps to an error
/// envelope.
pub fn run_envelope_sync<T, F>(f: F) -> String
where
    T: Serialize,
    F: FnOnce() -> Result<T, SdkError>,
{
    match f() {
        Ok(value) => ok_envelope(&value),
        Err(err) => err_envelope(&err),
    }
}

/// Awaits an async client call and returns a JSON envelope string.
///
/// [`SdkError`] maps to an error envelope; success values serialize into
/// `{"ok":true,"value":…}`. Edge + `wasm32` only — the transport
/// [`WasmClient`](crate::wasm_client::WasmClient) is the sole caller and the
/// browser profile has no transport client.
#[cfg(all(feature = "edge", target_arch = "wasm32"))]
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
