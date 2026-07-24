//! Pure customer-sync / ensureCustomer decision helpers (Step 26).

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

/// Classification of a customerRef before ensure/lookup.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CustomerRefKind {
    /// Literal `"anonymous"` — returned as-is.
    Anonymous,
    /// Backend id (`cus_` prefix) — returned as-is.
    Backend,
    /// Needs lookup/create ensure flow.
    NeedsEnsure,
}

/// Lookup-error classification for getCustomer misses.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LookupErrorKind {
    /// Expected miss (`404` / `"not found"` substring).
    ExpectedMissing,
    /// Unexpected error — log and continue.
    Unexpected,
}

/// createCustomer error classification for 409 recovery.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CreateErrorKind {
    /// Conflict (`409` / `"already exists"`).
    Conflict,
    /// Non-conflict failure — rethrow.
    Other,
}

/// Coerced email/name options (`null`/`''` → omitted).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
pub struct CoercedCustomerOptions {
    /// Email when non-empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub email: Option<String>,
    /// Name when non-empty.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
}

/// createCustomer request params.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateCustomerParams {
    /// Email (provided or generated fallback).
    pub email: String,
    /// Optional display name.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    /// Optional external reference.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub external_ref: Option<String>,
    /// Always `{}` today.
    pub metadata: Map<String, Value>,
}

/// Classify a customerRef before ensure/lookup.
///
/// # Arguments
///
/// * `customer_ref` - App or backend customer reference.
///
/// # Returns
///
/// [`CustomerRefKind`] for the ensureCustomer early-return table.
pub fn classify_customer_ref(customer_ref: &str) -> CustomerRefKind {
    if customer_ref == "anonymous" {
        CustomerRefKind::Anonymous
    } else if customer_ref.starts_with("cus_") {
        CustomerRefKind::Backend
    } else {
        CustomerRefKind::NeedsEnsure
    }
}

/// JS falsy coercion: `null` / `''` → omitted (`email || undefined`).
///
/// # Arguments
///
/// * `email` - Optional email (empty string treated as absent).
/// * `name` - Optional name (empty string treated as absent).
///
/// # Returns
///
/// Options with only non-empty fields present.
pub fn coerce_customer_options(email: Option<&str>, name: Option<&str>) -> CoercedCustomerOptions {
    let coerce = |value: Option<&str>| -> Option<String> {
        match value {
            Some(s) if !s.is_empty() => Some(s.to_owned()),
            _ => None,
        }
    };
    CoercedCustomerOptions {
        email: coerce(email),
        name: coerce(name),
    }
}

/// Build createCustomer params, including the fallback email template.
///
/// # Arguments
///
/// * `customer_ref` - App customer reference used in generated emails.
/// * `external_ref` - Optional external reference to attach.
/// * `email` - Optional provided email; empty/`None` → generated.
/// * `name` - Optional name (JS truthy — empty omitted).
/// * `now_ms` - Explicit clock in milliseconds.
///
/// # Returns
///
/// Params with `metadata: {}` and conditional `name` / `externalRef`.
pub fn build_create_customer_params(
    customer_ref: &str,
    external_ref: Option<&str>,
    email: Option<&str>,
    name: Option<&str>,
    now_ms: i64,
) -> CreateCustomerParams {
    let email = match email {
        Some(s) if !s.is_empty() => s.to_owned(),
        _ => format!("{customer_ref}-{now_ms}@auto-created.local"),
    };
    let name = name.and_then(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_owned())
        }
    });
    let external_ref = external_ref.and_then(|s| {
        if s.is_empty() {
            None
        } else {
            Some(s.to_owned())
        }
    });
    CreateCustomerParams {
        email,
        name,
        external_ref,
        metadata: Map::new(),
    }
}

/// Prefer `customerRef`, then `reference`, then `fallback`.
///
/// # Arguments
///
/// * `response` - JSON object from createCustomer.
/// * `fallback` - App customerRef used when both fields are absent/empty.
///
/// # Returns
///
/// Backend customer reference string.
pub fn extract_backend_customer_ref(response: &Map<String, Value>, fallback: &str) -> String {
    match response.get("customerRef") {
        Some(Value::String(s)) if !s.is_empty() => return s.clone(),
        _ => {}
    }
    match response.get("reference") {
        Some(Value::String(s)) if !s.is_empty() => return s.clone(),
        _ => {}
    }
    fallback.to_owned()
}

/// Classify a getCustomer lookup failure message.
///
/// # Arguments
///
/// * `message` - Error message string.
///
/// # Returns
///
/// [`LookupErrorKind::ExpectedMissing`] when message contains `404` or
/// `"not found"`; otherwise [`LookupErrorKind::Unexpected`].
pub fn classify_lookup_error(message: &str) -> LookupErrorKind {
    if message.contains("404") || message.contains("not found") {
        LookupErrorKind::ExpectedMissing
    } else {
        LookupErrorKind::Unexpected
    }
}

/// Classify a createCustomer failure message for 409 recovery.
///
/// # Arguments
///
/// * `message` - Error message string.
///
/// # Returns
///
/// [`CreateErrorKind::Conflict`] when message contains `409` or
/// `"already exists"`; otherwise [`CreateErrorKind::Other`].
pub fn classify_create_error(message: &str) -> CreateErrorKind {
    if message.contains("409") || message.contains("already exists") {
        CreateErrorKind::Conflict
    } else {
        CreateErrorKind::Other
    }
}

/// Email-uniqueness conflict branch inside ensureCustomer 409 recovery.
///
/// # Arguments
///
/// * `message` - Conflict error message.
///
/// # Returns
///
/// `true` when message contains `"email"` or `"identifier email"`.
pub fn is_email_conflict(message: &str) -> bool {
    message.contains("email") || message.contains("identifier email")
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

    #[test]
    fn classify_ref_table() {
        assert_eq!(
            classify_customer_ref("anonymous"),
            CustomerRefKind::Anonymous
        );
        assert_eq!(classify_customer_ref("cus_x"), CustomerRefKind::Backend);
        assert_eq!(
            classify_customer_ref("user-1"),
            CustomerRefKind::NeedsEnsure
        );
    }

    #[test]
    fn coerce_omits_null_and_empty() {
        let empty = coerce_customer_options(Some(""), Some(""));
        assert!(empty.email.is_none() && empty.name.is_none());
        let json = serde_json::to_value(&empty).unwrap();
        assert_eq!(json, serde_json::json!({}));
    }

    #[test]
    fn create_params_fallback_email() {
        let params =
            build_create_customer_params("user-1", Some("ext"), None, None, 1_700_000_000_000);
        assert_eq!(params.email, "user-1-1700000000000@auto-created.local");
        assert_eq!(params.external_ref.as_deref(), Some("ext"));
        assert!(params.metadata.is_empty());
    }

    #[test]
    fn extract_ordering() {
        let mut map = Map::new();
        map.insert("customerRef".into(), Value::String("cus_a".into()));
        map.insert("reference".into(), Value::String("cus_b".into()));
        assert_eq!(extract_backend_customer_ref(&map, "fb"), "cus_a");
    }
}
