//! Single WebhookError → JS Error conversion layer (§6.4 / §7.6).

use napi::{Error, Status};
use solvapay_core::WebhookError;

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

    /// Builds a panic / unwind boundary error (§7.6).
    pub fn panicked(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Builds an error when JSON serialization of a verified payload fails.
    pub fn serialize_failed(message: impl Into<String>) -> Self {
        Self {
            code: "internal_error",
            message: message.into(),
        }
    }

    /// Builds an error when the host clock cannot be read.
    pub fn clock_failed(message: impl Into<String>) -> Self {
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

    /// Converts into a napi [`Error`] whose JS `code` is the webhook/binding code.
    ///
    /// Uses a custom string status so `napi_create_error` sets `error.code`
    /// (napi-rs maps `Error.status` → JS `Error.code`).
    pub fn into_napi(self) -> Error<&'static str> {
        Error::new(self.code, self.message)
    }

    /// Converts a catch_unwind panic payload into a [`BindingError`].
    pub fn from_panic_payload(payload: Box<dyn std::any::Any + Send>) -> Self {
        let message = if let Some(s) = payload.downcast_ref::<&str>() {
            (*s).to_owned()
        } else if let Some(s) = payload.downcast_ref::<String>() {
            s.clone()
        } else {
            "native binding panicked".to_owned()
        };
        Self::panicked(message)
    }
}

impl From<BindingError> for Error {
    fn from(value: BindingError) -> Self {
        // Fallback for APIs that require `Error<Status>` (e.g. `napi_version`).
        // Prefer [`BindingError::into_napi`] at edges that must surface a stable code.
        Error::new(Status::GenericFailure, value.message)
    }
}
