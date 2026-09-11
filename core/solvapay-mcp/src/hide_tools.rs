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
/// `_meta["openai/visibility"] = "private"` is treated as the `ui` audience
/// when `_meta.audience` is absent, so hiding `ui` also drops private tools
/// from `tools/list`. That is a catalog filter only — see [`is_app_callable`]
/// for whether a hidden tool may still be invoked.
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

/// True when a tool declares itself callable from the MCP App iframe.
/// SEP-1865 `_meta.ui.visibility` is primary; `openai/widgetAccessible`
/// is the ChatGPT Apps SDK equivalent.
#[must_use]
pub fn is_app_callable(tool: &Value) -> bool {
    let Some(meta) = tool.get("_meta") else {
        return false;
    };
    let visibility_app = meta
        .pointer("/ui/visibility")
        .and_then(Value::as_array)
        .is_some_and(|items| items.iter().any(|v| v.as_str() == Some("app")));
    visibility_app || meta.get("openai/widgetAccessible") == Some(&Value::Bool(true))
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
