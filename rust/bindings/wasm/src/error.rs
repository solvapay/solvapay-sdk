//! Single [`WebhookError`] → JavaScript `Error` conversion layer (§6.4 / §7.6).

use js_sys::Error as JsError;
use js_sys::Reflect;
use solvapay_core::WebhookError;
use wasm_bindgen::JsValue;

/// Stable binding-level error carrying a snake_case `code` for JS.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingError {
    /// Snake_case machine code (also JS `Error.code`).
    code: &'static str,
    /// Human-readable message (also JS `Error.message`).
    message: String,
}

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
