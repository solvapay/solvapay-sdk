//! Cross-language [`SdkError`] surface (§4.4 / §6.4).
//!
//! # Conversion layer (§6.4)
//!
//! Each language binding converts [`SdkError`] **once** at the FFI / facade
//! boundary into the host exception type (`SolvaPayError` / `PaywallError` in
//! TypeScript, idiomatic exceptions elsewhere). That conversion preserves
//! `kind`, `code`, `status`, and the frozen message string.
//!
//! Bindings must **not** invent a second error taxonomy. New failure modes
//! extend [`SdkError`] (or a nested code enum) in this crate; wrappers only
//! map. Transport failures are always [`SdkError::Transport`] — never a
//! parallel public error type in step 19+.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};

use crate::paywall_gate::PaywallGate;
#[cfg(feature = "webhook-verify")]
use crate::webhook::{WebhookError, WebhookErrorCode};

/// Single structured error surface for all SolvaPay bindings (§4.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind")]
pub enum SdkError {
    /// Maps to TypeScript `SolvaPayError`.
    Api {
        /// Human-readable message (often from a manifest template).
        message: String,
        /// HTTP status when the failure came from a non-OK response.
        status: Option<u16>,
        /// Optional free-form machine-readable code.
        code: Option<String>,
    },
    /// Maps to TypeScript `PaywallError`; carries the full gate for 402 formatting.
    Paywall {
        /// Short throw message (`"Payment required"` / `"Activation required"`).
        message: String,
        /// Transport-agnostic gate (`PaywallStructuredContent` parity).
        gate: PaywallGate,
    },
    /// Webhook verification failures with stable codes.
    #[cfg(feature = "webhook-verify")]
    Webhook {
        /// Frozen human-readable message for the code.
        message: String,
        /// Stable snake_case code.
        code: WebhookErrorCode,
    },
    /// Transport / I/O failures. The *only* transport error surface (step 19+).
    Transport {
        /// Human-readable message.
        message: String,
        /// Whether a retry may help.
        retryable: bool,
    },
}

impl SdkError {
    /// Builds [`SdkError::Api`] by rendering a manifest message template.
    ///
    /// # Arguments
    ///
    /// * `template` - Manifest template with `{name}` placeholders.
    /// * `vars` - Placeholder name → substitution value (e.g. `status`, `body`).
    /// * `status` - Optional HTTP status preserved on the error.
    /// * `code` - Optional free-form code preserved on the error.
    ///
    /// # Returns
    ///
    /// An [`SdkError::Api`] whose `message` is the rendered template.
    pub fn api_from_template(
        template: &str,
        vars: &BTreeMap<&str, &str>,
        status: Option<u16>,
        code: Option<String>,
    ) -> Self {
        Self::Api {
            message: render_template(template, vars),
            status,
            code,
        }
    }

    /// Builds [`SdkError::Paywall`] from a gate, using the frozen throw message
    /// for the gate kind (`Payment required` / `Activation required`).
    ///
    /// # Arguments
    ///
    /// * `gate` - Assembled paywall gate.
    /// * `message` - Frozen throw message (from the manifest paywall block).
    ///
    /// # Returns
    ///
    /// An [`SdkError::Paywall`] carrying `message` and `gate`.
    pub fn paywall(message: impl Into<String>, gate: PaywallGate) -> Self {
        Self::Paywall {
            message: message.into(),
            gate,
        }
    }

    /// Builds [`SdkError::Transport`].
    ///
    /// # Arguments
    ///
    /// * `message` - Human-readable transport failure description.
    /// * `retryable` - Whether the caller may retry.
    ///
    /// # Returns
    ///
    /// An [`SdkError::Transport`] variant.
    pub fn transport(message: impl Into<String>, retryable: bool) -> Self {
        Self::Transport {
            message: message.into(),
            retryable,
        }
    }

    /// Returns the human-readable message for this error.
    ///
    /// # Returns
    ///
    /// The `message` field of the active variant.
    pub fn message(&self) -> &str {
        match self {
            Self::Api { message, .. }
            | Self::Paywall { message, .. }
            | Self::Transport { message, .. } => message,
            #[cfg(feature = "webhook-verify")]
            Self::Webhook { message, .. } => message,
        }
    }

    /// Returns the serde `kind` tag string for this variant.
    ///
    /// # Returns
    ///
    /// One of `Api`, `Paywall`, `Webhook`, or `Transport`.
    pub fn kind_str(&self) -> &'static str {
        match self {
            Self::Api { .. } => "Api",
            Self::Paywall { .. } => "Paywall",
            #[cfg(feature = "webhook-verify")]
            Self::Webhook { .. } => "Webhook",
            Self::Transport { .. } => "Transport",
        }
    }
}

#[cfg(feature = "webhook-verify")]
impl From<WebhookError> for SdkError {
    /// Folds a domain [`WebhookError`] into [`SdkError::Webhook`].
    ///
    /// # Arguments
    ///
    /// * `error` - Webhook verification failure.
    ///
    /// # Returns
    ///
    /// [`SdkError::Webhook`] with the frozen message for `error.code`.
    fn from(error: WebhookError) -> Self {
        Self::Webhook {
            message: error.message().to_owned(),
            code: error.code,
        }
    }
}

