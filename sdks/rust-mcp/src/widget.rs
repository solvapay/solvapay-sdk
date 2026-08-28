//! Host-served MCP App HTML for `resources/read`.

use serde_json::{json, Value};

/// JSON-RPC result body when the request reads this server's widget URI.
pub fn widget_html_rpc(rpc: &Value, resource_uri: &str) -> Option<Value> {
    if rpc.get("method").and_then(Value::as_str) != Some("resources/read") {
        return None;
    }
    let uri = rpc.pointer("/params/uri").and_then(Value::as_str)?;
    if uri != resource_uri {
        return None;
    }
    Some(json!({
        "jsonrpc": "2.0",
        "id": rpc.get("id").cloned().unwrap_or(Value::Null),
        "result": {
            "contents": [{
                "uri": uri,
                "mimeType": crate::MCP_APP_MIME_TYPE,
                "text": crate::default_mcp_app_html(),
                "_meta": { "ui": { "prefersBorder": false } }
            }]
        }
    }))
}
