//! Response envelope constructors (`makeResponseResult` / `assertResponseResult`).

use serde::{Deserialize, Serialize};
use serde_json::Value;
use solvapay_dto::error_templates::mcp as mcp_messages;

/// Branded response envelope (`ResponseResult` parity).
///
/// `options` is omitted when `None`; `emitted_blocks` is omitted when empty.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResponseEnvelope {
    /// Opaque brand marker — always `true`.
    #[serde(rename = "__solvapayResponse")]
    pub solvapay_response: bool,
    /// Merchant handler data payload.
    pub data: Value,
    /// Optional response options (raw pass-through).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Value>,
    /// Content blocks queued via `ctx.emit` before `respond`.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub emitted_blocks: Vec<Value>,
}

/// Construct a branded [`ResponseEnvelope`].
///
/// # Arguments
///
/// * `data` - Handler return data (including JSON `null`).
/// * `options` - Optional options object; omitted from JSON when `None`.
/// * `emitted_blocks` - Emitted content blocks; key omitted when empty.
///
/// # Returns
///
/// Envelope with `__solvapayResponse: true` and skip-absent optionals.
pub fn make_response_result(
    data: Value,
    options: Option<Value>,
    emitted_blocks: Vec<Value>,
) -> ResponseEnvelope {
    ResponseEnvelope {
        solvapay_response: true,
        data,
        options,
        emitted_blocks,
    }
}

/// Assert `value` is a branded response envelope.
///
/// # Errors
///
/// Returns the frozen merchant-actionable message when the brand check fails.
pub fn assert_response_result(value: &Value) -> Result<Value, &'static str> {
    let is_branded = value
        .as_object()
        .and_then(|obj| obj.get("__solvapayResponse"))
        .and_then(Value::as_bool)
        == Some(true);
    if is_branded {
        Ok(value.clone())
    } else {
        Err(mcp_messages::RAW_HANDLER_RETURN)
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
    fn brand_always_true() {
        let env = make_response_result(json!({ "ok": true }), None, vec![]);
        assert!(env.solvapay_response);
        let value = serde_json::to_value(&env).unwrap();
        assert_eq!(value.get("__solvapayResponse"), Some(&json!(true)));
    }

    #[test]
    fn options_none_omitted() {
        let value = serde_json::to_value(make_response_result(json!(1), None, vec![])).unwrap();
        assert!(value.get("options").is_none());
    }

    #[test]
    fn options_some_emitted() {
        let options = json!({ "text": "hi" });
        let value = serde_json::to_value(make_response_result(
            json!(1),
            Some(options.clone()),
            vec![],
        ))
        .unwrap();
        assert_eq!(value.get("options"), Some(&options));
    }

    #[test]
    fn empty_emitted_blocks_omitted() {
        let value = serde_json::to_value(make_response_result(json!(1), None, vec![])).unwrap();
        assert!(value.get("emittedBlocks").is_none());
    }

    #[test]
    fn nonempty_emitted_blocks_emitted() {
        let blocks = vec![json!({ "type": "text", "text": "note" })];
        let value =
            serde_json::to_value(make_response_result(json!(1), None, blocks.clone())).unwrap();
        assert_eq!(value.get("emittedBlocks"), Some(&json!(blocks)));
    }

    #[test]
    fn assert_passthrough_branded() {
        let value = json!({
            "__solvapayResponse": true,
            "data": { "ok": true }
        });
        assert_eq!(assert_response_result(&value).unwrap(), value);
    }

    #[test]
    fn assert_rejects_raw_object_brand_false_null_primitive() {
        let msg = mcp_messages::RAW_HANDLER_RETURN;
        assert_eq!(
            assert_response_result(&json!({ "ok": true })).unwrap_err(),
            msg
        );
        assert_eq!(
            assert_response_result(&json!({
                "__solvapayResponse": false,
                "data": {}
            }))
            .unwrap_err(),
            msg
        );
        assert_eq!(assert_response_result(&Value::Null).unwrap_err(), msg);
        assert_eq!(assert_response_result(&json!("raw")).unwrap_err(), msg);
    }
}
