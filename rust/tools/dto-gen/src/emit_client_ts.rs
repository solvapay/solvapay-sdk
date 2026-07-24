//! Emit `SolvaPayClientGenerated` TypeScript declarations from catalog IR.

use std::fmt::Write as _;

use crate::doc_render::render_entry_doc_lines;
use crate::emit_ts::{ts_alias_target, ts_named, ts_type_ref, write_ts_doc};
use crate::error::GenResult;
use crate::ir::{Ir, IrEntryPoint, IrEntrySection, IrParam, IrTypeRef};

const CLIENT_HEADER: &str = "\
/**\n\
 * @generated — do not edit. Regenerate with: pnpm gen\n\
 */\n\n";

/// Hand-written type names from `client.ts` preferred over overlays for API-diff
/// mutual assignability (frozen contract until Phase 6 cutover).
const HAND_TYPE_ALIASES: &[&str] = &[
    "AttachBusinessDetailsParams",
    "AttachBusinessDetailsResult",
    "CheckLimitsRequest",
    "LimitResponseWithPlan",
    "CustomerResponseMapped",
    "ProcessPaymentResult",
    "TopupProcessResult",
    "ActivatePlanResult",
    "PaymentMethodInfo",
    "AutoRechargeInput",
    "SaveAutoRechargeInput",
    "AutoRechargeResponse",
    "SaveAutoRechargeResponse",
    "CreditDisplayBlock",
    "GetCustomerBalanceResult",
    "SdkMerchantResponse",
    "SdkPlatformConfigResponse",
    "SdkProductResponse",
    "TrackUsageRequest",
    "TrackUsageResponse",
    "TrackUsageBulkRequest",
    "TrackUsageBulkResponse",
    "AssignCreditsRequest",
    "AssignCreditsResponse",
    "McpBootstrapRequest",
    "McpBootstrapResponse",
    "ConfigureMcpPlansRequest",
    "ConfigureMcpPlansResponse",
    "OneTimePurchaseInfo",
];

/// Map catalog response DTO names → hand-written aliases when they differ.
fn hand_alias(name: &str) -> &str {
    match name {
        "ActivatePlanResponseDto" => "ActivatePlanResult",
        "GrantCustomerCreditsResponse" => "AssignCreditsResponse",
        "UsageRecordResponse" => "TrackUsageResponse",
        "BulkUsageResponse" => "TrackUsageBulkResponse",
        "McpBootstrapDto" => "McpBootstrapRequest",
        "ConfigureMcpPlansDto" => "ConfigureMcpPlansRequest",
        "SdkMerchantResponseDto" => "SdkMerchantResponse",
        "SdkPlatformConfigResponseDto" => "SdkPlatformConfigResponse",
        other => other,
    }
}

fn is_hand_type(name: &str) -> bool {
    let aliased = hand_alias(name);
    HAND_TYPE_ALIASES.contains(&aliased) || HAND_TYPE_ALIASES.contains(&name)
}

/// Emits `client.generated.d.ts` contents.
///
/// # Errors
///
/// Returns formatting errors as [`GenError`] (none expected for string writes).
pub fn emit_client_ts(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(CLIENT_HEADER);
    out.push_str("import type { components, operations } from './generated'\n");
    out.push_str("import type * as overlays from './overlays.generated'\n");
    out.push_str("import type {\n");
    for name in HAND_TYPE_ALIASES {
        let _ = writeln!(out, "  {name},");
    }
    out.push_str("} from './client'\n\n");

    out.push_str("export interface SolvaPayClientGenerated {\n");
    for ep in ir.entry_points.values() {
        if ep.section != IrEntrySection::Operation {
            continue;
        }
        emit_client_method(&mut out, ir, ep);
    }
    out.push_str("}\n\n");

    if let Some(with_retry) = ir.entry_points.get("withRetry") {
        emit_with_retry(&mut out, ir, with_retry);
    }

    Ok(out)
}

fn emit_client_method(out: &mut String, ir: &Ir, ep: &IrEntryPoint) {
    write_ts_doc(out, &render_tsdoc(ep));
    let optional = if ep.optional_on_client { "?" } else { "" };
    let params = emit_params(ir, &ep.params);
    let ret = match &ep.response {
        Some(name) => format!("Promise<{}>", ts_response_type(ir, name)),
        None => "Promise<void>".into(),
    };
    let _ = writeln!(out, "  {}{optional}({params}): {ret}", ep.names.ts);
}

