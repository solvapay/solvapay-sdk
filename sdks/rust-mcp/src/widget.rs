//! Host-served MCP App HTML for `resources/read`.

use serde_json::{json, Value};

/// JSON-RPC result body when the request reads this server's widget URI.
pub fn widget_html_rpc(
    rpc: &Value,
    resource_uri: &str,
    public_base_url: &str,
    product_ref: &str,
) -> Result<Option<Value>, String> {
    let envelope = crate::layer2_generated::mcp_widget_resource(
        rpc.clone(),
        json!(resource_uri),
        json!(public_base_url),
        json!(product_ref),
        None,
        None,
        None,
        None,
    )?;
    if envelope.is_null() {
        return Ok(None);
    }
    let mut envelope = envelope;
    let first = envelope
        .pointer_mut("/result/contents/0")
        .ok_or_else(|| "mcpWidgetResource omitted contents[0]".to_owned())?;
    if !first.is_object() {
        return Err("mcpWidgetResource omitted contents[0]".to_owned());
    }
    first["text"] = json!(crate::default_mcp_app_html());
    Ok(Some(envelope))
}
