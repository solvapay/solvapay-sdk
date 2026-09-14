//! Manifest-driven MCP sync-op tables, dispatch match, and TS helper barrel.

use std::fmt::Write as _;

use crate::emit_mcp::mcp_entries;
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrEntrySection, IrMcpSurface};

fn sync_op_ids(ir: &Ir) -> Vec<String> {
    mcp_entries(ir)
        .into_iter()
        .filter(|entry| entry.mcp_surface == Some(IrMcpSurface::SyncOp))
        .map(|entry| entry.names.ts.clone())
        .collect()
}

/// `core/solvapay-mcp/src/sync_ops.generated.rs`
pub fn emit_sync_ops_rs(ir: &Ir) -> GenResult<String> {
    let mut out = generated_header(CommentStyle::LineSlash, "sync-ops-rs-out");
    out.push_str(
        "\n#[allow(dead_code)]\n/// Catalogued MCP `syncOp` ids from `sdk-contract.yaml`.\n",
    );
    out.push_str("pub const MCP_SYNC_OPS: &[&str] = &[\n");
    for id in sync_op_ids(ir) {
        let _ = writeln!(out, "    \"{id}\",");
    }
    out.push_str("];\n");
    Ok(out)
}

const TS_CUSTOM_REPLAY: &[&str] = &[
    "mcpAuthGate",
    "mcpConfigLog",
    "mcpDcrDiagnostics",
    "mcpDescriptors",
    "mcpHideToolsByAudience",
    "mcpMergeCsp",
    "mcpNormalizeOauthError",
    "mcpOauthDiscovery",
];

/// `tools/conformance/mcp-authoring/sync-ops.generated.ts`
pub fn emit_sync_ops_ts(ir: &Ir) -> GenResult<String> {
    let ids = sync_op_ids(ir);
    let mut out = generated_header(CommentStyle::Block, "sync-ops-ts-out");
    out.push_str("\nexport const MCP_SYNC_OPS = [\n");
    for id in &ids {
        let _ = writeln!(out, "  '{id}',");
    }
    out.push_str("] as const\n\nexport type McpSyncOp = (typeof MCP_SYNC_OPS)[number]\n\n");
    out.push_str("/** Sync ops that `core-replay.ts` routes through `callMcpSyncOp`. */\n");
    out.push_str("export const MCP_SYNC_OPS_VIA_NATIVE_CALL = [\n");
    for id in &ids {
        if !TS_CUSTOM_REPLAY.contains(&id.as_str()) {
            let _ = writeln!(out, "  '{id}',");
        }
    }
    out.push_str("] as const\n");
    Ok(out)
}

