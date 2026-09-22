//! Thin host glue over `solvapay-mcp-core` sync dispatch.

use serde_json::Value;
use solvapay_mcp_core::dispatch_sync;

/// Invoke a client-less MCP op. Returns the envelope `value` on success.
pub fn call_sync(op: &str, args: &Value) -> Result<Value, String> {
    let envelope: Value = serde_json::from_str(&dispatch_sync(op, &args.to_string()))
        .map_err(|err| err.to_string())?;
    if envelope.get("ok") == Some(&Value::Bool(true)) {
        Ok(envelope.get("value").cloned().unwrap_or(Value::Null))
    } else {
        Err(envelope
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("mcp op failed")
            .to_owned())
    }
}
