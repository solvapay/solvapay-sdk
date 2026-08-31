//! Client-less `(op, args_json) -> envelope_json` dispatch.

use serde_json::Value;
use solvapay_core::{
    envelope_from_panic_payload, parse_args_json, run_envelope_sync, validate_business_details,
    BusinessDetailsInput, SdkError,
};

use crate::auth_gate::{
    is_free_mcp_method, mcp_auth_gate, requires_bearer_auth, AuthGateInput, McpAuthMode,
};
use crate::config_log::{mcp_config_log, ConfigLogInput};
use crate::csp::{mcp_merge_csp, SolvaPayMcpCsp};
use crate::dcr::{mcp_dcr_diagnostics, DcrDiagnosticsInput};
use crate::descriptors::{mcp_descriptors, McpDescriptorsInput};
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
    match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        dispatch_inner(op, args_json)
    })) {
        Ok(s) => s,
        Err(payload) => envelope_from_panic_payload(payload),
    }
}

fn dispatch_inner(op: &str, args_json: &str) -> String {
    run_envelope_sync(|| match op {
        "validateBusinessDetails" => {
            let input: BusinessDetailsInput = parse_args_json(args_json)?;
            serde_json::to_value(validate_business_details(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))
        }
        "mcpDescriptors" => {
            let input: McpDescriptorsInput = parse_args_json(args_json)?;
            match mcp_descriptors(&input) {
                Ok(value) => serde_json::to_value(value)
                    .map_err(|err| SdkError::transport(format!("serialize: {err}"), false)),
                Err(message) => Err(SdkError::transport(message, false)),
            }
        }
        "mcpMergeCsp" => {
            let args: Value = parse_args_json(args_json)?;
            let overrides = args
                .get("overrides")
                .cloned()
                .map(serde_json::from_value::<SolvaPayMcpCsp>)
                .transpose()
                .map_err(|err| SdkError::transport(format!("invalid overrides: {err}"), false))?;
            let api_base_url = args.get("apiBaseUrl").and_then(Value::as_str);
            serde_json::to_value(mcp_merge_csp(overrides.as_ref(), api_base_url))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))
        }
        "mcpOverviewResource" => serde_json::to_value(mcp_overview_resource())
            .map_err(|err| SdkError::transport(format!("serialize: {err}"), false)),
        "mcpOauthDiscovery" => {
            let input: OauthDiscoveryInput = parse_args_json(args_json)?;
            Ok(mcp_oauth_discovery(&input))
        }
        "mcpOauthPath" => {
            let input: OauthPathInput = parse_args_json(args_json)?;
            Ok(mcp_oauth_path(&input))
        }
        "mcpOauthErrorInspect" => {
            let input: OauthErrorInspectInput = parse_args_json(args_json)?;
            Ok(mcp_oauth_error_inspect(&input))
        }
        "mcpNormalizeOauthError" => {
            let args: Value = parse_args_json(args_json)?;
            let body = args.get("body").cloned().unwrap_or(Value::Null);
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            let status = args.get("status").and_then(Value::as_i64).unwrap_or(400);
            Ok(mcp_normalize_oauth_error(&body, text, status))
        }
        "mcpAuthGate" => {
            let input: AuthGateInput = parse_args_json(args_json)?;
            serde_json::to_value(mcp_auth_gate(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))
        }
        "mcpIsFreeMethod" => {
            let args: Value = parse_args_json(args_json)?;
            let method = args.get("mcpMethod").and_then(Value::as_str);
            Ok(Value::Bool(is_free_mcp_method(method)))
        }
        "mcpRequiresBearerAuth" => {
            let args: Value = parse_args_json(args_json)?;
            let method = args.get("mcpMethod").and_then(Value::as_str);
            let mode = args
                .get("authMode")
                .cloned()
                .map(serde_json::from_value::<McpAuthMode>)
                .transpose()
                .map_err(|err| SdkError::transport(format!("invalid authMode: {err}"), false))?
                .unwrap_or(McpAuthMode::ToolsCall);
            Ok(Value::Bool(requires_bearer_auth(method, mode)))
        }
        "mcpDcrDiagnostics" => {
            let input: DcrDiagnosticsInput = parse_args_json(args_json)?;
            Ok(mcp_dcr_diagnostics(&input))
        }
        "mcpConfigLog" => {
            let input: ConfigLogInput = parse_args_json(args_json)?;
            Ok(mcp_config_log(&input))
        }
        "mcpHideToolsByAudience" => {
            let input: HideToolsInput = parse_args_json(args_json)?;
            Ok(mcp_hide_tools_by_audience(&input))
        }
        "mcpNarrate" => {
            let input: NarrateInput = parse_args_json(args_json)?;
            Ok(mcp_narrate(&input))
        }
        "mcpWidgetResource" => {
            #[cfg(feature = "engine")]
            {
                let input: crate::widget_resource::McpWidgetResourceInput =
                    parse_args_json(args_json)?;
                crate::widget_resource::mcp_widget_resource(&input)
                    .map(|value| value.unwrap_or(Value::Null))
                    .map_err(|message| SdkError::transport(message, false))
            }
            #[cfg(not(feature = "engine"))]
            {
                Err(SdkError::transport(
                    "mcpWidgetResource requires engine feature",
                    false,
                ))
            }
        }
        "mcpHandleRequest" => {
            #[cfg(feature = "engine")]
            {
                let input: crate::engine::HandleRequestInput = parse_args_json(args_json)?;
                crate::engine::mcp_handle_request(&input)
                    .map_err(|message| SdkError::transport(message, false))
            }
            #[cfg(not(feature = "engine"))]
            {
                Err(SdkError::transport(
                    "mcpHandleRequest requires engine feature",
                    false,
                ))
            }
        }
        "mcpResume" => {
            #[cfg(feature = "engine")]
            {
                let input: crate::engine::ResumeInput = parse_args_json(args_json)?;
                crate::engine::mcp_resume(&input)
                    .map_err(|message| SdkError::transport(message, false))
            }
            #[cfg(not(feature = "engine"))]
            {
                Err(SdkError::transport(
                    "mcpResume requires engine feature",
                    false,
                ))
            }
        }
        other => Err(SdkError::transport(format!("unknown op: {other}"), false)),
    })
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
    dispatch_sync(op, &args.to_string())
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
