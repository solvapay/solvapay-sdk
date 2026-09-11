//! Allow-path MCP tool result (`unwrapResponseEnvelope` parity).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::mcp::envelope::ResponseEnvelope;
use crate::paywall_state::{build_nudge_message, credit_signals, PaywallLimits, PaywallState};

/// MCP tool result for an allowed payable handler (`SolvaPayCallToolResult` allow path).
///
/// `is_error` is omitted (`skip_serializing_if`) — allow is not a tool error.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpPayableToolResult {
    /// Omitted on the allow path.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub is_error: Option<bool>,
    /// Emitted blocks, primary text, optional trailing JSON, optional nudge resource.
    pub content: Vec<Value>,
    /// Raw merchant `data` (not the branded envelope).
    pub structured_content: Value,
}

/// Compact JSON of `value`, preserving insertion order.
fn compact_json(value: &Value) -> String {
    serde_json::to_string(value).unwrap_or_else(|_| "null".to_owned())
}

/// Resolve nudge copy from an explicit message, else [`build_nudge_message`].
fn resolve_nudge_text(nudge: &Value, limits: Option<&Value>) -> String {
    let message = nudge.get("message").and_then(Value::as_str).unwrap_or("");
    if !message.is_empty() {
        return message.to_owned();
    }
    let kind = nudge.get("kind").and_then(Value::as_str).unwrap_or("");
    let parsed =
        limits.and_then(|value| serde_json::from_value::<PaywallLimits>(value.clone()).ok());
    let credit_based = credit_signals(parsed.as_ref()).is_credit_based;
    let state = if kind == "low-balance" && credit_based {
        PaywallState::TopupRequired
    } else {
        PaywallState::UpgradeRequired
    };
    build_nudge_message(&state, parsed.as_ref())
}

/// Unwrap a branded [`ResponseEnvelope`] into an MCP allow-path tool result.
///
/// Emits merchant/emitted blocks, primary text (with optional nudge suffix),
/// a trailing JSON text block unless `options.dataInText` is `false`, and a
/// `solvapay://nudge` resource when a nudge is present.
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
    let compact_data = compact_json(&envelope.data);
    let text_override = options.and_then(|o| o.get("text")).and_then(Value::as_str);
    let base_text = match text_override {
        Some(text) => text.to_owned(),
        None => compact_data.clone(),
    };

    let nudge_text = options
        .and_then(|o| o.get("nudge"))
        .map(|nudge| resolve_nudge_text(nudge, envelope.limits.as_ref()));
    let primary_text = match nudge_text.as_deref() {
        Some(nudge) if base_text.is_empty() => nudge.to_owned(),
        Some(nudge) => format!("{base_text}\n\n{nudge}"),
        None => base_text,
    };
    let data_in_text = options
        .and_then(|o| o.get("dataInText"))
        .and_then(Value::as_bool)
        != Some(false);
    let has_narration = text_override.is_some() || nudge_text.is_some();

    let mut content = envelope.emitted_blocks.clone();
    content.push(json!({ "type": "text", "text": primary_text }));
    if data_in_text && has_narration {
        content.push(json!({ "type": "text", "text": compact_data }));
    }
    if let Some(nudge) = nudge_text {
        content.push(json!({
            "type": "resource",
            "resource": {
                "uri": "solvapay://nudge",
                "mimeType": "text/plain",
                "text": nudge,
            }
        }));
    }

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

    fn text_at(result: &McpPayableToolResult, index: usize) -> &str {
        result.content[index].get("text").unwrap().as_str().unwrap()
    }

    #[test]
    fn minimal_respond_compacts_data() {
        let env = make_response_result(
            json!({ "foo": "bar", "list": [1, 2, 3] }),
            None,
            vec![],
            None,
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(result.content.len(), 1);
        assert_eq!(text_at(&result, 0), r#"{"foo":"bar","list":[1,2,3]}"#);
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
            None,
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(text_at(&result, 0), "Found 1 result");
        assert_eq!(text_at(&result, 1), r#"{"x":1}"#);
        assert_eq!(result.structured_content, json!({ "x": 1 }));
    }

    #[test]
    fn data_in_text_false_omits_trailing_json() {
        let env = make_response_result(
            json!({ "foo": "bar" }),
            Some(json!({ "dataInText": false })),
            vec![],
            None,
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(result.content.len(), 1);
        assert_eq!(text_at(&result, 0), r#"{"foo":"bar"}"#);
    }

    #[test]
    fn nudge_suffix_appended() {
        let env = make_response_result(
            json!({ "y": 2 }),
            Some(json!({
                "nudge": { "kind": "low-balance", "message": "Running low on credits" }
            })),
            vec![],
            None,
        );
        let result = build_payable_tool_result(&env);
        assert_eq!(text_at(&result, 0), "{\"y\":2}\n\nRunning low on credits");
        assert_eq!(text_at(&result, 1), "{\"y\":2}");
        assert_eq!(
            result.content[2],
            json!({
                "type": "resource",
                "resource": {
                    "uri": "solvapay://nudge",
                    "mimeType": "text/plain",
                    "text": "Running low on credits"
                }
            })
        );
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
            None,
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
            None,
        );
        let result = build_payable_tool_result(&env);
        let expected = build_nudge_message(&PaywallState::UpgradeRequired, None);
        assert_eq!(text_at(&result, 0), format!("{{\"z\":3}}\n\n{expected}"));
        assert_eq!(text_at(&result, 1), r#"{"z":3}"#);
    }

    #[test]
    fn empty_low_balance_nudge_uses_limits_credit_signals() {
        let env = make_response_result(
            json!({ "z": 3 }),
            Some(json!({ "nudge": { "kind": "low-balance", "message": "" } })),
            vec![],
            Some(json!({ "creditBalance": 5.0, "creditsPerUnit": 10.0 })),
        );
        let result = build_payable_tool_result(&env);
        let parsed: PaywallLimits =
            serde_json::from_value(json!({ "creditBalance": 5.0, "creditsPerUnit": 10.0 }))
                .unwrap();
        let expected = build_nudge_message(&PaywallState::TopupRequired, Some(&parsed));
        assert_eq!(text_at(&result, 0), format!("{{\"z\":3}}\n\n{expected}"));
    }

    #[test]
    fn key_order_is_insertion_not_sorted() {
        let env = make_response_result(json!({ "zebra": 1, "apple": 2 }), None, vec![], None);
        let result = build_payable_tool_result(&env);
        assert_eq!(text_at(&result, 0), r#"{"zebra":1,"apple":2}"#);
        assert_eq!(result.content.len(), 1);
        assert_ne!(text_at(&result, 0), r#"{"apple":2,"zebra":1}"#);
    }
}
