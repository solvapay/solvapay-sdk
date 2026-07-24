//! Text-only MCP paywall tool result (`paywallToolResult` / `formatGate` parity).

use serde::{Deserialize, Serialize};

use crate::paywall_gate::PaywallGate;

/// Single MCP content block (`content[0]` narration).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct McpContentBlock {
    /// Always `"text"` for the paywall narration path.
    #[serde(rename = "type")]
    pub block_type: String,
    /// Narration text (gate message).
    pub text: String,
}

/// MCP tool result for a paywall gate (`PaywallToolResult` parity).
///
/// `is_error` is deliberately always `false` (§6.5): paywall is a
/// user-actionable gate, not a tool execution failure.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPaywallToolResult {
    /// Always `false` — paywall is not an MCP tool error.
    pub is_error: bool,
    /// One text block carrying the narration.
    pub content: Vec<McpContentBlock>,
    /// Machine-readable gate payload (verbatim [`PaywallGate`]).
    pub structured_content: PaywallGate,
}

/// Build a text-only MCP paywall tool result.
///
/// # Arguments
///
/// * `narration` - Text placed in `content[0].text` (typically the gate message).
/// * `gate` - Structured gate echoed on `structuredContent`.
///
/// # Returns
///
/// [`McpPaywallToolResult`] with `isError: false` and a single text content block.
pub fn paywall_tool_result(narration: &str, gate: &PaywallGate) -> McpPaywallToolResult {
    McpPaywallToolResult {
        is_error: false,
        content: vec![McpContentBlock {
            block_type: "text".to_owned(),
            text: narration.to_owned(),
        }],
        structured_content: gate.clone(),
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
    use crate::paywall_gate::PaywallGateKind;
    use serde_json::json;

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
    fn is_error_always_false() {
        let result = paywall_tool_result("pay", &payment_gate());
        assert!(!result.is_error);
        let value = serde_json::to_value(&result).unwrap();
        assert_eq!(value.get("isError"), Some(&json!(false)));
    }

    #[test]
    fn narration_text_in_content() {
        let distinctive = "Call solvapay_upgrade to continue";
        let result = paywall_tool_result(distinctive, &payment_gate());
        assert_eq!(result.content.len(), 1);
        assert_eq!(result.content[0].block_type, "text");
        assert_eq!(result.content[0].text, distinctive);
    }

    #[test]
    fn structured_content_verbatim_including_empty_checkout_url() {
        let mut gate = payment_gate();
        gate.checkout_url = String::new();
        gate.balance = Some(json!({ "creditBalance": 0 }));
        gate.product_details = Some(json!({ "name": "Demo" }));

        let result = paywall_tool_result("", &gate);
        assert_eq!(result.structured_content.checkout_url, "");
        assert_eq!(result.structured_content.balance, gate.balance);
        assert_eq!(
            result.structured_content.product_details,
            gate.product_details
        );
    }

    #[test]
    fn activation_fields_ride_through() {
        let gate = PaywallGate {
            kind: PaywallGateKind::ActivationRequired,
            product: "prd_demo".into(),
            checkout_url: "https://pay.test/confirm".into(),
            message: "activate".into(),
            confirmation_url: Some(String::new()),
            plans: Some(json!([{ "reference": "pl_pro" }])),
            balance: Some(json!({ "creditBalance": 0 })),
            product_details: Some(json!({ "name": "Demo" })),
        };
        let value = serde_json::to_value(paywall_tool_result("activate", &gate)).unwrap();
        let sc = value.get("structuredContent").unwrap();
        assert_eq!(sc.get("confirmationUrl"), Some(&json!("")));
        assert!(sc.get("plans").is_some());
        assert!(sc.get("balance").is_some());
        assert!(sc.get("productDetails").is_some());
    }
}
