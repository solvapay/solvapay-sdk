//! Shared helper `ErrorResult` shape (`{ error, status, details? }`).

use serde::{Deserialize, Serialize};

/// Route-helper error object (matches TS `ErrorResult`).
///
/// `details` is omitted when absent (skip-absent), unlike auth `email`/`name`
/// which serialize as explicit `null`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct HelperErrorResult {
    /// Human-readable error label (e.g. `"Unauthorized"`).
    pub error: String,
    /// HTTP status code.
    pub status: u16,
    /// Optional detail string; skipped when [`None`].
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
}

impl HelperErrorResult {
    /// Builds an error with `details` present.
    ///
    /// # Arguments
    ///
    /// * `error` - Error label.
    /// * `status` - HTTP status.
    /// * `details` - Detail message.
    ///
    /// # Returns
    ///
    /// A [`HelperErrorResult`] with `details: Some(...)`.
    pub fn with_details(error: impl Into<String>, status: u16, details: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            status,
            details: Some(details.into()),
        }
    }

    /// Builds an error without a `details` field.
    ///
    /// # Arguments
    ///
    /// * `error` - Error label.
    /// * `status` - HTTP status.
    ///
    /// # Returns
    ///
    /// A [`HelperErrorResult`] with `details: None`.
    pub fn without_details(error: impl Into<String>, status: u16) -> Self {
        Self {
            error: error.into(),
            status,
            details: None,
        }
    }

    /// Transport-shaped helper error used by JSON step drivers.
    pub fn transport(details: impl Into<String>) -> Self {
        Self::with_details("Transport", 400, details)
    }
}

/// Map [`crate::error::SdkError`] onto the helper-error wire shape.
pub fn helper_error_from_sdk(error: &crate::error::SdkError, op: &str) -> HelperErrorResult {
    match error {
        crate::error::SdkError::Api {
            message,
            status,
            code,
        } => HelperErrorResult::with_details(
            code.clone().unwrap_or_else(|| "Api".to_owned()),
            status.unwrap_or(400),
            format!("{op}: {message}"),
        ),
        crate::error::SdkError::Paywall { message, .. } => {
            HelperErrorResult::with_details("Paywall", 402, format!("{op}: {message}"))
        }
        #[cfg(feature = "webhook-verify")]
        crate::error::SdkError::Webhook { message, .. } => {
            HelperErrorResult::with_details("Webhook", 400, format!("{op}: {message}"))
        }
        crate::error::SdkError::Transport { message, .. } => {
            HelperErrorResult::transport(format!("{op}: {message}"))
        }
    }
}
