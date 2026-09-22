//! MCP tool name table + view maps (Step 35).
//!
//! Parity target: `packages/mcp-core/src/tool-names.ts` + `TOOL_FOR_VIEW` /
//! `VIEW_FOR_TOOL` in `types.ts`.

use serde::Serialize;
use serde_json::{Map, Value};

/// Canonical viewer tool (checkout / account / topup / auto-recharge).
pub const VIEWER_TOOL_NAME: &str = "account";

/// CamelCase key → snake_case tool-name value (8 entries).
pub const MCP_TOOL_NAMES: &[(&str, &str)] = &[
    ("createPayment", "create_payment_intent"),
    ("processPayment", "process_payment"),
    ("createHostedSession", "create_hosted_session"),
    ("setRenewal", "set_renewal"),
    ("activatePlan", "activate_plan"),
    ("attachBusinessDetails", "attach_business_details"),
    ("getHistory", "get_history"),
    ("account", VIEWER_TOOL_NAME),
];

/// Slash-command prompt names. Independent of the tool catalogue.
pub const MCP_PROMPT_NAMES: &[(&str, &str)] = &[
    ("upgrade", "upgrade"),
    ("manageAccount", "manage_account"),
    ("topup", "topup"),
    ("activatePlan", "activate_plan"),
];

/// View → intent-tool map (`TOOL_FOR_VIEW`). Every surface lands on `account`.
pub const TOOL_FOR_VIEW: &[(&str, &str)] = &[
    ("checkout", VIEWER_TOOL_NAME),
    ("account", VIEWER_TOOL_NAME),
    ("topup", VIEWER_TOOL_NAME),
    ("auto-recharge", VIEWER_TOOL_NAME),
];

/// Intent-tool → view map (`VIEW_FOR_TOOL`). The viewer cannot recover the
/// landing view from the name alone — default to `account`.
pub const VIEW_FOR_TOOL: &[(&str, &str)] = &[(VIEWER_TOOL_NAME, "account")];

/// JSON object for the `MCP_TOOL_NAMES` fixture binding.
#[must_use]
#[crate::solvapay_export(
    id = "MCP_TOOL_NAMES",
    artifact = "payloadBuilders",
    catalog = "none",
    section = "MCP payload / descriptors",
    emit_order = 16,
    rust_fn_name = "mcp_tool_names_binding"
)]
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
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "none",
    section = "MCP payload / descriptors",
    emit_order = 17
)]
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
    fn tool_names_has_eight_entries() {
        assert_eq!(MCP_TOOL_NAMES.len(), 8);
        let json = mcp_tool_names_json();
        assert_eq!(json.as_object().unwrap().len(), 8);
        assert_eq!(json["createPayment"], "create_payment_intent");
        assert_eq!(json["account"], "account");
        assert_eq!(json["createHostedSession"], "create_hosted_session");
        assert_eq!(json["getHistory"], "get_history");
    }

    #[test]
    fn view_maps_collapse_onto_account() {
        let maps = mcp_view_maps();
        assert_eq!(maps.tool_for_view["checkout"], "account");
        assert_eq!(maps.tool_for_view["account"], "account");
        assert_eq!(maps.tool_for_view["topup"], "account");
        assert_eq!(maps.tool_for_view["auto-recharge"], "account");
        assert_eq!(maps.view_for_tool["account"], "account");
    }
}