fn dispatch_arm(id: &str) -> Option<&'static str> {
    Some(match id {
        "mcpAuthGate" => {
            r#"let input: AuthGateInput = parse_value(args)?;
            serde_json::to_value(mcp_auth_gate(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpConfigLog" => {
            r#"let input: ConfigLogInput = parse_value(args)?;
            Ok(mcp_config_log(&input))"#
        }
        "mcpDcrDiagnostics" => {
            r#"let input: DcrDiagnosticsInput = parse_value(args)?;
            Ok(mcp_dcr_diagnostics(&input))"#
        }
        "mcpDefaultGate" => {
            r#"let input: DefaultGateInput = parse_value(args)?;
            serde_json::to_value(mcp_default_gate(&input.product, input.reason.as_deref()))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpDescriptors" => {
            r#"let input: McpDescriptorsInput = parse_value(args)?;
            match mcp_descriptors(&input) {
                Ok(value) => serde_json::to_value(value)
                    .map_err(|err| SdkError::transport(format!("serialize: {err}"), false)),
                Err(message) => Err(SdkError::transport(message, false)),
            }"#
        }
        "mcpHandleRequest" => {
            r#"#[cfg(feature = "engine")]
            {
                let input: crate::engine::HandleRequestInput = parse_value(args)?;
                crate::engine::mcp_handle_request(&input)
                    .map_err(|message| SdkError::transport(message, false))
            }
            #[cfg(not(feature = "engine"))]
            {
                Err(SdkError::transport(
                    "mcpHandleRequest requires engine feature",
                    false,
                ))
            }"#
        }
        "mcpHideToolsByAudience" => {
            r#"let input: HideToolsInput = parse_value(args)?;
            Ok(mcp_hide_tools_by_audience(&input))"#
        }
        "mcpIsFreeMethod" => {
            r#"let method = args.get("mcpMethod").and_then(Value::as_str);
            Ok(Value::Bool(is_free_mcp_method(method)))"#
        }
        "mcpMergeCsp" => {
            r#"let overrides = args
                .get("overrides")
                .cloned()
                .map(serde_json::from_value::<SolvaPayMcpCsp>)
                .transpose()
                .map_err(|err| SdkError::transport(format!("invalid overrides: {err}"), false))?;
            let api_base_url = args.get("apiBaseUrl").and_then(Value::as_str);
            serde_json::to_value(mcp_merge_csp(overrides.as_ref(), api_base_url))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpNarrate" => {
            r#"let input: NarrateInput = parse_value(args)?;
            Ok(mcp_narrate(&input))"#
        }
        "mcpNativeCors" => {
            r#"let input: NativeCorsInput = parse_value(args)?;
            serde_json::to_value(mcp_native_cors(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpNormalizeOauthError" => {
            r#"let body = args.get("body").cloned().unwrap_or(Value::Null);
            let text = args.get("text").and_then(Value::as_str).unwrap_or("");
            let status = args.get("status").and_then(Value::as_i64).unwrap_or(400);
            Ok(mcp_normalize_oauth_error(&body, text, status))"#
        }
        "mcpOauthDiscovery" => {
            r#"let input: OauthDiscoveryInput = parse_value(args)?;
            Ok(mcp_oauth_discovery(&input))"#
        }
        "mcpOauthErrorInspect" => {
            r#"let input: OauthErrorInspectInput = parse_value(args)?;
            Ok(mcp_oauth_error_inspect(&input))"#
        }
        "mcpOauthPath" => {
            r#"let input: OauthPathInput = parse_value(args)?;
            Ok(mcp_oauth_path(&input))"#
        }
        "mcpOverviewResource" => {
            r#"serde_json::to_value(mcp_overview_resource())
            .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpRequiresBearerAuth" => {
            r#"let method = args.get("mcpMethod").and_then(Value::as_str);
            let mode = args
                .get("authMode")
                .cloned()
                .map(serde_json::from_value::<McpAuthMode>)
                .transpose()
                .map_err(|err| SdkError::transport(format!("invalid authMode: {err}"), false))?
                .unwrap_or(McpAuthMode::All);
            Ok(Value::Bool(requires_bearer_auth(method, mode)))"#
        }
        "mcpResume" => {
            r#"#[cfg(feature = "engine")]
            {
                let input: crate::engine::ResumeInput = parse_value(args)?;
                crate::engine::mcp_resume(&input)
                    .map_err(|message| SdkError::transport(message, false))
            }
            #[cfg(not(feature = "engine"))]
            {
                Err(SdkError::transport(
                    "mcpResume requires engine feature",
                    false,
                ))
            }"#
        }
        "mcpVerifyBearer" => {
            r#"let input: VerifyBearerInput = parse_value(args)?;
            serde_json::to_value(mcp_verify_bearer(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#
        }
        "mcpWidgetResource" => {
            r#"#[cfg(feature = "engine")]
            {
                let input: crate::widget_resource::McpWidgetResourceInput = parse_value(args)?;
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
            }"#
        }
        _ => return None,
    })
}

/// Extra dispatch arms that are not catalogued `syncOp`s (core helpers reached via `solvapay_call`).
const EXTRA_DISPATCH_ARMS: &[(&str, &str)] = &[
    (
        "validateBusinessDetails",
        r#"let input: BusinessDetailsInput = parse_value(args)?;
            serde_json::to_value(validate_business_details(&input))
                .map_err(|err| SdkError::transport(format!("serialize: {err}"), false))"#,
    ),
    (
        "resolveCustomerRef",
        r#"let pick = |key: &str| -> Option<String> {
                args.get(key)
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .filter(|s| !s.is_empty())
            };
            Ok(Value::String(solvapay_core::resolve_customer_ref(
                pick("hookRef").as_deref(),
                pick("verifiedJwtSub").as_deref(),
                pick("headerUserId").as_deref(),
                pick("headerCustomerRef").as_deref(),
                pick("mcpExtraCustomerRef").as_deref(),
                pick("argsAuthCustomerRef").as_deref(),
                pick("argsCustomerRef").as_deref(),
            )))"#,
    ),
];

/// `core/solvapay-mcp/src/sync_dispatch.generated.rs`
pub fn emit_sync_dispatch_rs(ir: &Ir) -> GenResult<String> {
    let ids = sync_op_ids(ir);
    for id in &ids {
        if dispatch_arm(id).is_none() {
            return Err(GenError::Parse(format!(
                "no generated dispatch arm for catalogued syncOp {id}"
            )));
        }
    }
    let mut out = generated_header(CommentStyle::LineSlash, "sync-dispatch-rs");
    out.push_str(
        "\nfn dispatch_op(op: &str, args: &Value) -> Result<Value, SdkError> {\n    match op {\n",
    );
    for id in &ids {
        let Some(arm) = dispatch_arm(id) else {
            return Err(GenError::Parse(format!(
                "no generated dispatch arm for catalogued syncOp {id}"
            )));
        };
        let _ = writeln!(out, "        \"{id}\" => {{\n            {arm}\n        }}");
    }
    for (id, arm) in EXTRA_DISPATCH_ARMS {
        let _ = writeln!(out, "        \"{id}\" => {{\n            {arm}\n        }}");
    }
    out.push_str(
        "        other => Err(SdkError::transport(format!(\"unknown op: {other}\"), false)),\n    }\n}\n",
    );
    Ok(out)
}

/// `contract/manifest/op-surfaces.generated.md`
pub fn emit_op_surfaces_md(ir: &Ir) -> String {
    let mut routed = Vec::new();
    let mut composites = Vec::new();
    let mut sync_ops = Vec::new();
    for entry in ir.entry_points.values() {
        match entry.section {
            IrEntrySection::Operation => {
                if entry.request.as_deref() == Some("McpJsonValue") {
                    composites.push(entry.id.as_str());
                } else {
                    routed.push(entry.id.as_str());
                }
            }
            IrEntrySection::Mcp if entry.mcp_surface == Some(IrMcpSurface::SyncOp) => {
                sync_ops.push(entry.id.as_str());
            }
            _ => {}
        }
    }
    routed.sort_unstable();
    composites.sort_unstable();
    sync_ops.sort_unstable();
    let mut out = generated_header(CommentStyle::Hash, "op-surfaces");
    out.push_str("\n# Op surfaces\n\n");
    let _ = writeln!(
        out,
        "| Surface | Count | Source |\n| --- | ---: | --- |\n| Routed `SolvaPayClient` methods | {} | `operations:` |\n| MCP composites | {} | routeless `operations:` |\n| MCP `syncOp` | {} | `mcp:` `surface: syncOp` |\n",
        routed.len(),
        composites.len(),
        sync_ops.len()
    );
    out.push_str("\n## Routed\n\n");
    for id in routed {
        let _ = writeln!(out, "- `{id}`");
    }
    out.push_str("\n## Composites\n\n");
    for id in composites {
        let _ = writeln!(out, "- `{id}`");
    }
    out.push_str("\n## Sync ops\n\n");
    for id in sync_ops {
        let _ = writeln!(out, "- `{id}`");
    }
    out
}

/// `sdks/typescript/core/src/barrel.generated.ts`
pub fn emit_ts_core_barrel(_ir: &Ir) -> String {
    let mut out = generated_header(CommentStyle::Block, "ts-core-barrel");
    out.push_str("\nexport * from './native-helpers'\n");
    out
}
