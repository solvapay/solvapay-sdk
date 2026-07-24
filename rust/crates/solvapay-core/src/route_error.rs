//! Pure route-error decision cores (Step 31).

use serde_json::Value;

use crate::helper_error::HelperErrorResult;

/// Narrowed error kind after host-side `instanceof` checks.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RouteErrorKind {
    /// `instanceof SolvaPayError`.
    SolvaPay,
    /// `instanceof Error` (non-SolvaPay).
    Error,
    /// Non-Error throw.
    Unknown,
}

/// Input to [`map_route_error`] after host narrowing.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RouteErrorInput {
    /// Error kind.
    pub kind: RouteErrorKind,
    /// Error message (`None` for unknown throws).
    pub message: Option<String>,
    /// Optional HTTP status from `SolvaPayError.status`.
    pub status: Option<u16>,
    /// Operation name used in the default failure label.
    pub operation_name: String,
    /// Optional custom default message.
    pub default_message: Option<String>,
}

/// Map a narrowed route error into the helper [`HelperErrorResult`] shape.
///
/// - [`RouteErrorKind::SolvaPay`] → `{ error: message, status: status ?? 500, details: message }`
/// - [`RouteErrorKind::Error`] / [`RouteErrorKind::Unknown`] →
///   `{ error: defaultMessage || "{operationName} failed", status: 500, details }`
///
/// # Arguments
///
/// * `input` - Narrowed error fields from the host shim.
///
/// # Returns
///
/// Always includes `details` ([`HelperErrorResult::with_details`]).
pub fn map_route_error(input: &RouteErrorInput) -> HelperErrorResult {
    match input.kind {
        RouteErrorKind::SolvaPay => {
            let error_message = input.message.clone().unwrap_or_default();
            HelperErrorResult::with_details(
                error_message.clone(),
                input.status.unwrap_or(500),
                error_message,
            )
        }
        RouteErrorKind::Error => {
            let details = input
                .message
                .clone()
                .unwrap_or_else(|| "Unknown error".to_owned());
            let message = fallback_operation_message(input);
            HelperErrorResult::with_details(message, 500, details)
        }
        RouteErrorKind::Unknown => {
            let message = fallback_operation_message(input);
            HelperErrorResult::with_details(message, 500, "Unknown error")
        }
    }
}

/// JS `defaultMessage || \`${operationName} failed\`` (empty string is falsy).
fn fallback_operation_message(input: &RouteErrorInput) -> String {
    match &input.default_message {
        Some(m) if !m.is_empty() => m.clone(),
        Some(_) | None => format!("{} failed", input.operation_name),
    }
}

/// Check if a JSON value is an error result (`error` + `status` keys).
///
/// Mirrors TS: `typeof result === 'object' && result !== null && 'error' in result && 'status' in result`.
///
/// # Arguments
///
/// * `value` - Arbitrary JSON value.
///
/// # Returns
///
/// `true` when `value` is an object with both `error` and `status` keys.
pub fn is_error_result(value: &Value) -> bool {
    match value {
        Value::Object(map) => map.contains_key("error") && map.contains_key("status"),
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use serde_json::json;

    #[test]
    fn solvapay_with_status() {
        let result = map_route_error(&RouteErrorInput {
            kind: RouteErrorKind::SolvaPay,
            message: Some("Get merchant failed (404): not found".into()),
            status: Some(404),
            operation_name: "Get merchant".into(),
            default_message: None,
        });
        assert_eq!(result.error, "Get merchant failed (404): not found");
        assert_eq!(result.status, 404);
        assert_eq!(
            result.details.as_deref(),
            Some("Get merchant failed (404): not found")
        );
    }

    #[test]
    fn solvapay_no_status_defaults_500() {
        let result = map_route_error(&RouteErrorInput {
            kind: RouteErrorKind::SolvaPay,
            message: Some("Missing apiKey".into()),
            status: None,
            operation_name: "Create client".into(),
            default_message: None,
        });
        assert_eq!(result.error, "Missing apiKey");
        assert_eq!(result.status, 500);
        assert_eq!(result.details.as_deref(), Some("Missing apiKey"));
    }

    #[test]
    fn plain_error_default_message() {
        let result = map_route_error(&RouteErrorInput {
            kind: RouteErrorKind::Error,
            message: Some("boom".into()),
            status: None,
            operation_name: "Get something".into(),
            default_message: None,
        });
        assert_eq!(result.error, "Get something failed");
        assert_eq!(result.status, 500);
        assert_eq!(result.details.as_deref(), Some("boom"));
    }

    #[test]
    fn plain_error_custom_default() {
        let result = map_route_error(&RouteErrorInput {
            kind: RouteErrorKind::Error,
            message: Some("Backend exploded".into()),
            status: None,
            operation_name: "Get product".into(),
            default_message: Some("Failed to fetch product".into()),
        });
        assert_eq!(result.error, "Failed to fetch product");
        assert_eq!(result.status, 500);
        assert_eq!(result.details.as_deref(), Some("Backend exploded"));
    }

    #[test]
    fn unknown_throw() {
        let result = map_route_error(&RouteErrorInput {
            kind: RouteErrorKind::Unknown,
            message: None,
            status: None,
            operation_name: "Get merchant".into(),
            default_message: Some("Failed to fetch merchant".into()),
        });
        assert_eq!(result.error, "Failed to fetch merchant");
        assert_eq!(result.status, 500);
        assert_eq!(result.details.as_deref(), Some("Unknown error"));
    }

    #[test]
    fn is_error_result_valid() {
        assert!(is_error_result(
            &json!({ "error": "Unauthorized", "status": 401 })
        ));
    }

    #[test]
    fn is_error_result_missing_error() {
        assert!(!is_error_result(&json!({ "status": 500 })));
    }

    #[test]
    fn is_error_result_missing_status() {
        assert!(!is_error_result(&json!({ "error": "boom" })));
    }

    #[test]
    fn is_error_result_non_object() {
        assert!(!is_error_result(&json!("not-an-object")));
    }

    #[test]
    fn is_error_result_null() {
        assert!(!is_error_result(&Value::Null));
    }
}
