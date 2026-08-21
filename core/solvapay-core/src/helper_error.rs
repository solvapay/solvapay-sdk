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
}
