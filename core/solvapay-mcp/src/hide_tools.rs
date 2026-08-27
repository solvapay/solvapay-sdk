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
    /// Optional User-Agent (ChatGPT bypass).
    #[serde(default)]
    pub user_agent: Option<String>,
}

/// Filter tools by `_meta.audience`, bypassing when UA matches `/openai-mcp/i`.
#[must_use]
pub fn mcp_hide_tools_by_audience(input: &HideToolsInput) -> Value {
    if input.audiences.is_empty() {
        return json!({ "tools": input.tools });
    }
    if input
        .user_agent
        .as_deref()
        .is_some_and(|ua| ua.to_ascii_lowercase().contains("openai-mcp"))
    {
        return json!({ "tools": input.tools, "bypassed": true });
    }
    let hidden: Vec<&str> = input.audiences.iter().map(String::as_str).collect();
    let tools: Vec<Value> = input
        .tools
        .iter()
        .filter(|tool| {
            let audience = tool
                .get("_meta")
                .and_then(|m| m.get("audience"))
                .and_then(Value::as_str)
                .unwrap_or("");
            !hidden.contains(&audience)
        })
        .cloned()
        .collect();
    json!({ "tools": tools })
}
