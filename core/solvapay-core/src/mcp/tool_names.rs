//! MCP tool name table + view maps (Step 35).
//!
//! Parity target: `packages/mcp-core/src/tool-names.ts` + `TOOL_FOR_VIEW` /
//! `VIEW_FOR_TOOL` in `types.ts`.

use serde::Serialize;
use serde_json::{Map, Value};

/// CamelCase key → snake_case tool-name value (12 entries).
pub const MCP_TOOL_NAMES: &[(&str, &str)] = &[
    ("createPayment", "create_payment_intent"),
    ("processPayment", "process_payment"),
    ("createTopupPayment", "create_topup_payment_intent"),
    ("cancelRenewal", "cancel_renewal"),
    ("reactivateRenewal", "reactivate_renewal"),
    ("activatePlan", "activate_plan"),
    ("createCheckoutSession", "create_checkout_session"),
    ("createCustomerSession", "create_customer_session"),
    ("attachBusinessDetails", "attach_business_details"),
    ("upgrade", "upgrade"),
    ("manageAccount", "manage_account"),
    ("topup", "topup"),
];

/// View → intent-tool map (`TOOL_FOR_VIEW`).
pub const TOOL_FOR_VIEW: &[(&str, &str)] = &[
    ("checkout", "upgrade"),
    ("account", "manage_account"),
    ("topup", "topup"),
];

/// Intent-tool → view map (`VIEW_FOR_TOOL`).
pub const VIEW_FOR_TOOL: &[(&str, &str)] = &[
    ("upgrade", "checkout"),
    ("manage_account", "account"),
    ("topup", "topup"),
];

/// JSON object for the `MCP_TOOL_NAMES` fixture binding.
#[must_use]
pub fn mcp_tool_names_json() -> Value {
    let mut map = Map::new();
    for (key, value) in MCP_TOOL_NAMES {
        map.insert((*key).to_owned(), Value::String((*value).to_owned()));
    }
    Value::Object(map)
}

/// Combined view-map payload for the `mcpViewMaps` fixture binding.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "SCREAMING_SNAKE_CASE")]
pub struct McpViewMaps {
    /// `TOOL_FOR_VIEW`.
    pub tool_for_view: Map<String, Value>,
    /// `VIEW_FOR_TOOL`.
    pub view_for_tool: Map<String, Value>,
}

/// Build [`McpViewMaps`] from the const tables.
#[must_use]
pub fn mcp_view_maps() -> McpViewMaps {
    McpViewMaps {
        tool_for_view: pairs_to_map(TOOL_FOR_VIEW),
        view_for_tool: pairs_to_map(VIEW_FOR_TOOL),
    }
}

/// Convert `&[(&str, &str)]` pairs into a JSON string map.
fn pairs_to_map(pairs: &[(&str, &str)]) -> Map<String, Value> {
    let mut map = Map::new();
    for (key, value) in pairs {
        map.insert((*key).to_owned(), Value::String((*value).to_owned()));
    }
    map
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
    fn tool_names_has_twelve_entries() {
        assert_eq!(MCP_TOOL_NAMES.len(), 12);
        let json = mcp_tool_names_json();
        assert_eq!(json.as_object().unwrap().len(), 12);
        assert_eq!(json["createPayment"], "create_payment_intent");
        assert_eq!(json["upgrade"], "upgrade");
    }

    #[test]
    fn view_maps_invert() {
        let maps = mcp_view_maps();
        assert_eq!(maps.tool_for_view["checkout"], "upgrade");
        assert_eq!(maps.view_for_tool["upgrade"], "checkout");
        assert_eq!(maps.tool_for_view["account"], "manage_account");
        assert_eq!(maps.view_for_tool["manage_account"], "account");
        assert_eq!(maps.tool_for_view["topup"], "topup");
        assert_eq!(maps.view_for_tool["topup"], "topup");
    }
}
