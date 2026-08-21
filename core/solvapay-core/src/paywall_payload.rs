//! Client payload shapes (§9 step 33).
//!
//! Pure port of `paywallErrorToClientPayload` from
//! `packages/server/src/paywall.ts`: map a [`PaywallGate`]
//! (`PaywallStructuredContent` parity) into the stable 402 JSON body.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paywall_gate::{PaywallGate, PaywallGateKind};

/// Stable 402 client payload (`paywallErrorToClientPayload` parity).
///
/// Always emits `success: false`, a kind-derived `error` label, and the
/// gate's `product` / `checkoutUrl` / `message` / `kind`. Optional blocks
/// follow activation-vs-payment branch asymmetry (payment never emits
/// `plans` / `confirmationUrl`); absent/`null` options are skipped.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallClientPayload {
    /// Always `false` for gate payloads.
    pub success: bool,
    /// Human-readable label: `"Activation required"` or `"Payment required"`.
    pub error: String,
    /// Product reference echoed from the gate.
    pub product: String,
    /// Checkout / confirmation URL echoed from the gate.
    pub checkout_url: String,
    /// Gate message echoed verbatim.
    pub message: String,
    /// Recovery discriminator.
    pub kind: PaywallGateKind,
    /// Activation-only: plans when present on the gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Value>,
    /// Quota balance when present on the gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<Value>,
    /// Rich product context when present on the gate.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_details: Option<Value>,
    /// Activation-only: confirmation URL when present (including `""`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_url: Option<String>,
}

/// Raw pass-through value, or `None` when absent or JSON `null` (null ≡ absent).
///
/// Mirrors step-14 `present` in [`crate::paywall_gate`].
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

/// Map a paywall gate into the stable 402 client payload.
///
/// # Arguments
///
/// * `gate` - Assembled gate (`PaywallStructuredContent` shape).
///
/// # Returns
///
/// Serialized-ready [`PaywallClientPayload`] with branch-correct optional fields.
pub fn paywall_client_payload(gate: &PaywallGate) -> PaywallClientPayload {
    let (error, is_activation) = match gate.kind {
        PaywallGateKind::ActivationRequired => ("Activation required", true),
        PaywallGateKind::PaymentRequired => ("Payment required", false),
    };

    let balance = present(gate.balance.as_ref()).cloned();
    let product_details = present(gate.product_details.as_ref()).cloned();

    let (plans, confirmation_url) = if is_activation {
        (
            present(gate.plans.as_ref()).cloned(),
            gate.confirmation_url.clone(),
        )
    } else {
        (None, None)
    };

    PaywallClientPayload {
        success: false,
        error: error.to_owned(),
        product: gate.product.clone(),
        checkout_url: gate.checkout_url.clone(),
        message: gate.message.clone(),
        kind: gate.kind,
        plans,
        balance,
        product_details,
        confirmation_url,
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

    fn activation_gate() -> PaywallGate {
        PaywallGate {
            kind: PaywallGateKind::ActivationRequired,
            product: "prd_demo".into(),
            checkout_url: "https://pay.test/confirm".into(),
            message: "activate".into(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
        }
    }

    fn payment_gate() -> PaywallGate {
        PaywallGate {
            kind: PaywallGateKind::PaymentRequired,
            product: "prd_demo".into(),
            checkout_url: "https://pay.test/x".into(),
            message: "pay".into(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
        }
    }

    #[test]
    fn activation_branch_error_and_kind() {
        let payload = paywall_client_payload(&activation_gate());
        assert_eq!(payload.error, "Activation required");
        assert_eq!(payload.kind, PaywallGateKind::ActivationRequired);
    }

    #[test]
    fn payment_branch_error_and_kind() {
        let payload = paywall_client_payload(&payment_gate());
        assert_eq!(payload.error, "Payment required");
        assert_eq!(payload.kind, PaywallGateKind::PaymentRequired);
    }

    #[test]
    fn success_always_false_and_fields_pass_through() {
        let payload = paywall_client_payload(&activation_gate());
        assert!(!payload.success);
        assert_eq!(payload.product, "prd_demo");
        assert_eq!(payload.checkout_url, "https://pay.test/confirm");
        assert_eq!(payload.message, "activate");
    }

    #[test]
    fn activation_emits_optional_fields_iff_present() {
        let mut gate = activation_gate();
        gate.plans = Some(json!([{ "reference": "pl_pro" }]));
        gate.balance = Some(json!({ "creditBalance": 0 }));
        gate.product_details = Some(json!({ "name": "Demo" }));
        gate.confirmation_url = Some("https://pay.test/confirm".into());

        let value = serde_json::to_value(paywall_client_payload(&gate)).unwrap();
        assert!(value.get("plans").is_some());
        assert!(value.get("balance").is_some());
        assert!(value.get("productDetails").is_some());
        assert!(value.get("confirmationUrl").is_some());

        let minimal = serde_json::to_value(paywall_client_payload(&activation_gate())).unwrap();
        assert!(minimal.get("plans").is_none());
        assert!(minimal.get("balance").is_none());
        assert!(minimal.get("productDetails").is_none());
        assert!(minimal.get("confirmationUrl").is_none());
    }

    #[test]
    fn payment_drops_plans_and_confirmation_url() {
        let mut gate = payment_gate();
        gate.plans = Some(json!([{ "reference": "pl_pro" }]));
        gate.confirmation_url = Some("https://pay.test/confirm".into());
        gate.balance = Some(json!({ "creditBalance": 0 }));
        gate.product_details = Some(json!({ "name": "Demo" }));

        let value = serde_json::to_value(paywall_client_payload(&gate)).unwrap();
        assert!(value.get("plans").is_none());
        assert!(value.get("confirmationUrl").is_none());
        assert!(value.get("balance").is_some());
        assert!(value.get("productDetails").is_some());
    }

    #[test]
    fn activation_empty_confirmation_url_is_emitted() {
        let mut gate = activation_gate();
        gate.confirmation_url = Some(String::new());

        let value = serde_json::to_value(paywall_client_payload(&gate)).unwrap();
        assert_eq!(value.get("confirmationUrl"), Some(&json!("")));
    }

    #[test]
    fn null_pass_through_is_omitted() {
        let mut gate = activation_gate();
        gate.balance = Some(Value::Null);
        gate.product_details = Some(Value::Null);
        gate.plans = Some(Value::Null);

        let value = serde_json::to_value(paywall_client_payload(&gate)).unwrap();
        assert!(value.get("balance").is_none());
        assert!(value.get("productDetails").is_none());
        assert!(value.get("plans").is_none());
    }
}