fn emit_with_retry(out: &mut String, ir: &Ir, ep: &IrEntryPoint) {
    write_ts_doc(out, &render_tsdoc(ep));
    let type_params = if ep.type_params.is_empty() {
        String::new()
    } else {
        format!("<{}>", ep.type_params.join(", "))
    };
    let params = emit_params(ir, &ep.params);
    // Hand-written withRetry returns Promise<T> regardless of catalog sync matrix.
    let ret = "Promise<T>";
    let _ = writeln!(
        out,
        "export declare function withRetryGenerated{type_params}({params}): {ret}\n"
    );
}

/// Builds a TSDoc body (no `/** */` wrappers) from the shared IR doc model.
fn render_tsdoc(ep: &IrEntryPoint) -> String {
    render_entry_doc_lines(ep, |p| p.names.ts.as_str()).join("\n")
}

fn emit_params(ir: &Ir, params: &[IrParam]) -> String {
    params
        .iter()
        .map(|p| {
            let opt = if p.required { "" } else { "?" };
            let ty = match &p.ty {
                IrTypeRef::Named(name) if name == "T" => "T".into(),
                other => ts_param_type(ir, other),
            };
            // withRetry fn stand-in: prefer () => Promise<T> when doc mentions callable
            let ty = if p.name == "fn" && p.doc.contains("Promise") {
                "() => Promise<T>".into()
            } else {
                ty
            };
            format!("{}{opt}: {ty}", p.name)
        })
        .collect::<Vec<_>>()
        .join(", ")
}

fn ts_param_type(ir: &Ir, ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::Named(name) => {
            let aliased = hand_alias(name);
            if is_hand_type(name) {
                aliased.to_string()
            } else if ir.overlays.contains_key(name) || ir.overlay_helpers.contains_key(name) {
                format!("overlays.{name}")
            } else {
                format!("components['schemas']['{name}']")
            }
        }
        other => ts_type_ref(ir, other),
    }
}

