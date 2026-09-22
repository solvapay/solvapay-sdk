//! Client-less `(op, args_json) -> envelope_json` dispatch.

use serde::de::DeserializeOwned;
use serde_json::Value;
use solvapay_core::{
    envelope_from_panic_payload, run_envelope_sync, validate_business_details,
    BusinessDetailsInput, SdkError,
};

use crate::auth_gate::{
    is_free_mcp_method, mcp_auth_gate, requires_bearer_auth, AuthGateInput, McpAuthMode,
};
use crate::bearer_verify::{mcp_verify_bearer, VerifyBearerInput};
use crate::config_log::{mcp_config_log, ConfigLogInput};
use crate::cors::{mcp_native_cors, NativeCorsInput};
use crate::csp::{mcp_merge_csp, SolvaPayMcpCsp};
use crate::dcr::{mcp_dcr_diagnostics, DcrDiagnosticsInput};
use crate::default_gate::{mcp_default_gate, DefaultGateInput};
use crate::descriptor_schemas::{mcp_descriptors, McpDescriptorsInput};
use crate::hide_tools::{mcp_hide_tools_by_audience, HideToolsInput};
use crate::narrate::{mcp_narrate, NarrateInput};
use crate::oauth::{
    mcp_normalize_oauth_error, mcp_oauth_discovery, mcp_oauth_error_inspect, mcp_oauth_path,
    OauthDiscoveryInput, OauthErrorInspectInput, OauthPathInput,
};
use crate::overview::mcp_overview_resource;

/// Dispatch a sync op. Unknown ops become a Transport error envelope.
#[must_use]
pub fn dispatch_sync(op: &str, args_json: &str) -> String {
    let args: Value = match serde_json::from_str(args_json) {
        Ok(value) => value,
        Err(err) => {
            return solvapay_core::err_envelope(&SdkError::transport(
                format!("invalid args: {err}"),
                false,
            ));
        }
    };
    dispatch_sync_value(op, &args)
}

/// Same as [`dispatch_sync`] without a JSON round-trip of `args`.
#[must_use]
pub fn dispatch_sync_value(op: &str, args: &Value) -> String {
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| dispatch_inner(op, args))) {
        Ok(s) => s,
        Err(payload) => envelope_from_panic_payload(payload),
    }
}

fn parse_value<T: DeserializeOwned>(args: &Value) -> Result<T, SdkError> {
    serde_json::from_value(args.clone())
        .map_err(|err| SdkError::transport(format!("invalid args: {err}"), false))
}

fn dispatch_inner(op: &str, args: &Value) -> String {
    run_envelope_sync(|| dispatch_op(op, args))
}

include!("sync_dispatch.generated.rs");

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod manifest_ops {
    use super::dispatch_sync_value;
    use crate::sync_ops::MCP_SYNC_OPS;
    use serde_json::json;

    #[test]
    fn every_manifest_sync_op_is_recognized() {
        for op in MCP_SYNC_OPS {
            let envelope: serde_json::Value =
                serde_json::from_str(&dispatch_sync_value(op, &json!({}))).expect("json");
            let message = envelope["error"]["message"].as_str().unwrap_or("");
            assert!(
                !message.starts_with("unknown op:"),
                "{op} missing from dispatch_inner: {message}"
            );
        }
    }
}

/// Parse `{op, args}` JSON and run [`dispatch_sync`].
#[must_use]
pub fn solvapay_call(args_json: &str) -> String {
    let parsed: Value = match serde_json::from_str(args_json) {
        Ok(value) => value,
        Err(err) => {
            return solvapay_core::err_envelope(&SdkError::transport(
                format!("invalid solvapay_call args: {err}"),
                false,
            ));
        }
    };
    let Some(op) = parsed.get("op").and_then(Value::as_str) else {
        return solvapay_core::err_envelope(&SdkError::transport("missing op", false));
    };
    let args = parsed
        .get("args")
        .cloned()
        .unwrap_or_else(|| Value::Object(serde_json::Map::new()));
    dispatch_sync_value(op, &args)
}

#[cfg(test)]
#[allow(clippy::expect_used)]
mod tests {
    use super::solvapay_call;
    use serde_json::Value;

    #[test]
    fn solvapay_call_rejects_missing_op() {
        let parsed: Value = serde_json::from_str(&solvapay_call("{}")).expect("json");
        assert_eq!(parsed["ok"], false);
        assert_eq!(parsed["error"]["message"], "missing op");
    }

    #[test]
    fn solvapay_call_dispatches_mcp_oauth_path() {
        let envelope = solvapay_call(
            r#"{"op":"mcpOauthPath","args":{"kind":"strip-trailing-slash","value":"https://api.test/"}}"#,
        );
        let parsed: Value = serde_json::from_str(&envelope).expect("json");
        assert_eq!(parsed["ok"], true);
        assert_eq!(parsed["value"], "https://api.test");
    }
}
