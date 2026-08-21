//! Binding error surface: webhook Ruby raises + JSON-envelope helpers (Step 43).
//!
//! Domain client errors never raise from Rust — they return
//! `{"ok":false,"error":<SdkError JSON>}`. Panics map to a Transport
//! `internal_error`-style envelope (§7.6). Webhook verification raises
//! `SolvaPay::Error` with a stable snake_case `code` attribute (§6.4).

use magnus::prelude::*;
use magnus::{exception, Error, Ruby};
use serde::Serialize;
use solvapay_core::{SdkError, WebhookError};

#[allow(unused_imports)] // re-export the full shared envelope surface
pub use solvapay_core::{
    envelope_from_panic_payload, err_envelope, internal_error_envelope, ok_envelope,
    parse_args_json, run_envelope_sync,
};

/// Stable binding-level error carrying a snake_case `code` for Ruby.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BindingError {
    /// Snake_case machine code (also `SolvaPay::Error#code`).
    code: &'static str,
    /// Human-readable message.
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

    /// Returns the stable snake_case error code.
    pub fn code(&self) -> &'static str {
        self.code
    }

    /// Returns the human-readable message.
    pub fn message(&self) -> &str {
        &self.message
    }

    /// Converts into a Magnus [`Error`] raising `SolvaPay::Error` with `@code`.
    pub fn into_magnus_err(self) -> Error {
        let Ok(ruby) = Ruby::get() else {
            return Error::new(exception::runtime_error(), self.message);
        };
        let class = match ruby.eval::<magnus::ExceptionClass>("SolvaPay::Error") {
            Ok(class) => class,
            Err(_) => {
                return Error::new(ruby.exception_runtime_error(), self.message);
            }
        };
        match class.new_instance((self.message.as_str(),)) {
            Ok(exc) => {
                let _: Result<magnus::Value, Error> =
                    exc.funcall("instance_variable_set", ("@code", self.code));
                Error::from(exc)
            }
            Err(_) => Error::new(class, self.message),
        }
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

/// Maps [`SdkError`] to a Magnus error at the FFI boundary (§6.4).
pub fn sdk_error_to_magnus(err: SdkError) -> Error {
    let code = match &err {
        SdkError::Api { .. } => "api_error",
        SdkError::Paywall { .. } => "paywall",
        SdkError::Webhook { code, .. } => code.as_str(),
        SdkError::Transport { .. } => "transport_error",
    };
    BindingError {
        code,
        message: err.message().to_owned(),
    }
    .into_magnus_err()
}

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
    clippy::missing_docs_in_private_items,
    missing_docs
)]
mod tests {
    use super::*;
    use serde_json::{json, Value};

    fn parse_envelope(json: &str) -> Value {
        serde_json::from_str(json).expect("envelope must be JSON")
    }

    #[test]
    fn ok_and_err_envelope_helpers_round_trip() {
        let ok = parse_envelope(&ok_envelope(&json!({"customerRef": "cus_x"})));
        assert_eq!(ok["ok"], true);
        assert_eq!(ok["value"]["customerRef"], "cus_x");

        let err = parse_envelope(&err_envelope(&SdkError::transport("nope", false)));
        assert_eq!(err["ok"], false);
        assert_eq!(err["error"]["kind"], "Transport");
    }
}
