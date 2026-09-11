//! One conversion layer: [`SdkError`] → [`ErrorObservation`] (§6.4).
//!
//! All fixture-runner bindings that surface core failures should route through
//! [`sdk_error_to_observation`] so `kind` / `code` / `status` / message stay
//! consistent. Do not invent a second taxonomy here.

use solvapay_core::SdkError;

use crate::runner::ErrorObservation;

/// Maps a core [`SdkError`] to a structured fixture observation (§6.4).
///
/// Facade names: `Api` / `Webhook` / `Transport` → `SolvaPayError`;
/// `Paywall` → `PaywallError`. Transport uses stable codes `retryable` /
/// `non_retryable`.
///
/// # Arguments
///
/// * `error` - Core error to convert once at the binding boundary.
///
/// # Returns
///
/// An [`ErrorObservation`] ready for `expect.error` comparison.
pub fn sdk_error_to_observation(error: SdkError) -> ErrorObservation {
    match error {
        SdkError::Api {
            message,
            status,
            code,
        } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Api".to_owned()),
            code,
            status: status.map(i64::from),
        },
        SdkError::Paywall { message, .. } => ErrorObservation {
            name: Some("PaywallError".to_owned()),
            message,
            kind: Some("Paywall".to_owned()),
            code: None,
            status: None,
        },
        SdkError::Webhook { message, code } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Webhook".to_owned()),
            code: Some(code.as_str().to_owned()),
            status: None,
        },
        SdkError::Transport { message, retryable } => ErrorObservation {
            name: Some("SolvaPayError".to_owned()),
            message,
            kind: Some("Transport".to_owned()),
            code: Some(if retryable {
                "retryable".to_owned()
            } else {
                "non_retryable".to_owned()
            }),
            status: None,
        },
    }
}
