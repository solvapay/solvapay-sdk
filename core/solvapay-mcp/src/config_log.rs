//! One-line MCP config log payload (`logMcpConfigOnce` message body).

use serde::Deserialize;
use serde_json::{json, Value};

/// Input for [`mcp_config_log`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigLogInput {
    /// API origin.
    pub api_base_url: String,
    /// Product ref.
    pub product_ref: String,
    /// Public MCP origin.
    pub public_base_url: String,
}

/// Build the config log line (does not print; once-per-process is host-side).
#[must_use]
pub fn mcp_config_log(input: &ConfigLogInput) -> Value {
    json!({
        "message": format!(
            "[solvapay] mcp config apiBaseUrl={} productRef={} publicBaseUrl={}",
            input.api_base_url, input.product_ref, input.public_base_url
        )
    })
}