fn ts_response_type(ir: &Ir, name: &str) -> String {
    let aliased = hand_alias(name);
    if name == "void" {
        return "void".into();
    }
    if is_hand_type(name) || is_hand_type(aliased) {
        return aliased.to_string();
    }
    match name {
        "PaymentMethodResult" => "PaymentMethodInfo".into(),
        other if ir.overlays.contains_key(other) || ir.overlay_helpers.contains_key(other) => {
            format!("overlays.{other}")
        }
        other => {
            let alias = ts_alias_target(other);
            if alias.starts_with("operations[") || alias.starts_with("components[") {
                alias
            } else {
                ts_named(ir, other)
            }
        }
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrAvailability, IrDefaults, IrErrorKind, IrLangNames, IrParam, IrRubyReceiver,
        IrRubyTarget, IrSyncKind, IrTypeRef,
    };
    use crate::lower_catalog::lower_catalog;
    use crate::manifest::Manifest;
    use std::collections::BTreeMap;

    fn empty_ir() -> Ir {
        Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
        }
    }

    #[test]
    fn emits_check_limits_signature() {
        let mut ir = empty_ir();
        ir.overlays.insert(
            "CheckLimitsRequest".into(),
            crate::ir::IrOverlay::Marker {
                name: "CheckLimitsRequest".into(),
                doc: String::new(),
            },
        );
        ir.overlays.insert(
            "LimitResponseWithPlan".into(),
            crate::ir::IrOverlay::Marker {
                name: "LimitResponseWithPlan".into(),
                doc: String::new(),
            },
        );
        ir.entry_points.insert(
            "checkLimits".into(),
            IrEntryPoint {
                id: "checkLimits".into(),
                section: IrEntrySection::Operation,
                names: IrLangNames {
                    ts: "checkLimits".into(),
                    py: "check_limits".into(),
                    rb: "check_limits".into(),
                    go: "CheckLimits".into(),
                    rust: "check_limits".into(),
                },
                optional_on_client: false,
                params: vec![IrParam {
                    name: "params".into(),
                    names: IrLangNames {
                        ts: "params".into(),
                        py: "params".into(),
                        rb: "params".into(),
                        go: "params".into(),
                        rust: "params".into(),
                    },
                    required: true,
                    ty: IrTypeRef::Named("CheckLimitsRequest".into()),
                    default_value: None,
                    doc: String::new(),
                }],
                type_params: vec![],
                request: Some("CheckLimitsRequest".into()),
                response: Some("LimitResponseWithPlan".into()),
                availability: IrAvailability {
                    ts: vec![IrSyncKind::Async],
                    py: vec![IrSyncKind::Async, IrSyncKind::Sync],
                    rb: vec![IrSyncKind::Sync],
                    go: vec![IrSyncKind::Sync],
                    rust: vec![IrSyncKind::Async, IrSyncKind::Sync],
                },
                sync_ts: IrSyncKind::Async,
                ruby_target: IrRubyTarget {
                    owner: "SolvaPay::Client".into(),
                    name: "check_limits".into(),
                    receiver: IrRubyReceiver::ClientInstance,
                    takes_block: false,
                },
                defaults: IrDefaults::default(),
                errors: vec![IrErrorKind::Api],
                docs: crate::ir::IrDocModel::default(),
            },
        );
        let out = emit_client_ts(&ir).unwrap();
        assert!(
            out.contains("checkLimits(params: CheckLimitsRequest): Promise<LimitResponseWithPlan>")
        );
    }

    #[test]
    fn emits_optional_and_positional() {
        let mut ir = empty_ir();
        ir.entry_points.insert(
            "updateCustomer".into(),
            IrEntryPoint {
                id: "updateCustomer".into(),
                section: IrEntrySection::Operation,
                names: IrLangNames {
                    ts: "updateCustomer".into(),
                    py: "update_customer".into(),
                    rb: "update_customer".into(),
                    go: "UpdateCustomer".into(),
                    rust: "update_customer".into(),
                },
                optional_on_client: true,
                params: vec![
                    IrParam {
                        name: "customerRef".into(),
                        names: IrLangNames {
                            ts: "customerRef".into(),
                            py: "customer_ref".into(),
                            rb: "customer_ref".into(),
                            go: "customerRef".into(),
                            rust: "customer_ref".into(),
                        },
                        required: true,
                        ty: IrTypeRef::String,
                        default_value: None,
                        doc: String::new(),
                    },
                    IrParam {
                        name: "params".into(),
                        names: IrLangNames {
                            ts: "params".into(),
                            py: "params".into(),
                            rb: "params".into(),
                            go: "params".into(),
                            rust: "params".into(),
                        },
                        required: true,
                        ty: IrTypeRef::Named("UpdateCustomerParams".into()),
                        default_value: None,
                        doc: String::new(),
                    },
                ],
                type_params: vec![],
                request: None,
                response: Some("UpdateCustomerResult".into()),
                availability: IrAvailability {
                    ts: vec![IrSyncKind::Async],
                    py: vec![IrSyncKind::Async, IrSyncKind::Sync],
                    rb: vec![IrSyncKind::Sync],
                    go: vec![IrSyncKind::Sync],
                    rust: vec![IrSyncKind::Async, IrSyncKind::Sync],
                },
                sync_ts: IrSyncKind::Async,
                ruby_target: IrRubyTarget {
                    owner: "SolvaPay::Client".into(),
                    name: "update_customer".into(),
                    receiver: IrRubyReceiver::ClientInstance,
                    takes_block: false,
                },
                defaults: IrDefaults::default(),
                errors: vec![IrErrorKind::Api],
                docs: crate::ir::IrDocModel::default(),
            },
        );
        ir.overlays.insert(
            "UpdateCustomerParams".into(),
            crate::ir::IrOverlay::Marker {
                name: "UpdateCustomerParams".into(),
                doc: String::new(),
            },
        );
        ir.overlays.insert(
            "UpdateCustomerResult".into(),
            crate::ir::IrOverlay::Marker {
                name: "UpdateCustomerResult".into(),
                doc: String::new(),
            },
        );
        let out = emit_client_ts(&ir).unwrap();
        assert!(out.contains(
            "updateCustomer?(customerRef: string, params: overlays.UpdateCustomerParams)"
        ));
    }

    #[test]
    fn emits_with_retry_generic() {
        let yaml = r#"
topLevel:
  withRetry:
    names:
      ts: withRetry
      py: with_retry
      rb: with_retry
      go: WithRetry
      rust: with_retry
    sync:
      ts: sync
      py: sync
      rb: sync
      go: sync
      rust: sync
    typeParams:
      - name: T
    params:
      - name: fn
        type: unknown
        required: true
        doc: "() => Promise<T> — callable stand-in"
      - name: options
        ref: RetryOptions
        required: false
    docs:
      summary: "Retry an async callable with the frozen default backoff policy."
      params:
        fn: "() => Promise<T> — callable stand-in"
        options: "Optional retry overrides."
      returns: "The callable's resolved value."
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        let out = emit_client_ts(&ir).unwrap();
        assert!(out.contains("export declare function withRetryGenerated<T>("));
        assert!(out.contains("fn: () => Promise<T>"));
        assert!(out.contains("options?:"));
        assert!(out.contains("Retry an async callable with the frozen default backoff policy."));
        assert!(out.contains("@param fn () => Promise<T> — callable stand-in"));
        assert!(out.contains("@param options Optional retry overrides."));
        assert!(out.contains("@returns The callable's resolved value."));
        assert!(!out.contains("Generated withRetry signature for parity"));
    }

    #[test]
    fn emits_tsdoc_from_ir_doc_model() {
        let mut ir = empty_ir();
        ir.overlays.insert(
            "CheckLimitsRequest".into(),
            crate::ir::IrOverlay::Marker {
                name: "CheckLimitsRequest".into(),
                doc: String::new(),
            },
        );
        ir.overlays.insert(
            "LimitResponseWithPlan".into(),
            crate::ir::IrOverlay::Marker {
                name: "LimitResponseWithPlan".into(),
                doc: String::new(),
            },
        );
        ir.entry_points.insert(
            "checkLimits".into(),
            IrEntryPoint {
                id: "checkLimits".into(),
                section: IrEntrySection::Operation,
                names: IrLangNames {
                    ts: "checkLimits".into(),
                    py: "check_limits".into(),
                    rb: "check_limits".into(),
                    go: "CheckLimits".into(),
                    rust: "check_limits".into(),
                },
                optional_on_client: false,
                params: vec![IrParam {
                    name: "params".into(),
                    names: IrLangNames {
                        ts: "params".into(),
                        py: "params".into(),
                        rb: "params".into(),
                        go: "params".into(),
                        rust: "params".into(),
                    },
                    required: true,
                    ty: IrTypeRef::Named("CheckLimitsRequest".into()),
                    default_value: None,
                    doc: "Limits request including customer and product refs.".into(),
                }],
                type_params: vec![],
                request: Some("CheckLimitsRequest".into()),
                response: Some("LimitResponseWithPlan".into()),
                availability: IrAvailability {
                    ts: vec![IrSyncKind::Async],
                    py: vec![IrSyncKind::Async, IrSyncKind::Sync],
                    rb: vec![IrSyncKind::Sync],
                    go: vec![IrSyncKind::Sync],
                    rust: vec![IrSyncKind::Async, IrSyncKind::Sync],
                },
                sync_ts: IrSyncKind::Async,
                ruby_target: IrRubyTarget {
                    owner: "SolvaPay::Client".into(),
                    name: "check_limits".into(),
                    receiver: IrRubyReceiver::ClientInstance,
                    takes_block: false,
                },
                defaults: IrDefaults::default(),
                errors: vec![IrErrorKind::Api],
                docs: crate::ir::IrDocModel {
                    summary: "Check remaining usage/spend limits for a customer against a product's plan.".into(),
                    returns: Some(
                        "Current remaining limits, optionally including plan details.".into(),
                    ),
                },
            },
        );
        let out = emit_client_ts(&ir).unwrap();
        assert!(out.contains(
            "Check remaining usage/spend limits for a customer against a product's plan."
        ));
        assert!(out.contains("@param params Limits request including customer and product refs."));
        assert!(
            out.contains("@returns Current remaining limits, optionally including plan details.")
        );
        assert!(!out.contains("checkLimits client method."));
    }
}
