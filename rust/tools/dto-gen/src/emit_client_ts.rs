//! Emit `SolvaPayClientGenerated` TypeScript declarations from catalog IR.

use std::fmt::Write as _;

use crate::emit_ts::{ts_alias_target, ts_named, ts_type_ref, write_ts_doc};
use crate::error::GenResult;
use crate::ir::{Ir, IrEntryPoint, IrEntrySection, IrParam, IrTypeRef};

const CLIENT_HEADER: &str = "\
/**\n\
 * @generated — do not edit. Regenerate with:\n\
 *   cargo run -p dto-gen -- \\\n\
 *     --snapshot ../contract/openapi/sdk-v1.snapshot.json \\\n\
 *     --manifest ../contract/manifest/sdk-contract.yaml \\\n\
 *     --out crates/solvapay-dto/src \\\n\
 *     --ts-out packages/server/src/types/overlays.generated.d.ts \\\n\
 *     --ts-client-out packages/server/src/types/client.generated.d.ts\n\
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
    write_ts_doc(out, &format!("{} client method.", ep.id));
    let optional = if ep.optional_on_client { "?" } else { "" };
    let params = emit_params(ir, &ep.params);
    let ret = match &ep.response {
        Some(name) => format!("Promise<{}>", ts_response_type(ir, name)),
        None => "Promise<void>".into(),
    };
    let _ = writeln!(out, "  {}{optional}({params}): {ret}", ep.names.ts);
}

fn emit_with_retry(out: &mut String, ir: &Ir, ep: &IrEntryPoint) {
    write_ts_doc(out, "Generated withRetry signature for parity (§2.8).");
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
    use crate::ir::{IrLangNames, IrParam, IrSyncKind, IrTypeRef};
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
                    required: true,
                    ty: IrTypeRef::Named("CheckLimitsRequest".into()),
                    default_value: None,
                    doc: String::new(),
                }],
                type_params: vec![],
                request: Some("CheckLimitsRequest".into()),
                response: Some("LimitResponseWithPlan".into()),
                sync_ts: IrSyncKind::Async,
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
                        required: true,
                        ty: IrTypeRef::String,
                        default_value: None,
                        doc: String::new(),
                    },
                    IrParam {
                        name: "params".into(),
                        required: true,
                        ty: IrTypeRef::Named("UpdateCustomerParams".into()),
                        default_value: None,
                        doc: String::new(),
                    },
                ],
                type_params: vec![],
                request: None,
                response: Some("UpdateCustomerResult".into()),
                sync_ts: IrSyncKind::Async,
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
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        let out = emit_client_ts(&ir).unwrap();
        assert!(out.contains("export declare function withRetryGenerated<T>("));
        assert!(out.contains("fn: () => Promise<T>"));
        assert!(out.contains("options?:"));
    }
}