/// Substitutes `{name}` placeholders in a manifest message template.
///
/// Unknown placeholders are left unchanged. Substitution is a simple scan for
/// `{…}` segments; nested braces are not supported.
///
/// # Arguments
///
/// * `template` - Template string (e.g. `"Check limits failed ({status}): {body}"`).
/// * `vars` - Placeholder name → replacement value.
///
/// # Returns
///
/// The rendered message with known placeholders replaced.
pub fn render_template(template: &str, vars: &BTreeMap<&str, &str>) -> String {
    let mut out = String::with_capacity(template.len());
    let mut rest = template;
    while let Some(start) = rest.find('{') {
        out.push_str(&rest[..start]);
        let after = &rest[start + 1..];
        match after.find('}') {
            Some(end) => {
                let key = &after[..end];
                match vars.get(key) {
                    Some(value) => out.push_str(value),
                    None => {
                        out.push('{');
                        out.push_str(key);
                        out.push('}');
                    }
                }
                rest = &after[end + 1..];
            }
            None => {
                out.push('{');
                rest = after;
            }
        }
    }
    out.push_str(rest);
    out
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use crate::paywall_gate::PaywallGateKind;
    use serde_json::json;

    fn vars<'a>(pairs: &'a [(&'a str, &'a str)]) -> BTreeMap<&'a str, &'a str> {
        pairs.iter().copied().collect()
    }

    #[test]
    fn render_template_substitutes_status_and_body() {
        let rendered = render_template(
            "Check limits failed ({status}): {body}",
            &vars(&[("status", "402"), ("body", "payment required")]),
        );
        assert_eq!(rendered, "Check limits failed (402): payment required");
    }

    #[test]
    fn render_template_substitutes_named_placeholders() {
        let rendered = render_template(
            "No customer found with externalRef: {externalRef}",
            &vars(&[("externalRef", "ext_missing")]),
        );
        assert_eq!(rendered, "No customer found with externalRef: ext_missing");
    }

    #[test]
    fn render_template_leaves_unknown_placeholders() {
        let rendered = render_template("hello {missing}", &vars(&[]));
        assert_eq!(rendered, "hello {missing}");
    }

    #[test]
    fn api_from_template_builds_byte_identical_message() {
        let err = SdkError::api_from_template(
            "Check limits failed ({status}): {body}",
            &vars(&[("status", "402"), ("body", "bad")]),
            Some(402),
            None,
        );
        match &err {
            SdkError::Api {
                message,
                status,
                code,
            } => {
                assert_eq!(message, "Check limits failed (402): bad");
                assert_eq!(*status, Some(402));
                assert_eq!(*code, None);
            }
            other => panic!("expected Api, got {other:?}"),
        }
    }

    #[test]
    fn webhook_error_folds_into_sdk_error() {
        let domain = WebhookError::new(WebhookErrorCode::MissingSignature);
        let err: SdkError = domain.into();
        match err {
            SdkError::Webhook { message, code } => {
                assert_eq!(message, "Missing webhook signature");
                assert_eq!(code, WebhookErrorCode::MissingSignature);
            }
            other => panic!("expected Webhook, got {other:?}"),
        }
    }

    #[test]
    fn paywall_and_transport_constructors() {
        let gate = PaywallGate {
            kind: PaywallGateKind::PaymentRequired,
            product: "prd_test".to_owned(),
            checkout_url: "https://checkout.example/x".to_owned(),
            message: "You need to upgrade".to_owned(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
        };
        let paywall = SdkError::paywall("Payment required", gate.clone());
        match &paywall {
            SdkError::Paywall { message, gate: g } => {
                assert_eq!(message, "Payment required");
                assert_eq!(g, &gate);
            }
            other => panic!("expected Paywall, got {other:?}"),
        }

        let transport = SdkError::transport("connection reset", true);
        match transport {
            SdkError::Transport { message, retryable } => {
                assert_eq!(message, "connection reset");
                assert!(retryable);
            }
            other => panic!("expected Transport, got {other:?}"),
        }
    }

    #[test]
    fn serde_round_trip_is_kind_tagged() {
        let cases = [
            SdkError::Api {
                message: "Check limits failed (400): bad".to_owned(),
                status: Some(400),
                code: None,
            },
            SdkError::Webhook {
                message: "Missing webhook signature".to_owned(),
                code: WebhookErrorCode::MissingSignature,
            },
            SdkError::Transport {
                message: "timeout".to_owned(),
                retryable: false,
            },
        ];

        for original in cases {
            let value = serde_json::to_value(&original).expect("serialize");
            assert_eq!(
                value.get("kind").and_then(|v| v.as_str()),
                Some(original.kind_str())
            );
            let back: SdkError = serde_json::from_value(value).expect("deserialize");
            assert_eq!(back, original);
        }

        let gate = PaywallGate {
            kind: PaywallGateKind::ActivationRequired,
            product: "prd_a".to_owned(),
            checkout_url: "".to_owned(),
            message: "Activate".to_owned(),
            confirmation_url: Some("https://confirm.example".to_owned()),
            plans: Some(json!([])),
            balance: None,
            product_details: None,
        };
        let paywall = SdkError::paywall("Activation required", gate);
        let value = serde_json::to_value(&paywall).expect("serialize paywall");
        assert_eq!(value["kind"], "Paywall");
        let back: SdkError = serde_json::from_value(value).expect("deserialize paywall");
        assert_eq!(back, paywall);
    }
}
