//! Audience filter for `tools/list` (`applyHideToolsByAudience` data plane).

use serde::Deserialize;
use serde_json::{json, Value};

/// Input for [`mcp_hide_tools_by_audience`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HideToolsInput {
    /// Tool descriptors (must include `_meta.audience` when hidden).
    pub tools: Vec<Value>,
    /// Audiences to hide (e.g. `["ui"]`).
    pub audiences: Vec<String>,
    /// Accepted for wire compatibility. Ignored — a User-Agent must not bypass hiding.
    #[serde(default)]
    pub user_agent: Option<String>,
}

/// True when `tool._meta.audience` is one of `audiences`.
#[must_use]
pub fn is_hidden_by_audience(tool: &Value, audiences: &[String]) -> bool {
    if audiences.is_empty() {
        return false;
    }
    let audience = tool
        .get("_meta")
        .and_then(|m| m.get("audience"))
        .and_then(Value::as_str)
        .unwrap_or("");
    audiences.iter().any(|hidden| hidden == audience)
}

/// Filter tools by `_meta.audience`. User-Agent is not a hide signal.
#[must_use]
pub fn mcp_hide_tools_by_audience(input: &HideToolsInput) -> Value {
    let _ = &input.user_agent;
    if input.audiences.is_empty() {
        return json!({ "tools": input.tools });
    }
    let tools: Vec<Value> = input
        .tools
        .iter()
        .filter(|tool| !is_hidden_by_audience(tool, &input.audiences))
        .cloned()
        .collect();
    json!({ "tools": tools })
}
