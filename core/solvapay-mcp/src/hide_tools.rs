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

/// True when the tool's audience is one of `audiences`.
///
/// `_meta["openai/visibility"] = "private"` marks a tool as app-only and counts
/// as the `ui` audience even when `_meta.audience` is absent. It is never a hide
/// signal on its own: app-only transport tools must stay in `tools/list` so the
/// widget can call them, and the host is what excludes them from the model's list.
#[must_use]
pub fn is_hidden_by_audience(tool: &Value, audiences: &[String]) -> bool {
    if audiences.is_empty() {
        return false;
    }
    let meta = tool.get("_meta");
    let audience = meta
        .and_then(|m| m.get("audience"))
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            let private = meta
                .and_then(|m| m.get("openai/visibility"))
                .and_then(Value::as_str)
                == Some("private");
            if private {
                "ui"
            } else {
                ""
            }
        });
    audiences.iter().any(|hidden| hidden == audience)
}

/// Filter tools by `_meta.audience`. User-Agent is not a hide signal.
#[must_use]
pub fn mcp_hide_tools_by_audience(input: &HideToolsInput) -> Value {
    let _ = &input.user_agent;
    let tools: Vec<Value> = input
        .tools
        .iter()
        .filter(|tool| !is_hidden_by_audience(tool, &input.audiences))
        .cloned()
        .collect();
    json!({ "tools": tools })
}
