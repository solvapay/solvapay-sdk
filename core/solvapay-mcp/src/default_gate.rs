//! Default `ctx.gate()` paywall stub.

use serde::Deserialize;
use solvapay_core::{PaywallGate, PaywallGateKind};

/// Input for [`mcp_default_gate`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DefaultGateInput {
    /// Product the handler is protected against.
    pub product: String,
    /// Optional merchant reason; empty / omitted becomes `Payment required`.
    #[serde(default)]
    pub reason: Option<String>,
}

/// Build the frozen default `ctx.gate()` structured content.
///
/// # Arguments
///
/// * `product` - Product reference stamped onto the gate.
/// * `reason` - Optional message; empty / `None` becomes `Payment required`.
#[must_use]
pub fn mcp_default_gate(product: &str, reason: Option<&str>) -> PaywallGate {
    let message = match reason {
        Some(r) if !r.is_empty() => r.to_owned(),
        _ => "Payment required".to_owned(),
    };
    PaywallGate {
        kind: PaywallGateKind::PaymentRequired,
        product: product.to_owned(),
        checkout_url: String::new(),
        message,
        short_message: "Payment required".to_owned(),
        confirmation_url: None,
        plans: None,
        balance: None,
        product_details: None,
        ..PaywallGate::default()
    }
}
