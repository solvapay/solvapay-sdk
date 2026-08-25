//! Allow-path MCP tool result (`unwrapResponseEnvelope` parity).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::mcp::envelope::ResponseEnvelope;
use crate::paywall_state::{build_nudge_message, PaywallState};

/// MCP tool result for an allowed payable handler (`SolvaPayCallToolResult` allow path).
///
/// `is_error` is omitted (`skip_serializing_if`) — allow is not a tool error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPayableToolResult {
    /// Omitted on the allow path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// Emitted blocks, then one `{ type: "text", text }` primary block.
    pub content: Vec<Value>,
    /// Raw merchant `data` (not the branded envelope).
    pub structured_content: Value,
}

/// Unwrap a branded [`ResponseEnvelope`] into an MCP allow-path tool result.
///
/// # Arguments
///
/// * `envelope` - Branded handler return (`make_response_result`).
///
/// # Returns
///
/// [`McpPayableToolResult`] with `isError` omitted, `structuredContent` = `data`.
/// `options.units` is accepted and ignored (V1 billing stays one unit).
/// Compact JSON of `data` keeps insertion order via workspace `serde_json`
/// `preserve_order`.
#[crate::solvapay_export(
    artifact = "payloadBuilders",
    catalog = "none",
    section = "MCP payload / descriptors",
    emit_order = 23
)]
pub fn build_payable_tool_result(envelope: &ResponseEnvelope) -> McpPayableToolResult {
    let options = envelope.options.as_ref().and_then(Value::as_object);
    let text_override = options.and_then(|o| o.get("text")).and_then(Value::as_str);
    let base_text = match text_override {
        Some(text) => text.to_owned(),
        None => serde_json::to_string(&envelope.data).unwrap_or_else(|_| "null".to_owned()),
    };

    let primary_text = match options.and_then(|o| o.get("nudge")) {
        Some(nudge) => {
            let message = nudge.get("message").and_then(Value::as_str).unwrap_or("");
            let nudge_text = if !message.is_empty() {
                message.to_owned()
            } else {
                let kind = nudge.get("kind").and_then(Value::as_str).unwrap_or("");
                let state = if kind == "low-balance" {
                    PaywallState::TopupRequired
                } else {
                    PaywallState::UpgradeRequired
                };
                build_nudge_message(&state, None)
            };
            if base_text.is_empty() {
                nudge_text
            } else {
                format!("{base_text}\n\n{nudge_text}")
            }
        }
        None => base_text,
    };

    let mut content = envelope.emitted_blocks.clone();
    content.push(json!({ "type": "text", "text": primary_text }));

    McpPayableToolResult {
        is_error: None,
        content,
        structured_content: envelope.data.clone(),
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
    use crate::mcp::envelope::make_response_result;
    use serde_json::json;

    fn text_of(result: &McpPayableToolResult) -> &str {
        result
            .content
            .last()
            .unwrap()
            .get("text")
            .unwrap()
            .as_str()
            .unwrap()
    }

    #[test]
    fn minimal_respond_compacts_data() {
        let env = make_response_result(json!({ "foo": "bar", "list": [1, 2, 3] }), None, vec![]);
        let result = build_payable_tool_result(&env);
        assert_eq!(text_of(&result), r#"{"foo":"bar","list":[1,2,3]}"#);
        assert_eq!(
            result.structured_content,
            json!({ "foo": "bar", "list": [1, 2, 3] })
        );
        let value = serde_json::to_value(&result).unwrap();
        assert!(value.get("isError").is_none());
    }

    #[test]
    fn options_text_replaces_primary() {
        let env = make_response_result(
            json!({ "x": 1 }),
            Some(json!({ "text": "Found 1 result" })),
            vec![],
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(text_of(&result), "Found 1 result");
        assert_eq!(result.structured_content, json!({ "x": 1 }));
    }

    #[test]
    fn nudge_suffix_appended() {
        let env = make_response_result(
            json!({ "y": 2 }),
            Some(json!({
                "nudge": { "kind": "low-balance", "message": "Running low on credits" }
            })),
            vec![],
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(text_of(&result), "{\"y\":2}\n\nRunning low on credits");
        assert_eq!(result.structured_content, json!({ "y": 2 }));
    }

    #[test]
    fn emitted_blocks_precede_text() {
        let env = make_response_result(
            json!({ "final": true }),
            None,
            vec![
                json!({ "type": "text", "text": "intermediate 1" }),
                json!({ "type": "text", "text": "intermediate 2" }),
            ],
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(
            result.content,
            vec![
                json!({ "type": "text", "text": "intermediate 1" }),
                json!({ "type": "text", "text": "intermediate 2" }),
                json!({ "type": "text", "text": "{\"final\":true}" }),
            ]
        );
    }

    #[test]
    fn empty_nudge_falls_through_to_build_nudge_message() {
        let env = make_response_result(
            json!({ "z": 3 }),
            Some(json!({ "nudge": { "kind": "low-balance", "message": "" } })),
            vec![],
        );
        let result = build_payable_tool_result(&env);
        let expected = build_nudge_message(&PaywallState::TopupRequired, None);
        assert_eq!(text_of(&result), format!("{{\"z\":3}}\n\n{expected}"));
    }

    #[test]
    fn key_order_is_insertion_not_sorted() {
        let env = make_response_result(json!({ "zebra": 1, "apple": 2 }), None, vec![]);
        let result = build_payable_tool_result(&env);
        assert_eq!(text_of(&result), r#"{"zebra":1,"apple":2}"#);
        assert_ne!(text_of(&result), r#"{"apple":2,"zebra":1}"#);
    }
}
