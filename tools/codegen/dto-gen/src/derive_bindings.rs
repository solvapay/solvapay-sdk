//! Derive `IrBindingSymbol` from scanned `#[solvapay_export]` signatures.

use std::collections::BTreeMap;

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrBindingArg, IrBindingArtifact, IrBindingCall, IrBindingCatalogLink, IrBindingSymbol,
    IrBoundaryType, IrCoreFieldTy, IrCoreFn, IrCoreParam, IrCoreParamTy, IrEnvelopeMode,
    IrExportAttr, IrExtractKind, IrLangNames, IrSerializeKind, IrSyncKind, IrTypedStyle,
};
use crate::lower_bindings::{
    default_extract, lower_arg, lower_artifact, lower_envelope, lower_sync, lower_ts_wrapper,
};
use crate::manifest::{BindingResidueDef, BindingResidueManifest};
use crate::name::{is_screaming_snake, rust_type_name, to_camel_case, to_snake_case};

/// Derive binding symbols for every scanned fn that carries `#[solvapay_export]`.
///
/// Residue keys that do not match a derived symbol are an error so the file
/// cannot rot.
///
/// # Errors
///
/// Unknown attribute values, missing required `artifact`, or orphan residue keys.
pub fn derive_export_bindings(
    fns: &BTreeMap<String, IrCoreFn>,
    residue: &BindingResidueManifest,
) -> GenResult<BTreeMap<String, IrBindingSymbol>> {
    derive_export_bindings_from(std::iter::once(fns), residue)
}

/// Derive from core and transport indexes, then enforce residue orphans.
///
/// # Errors
///
/// Duplicate ids across indexes, derive failures, or orphan residue keys.
pub fn derive_all_export_bindings(
    ir: &Ir,
    residue: &BindingResidueManifest,
) -> GenResult<BTreeMap<String, IrBindingSymbol>> {
    derive_export_bindings_from([&ir.core_fns, &ir.transport_fns], residue)
}

fn derive_export_bindings_from<'a>(
    sources: impl IntoIterator<Item = &'a BTreeMap<String, IrCoreFn>>,
    residue: &BindingResidueManifest,
) -> GenResult<BTreeMap<String, IrBindingSymbol>> {
    let mut out = BTreeMap::new();
    for fns in sources {
        for func in fns.values() {
            let Some(attr) = &func.exported else {
                continue;
            };
            let symbol = derive_one(func, attr, residue)?;
            if out.contains_key(&symbol.id) {
                return Err(GenError::Parse(format!(
                    "duplicate derived binding id {}",
                    symbol.id
                )));
            }
            out.insert(symbol.id.clone(), symbol);
        }
    }
    for key in residue.keys() {
        if !out.contains_key(key) {
            return Err(GenError::Parse(format!(
                "binding-residue.yaml: orphan key {key} has no #[solvapay_export] symbol"
            )));
        }
    }
    Ok(out)
}

/// Insert derived `#[solvapay_export]` symbols as the binding-symbol set.
///
/// # Errors
///
/// Derive failures.
pub fn install_derived_bindings(ir: &mut Ir, residue: &BindingResidueManifest) -> GenResult<()> {
    ir.binding_symbols = derive_all_export_bindings(ir, residue)?;
    Ok(())
}

fn derive_one(
    func: &IrCoreFn,
    attr: &IrExportAttr,
    residue: &BindingResidueManifest,
) -> GenResult<IrBindingSymbol> {
    let id = attr.id.clone().unwrap_or_else(|| to_camel_case(&func.name));
    let res = residue.get(&id).cloned().unwrap_or_default();
    let names = lang_names(&id);
    let transport = func.crate_prefix() == "solvapay_transport";
    let catalog_kind = attr
        .catalog
        .as_deref()
        .or(if transport { Some("operation") } else { None });
    let catalog = catalog_link(catalog_kind, &id)?;
    let args = match &res.args {
        Some(list) => {
            let mut args = Vec::with_capacity(list.len());
            for arg in list {
                args.push(lower_arg(&id, arg)?);
            }
            args
        }
        None if transport => Vec::new(),
        None => derive_args(func, attr, &id)?,
    };
    let sync = match attr.sync.as_deref() {
        Some(raw) => lower_sync(&id, raw)?,
        None if func.is_async || transport => IrSyncKind::Async,
        None => IrSyncKind::Sync,
    };
    let envelope = match attr.envelope.as_deref() {
        Some(raw) => lower_envelope(&id, raw)?,
        None => match sync {
            IrSyncKind::Async => IrEnvelopeMode::Async,
            IrSyncKind::Sync => IrEnvelopeMode::Sync,
        },
    };
    let artifact_raw = attr
        .artifact
        .as_deref()
        .or(if transport { Some("client") } else { None });
    let artifact = lower_artifact(&id, artifact_raw, envelope)?;
    let rust_fn_name = attr.rust_fn_name.clone().unwrap_or_else(|| match artifact {
        IrBindingArtifact::Webhook | IrBindingArtifact::Client => names.rust.clone(),
        IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders => {
            format!("{}_binding", func.name)
        }
    });
    let split_path_refs = if res.split_path_refs.is_empty() {
        attr.split_path_refs.clone()
    } else {
        res.split_path_refs.clone()
    };
    let dto_type = res.dto_type.clone().or_else(|| attr.dto_type.clone());
    let call = derive_call(func, &res, artifact, &split_path_refs)?;
    let core_call = match &call {
        IrBindingCall::Wrap { .. } if artifact == IrBindingArtifact::Webhook => None,
        _ if res.omit_core_call => None,
        _ => Some(func.name.clone()),
    };
    let doc = res
        .doc
        .clone()
        .unwrap_or_else(|| derive_doc(func, artifact, &id));
    Ok(IrBindingSymbol {
        id: id.clone(),
        core: binding_core_path(func),
        names,
        catalog,
        args,
        split_path_refs,
        return_shape: "value".into(),
        sync,
        envelope,
        artifact,
        emit_order: attr.emit_order.unwrap_or(0),
        section: attr.section.clone(),
        doc,
        doc_wasm: res.doc_wasm.clone(),
        rust_fn_name,
        call,
        verbatim_body: res.verbatim_body.clone(),
        verbatim_body_wasm: res.verbatim_body_wasm.clone(),
        dto_type,
        core_call,
        client_call_args: res.client_call_args.clone(),
        ts_wrapper: res.ts_wrapper.as_ref().map(lower_ts_wrapper),
    })
}

fn binding_core_path(func: &IrCoreFn) -> String {
    func.binding_core()
}

/// Six-language names from a canonical id.
#[must_use]
pub fn lang_names(id: &str) -> IrLangNames {
    if is_screaming_snake(id) {
        return IrLangNames {
            ts: id.to_owned(),
            py: id.to_owned(),
            rb: id.to_owned(),
            go: id.to_owned(),
            rust: id.to_owned(),
            c: id.to_owned(),
        };
    }
    let snake = to_snake_case(id);
    IrLangNames {
        ts: id.to_owned(),
        py: snake.clone(),
        rb: snake.clone(),
        go: rust_type_name(id),
        rust: snake,
        c: id.to_owned(),
    }
}

fn catalog_link(kind: Option<&str>, id: &str) -> GenResult<IrBindingCatalogLink> {
    match kind.unwrap_or("none") {
        "none" => Ok(IrBindingCatalogLink::None),
        "operation" => Ok(IrBindingCatalogLink::Operation(id.to_owned())),
        "topLevel" => Ok(IrBindingCatalogLink::TopLevel(id.to_owned())),
        "coreHelper" => Ok(IrBindingCatalogLink::CoreHelper(id.to_owned())),
        "facade" => Ok(IrBindingCatalogLink::Facade(id.to_owned())),
        other => Err(GenError::Parse(format!(
            "#[solvapay_export] {id}: unknown catalog {other:?}"
        ))),
    }
}

fn derive_args(func: &IrCoreFn, attr: &IrExportAttr, owner: &str) -> GenResult<Vec<IrBindingArg>> {
    let mut args = Vec::with_capacity(func.params.len());
    for param in &func.params {
        args.push(derive_arg(param, attr, owner)?);
    }
    Ok(args)
}

fn derive_arg(param: &IrCoreParam, attr: &IrExportAttr, owner: &str) -> GenResult<IrBindingArg> {
    let name = attr
        .rename
        .get(&param.rust_name)
        .cloned()
        .unwrap_or_else(|| to_camel_case(&param.rust_name));
    let host_injected = attr.host_injected.iter().any(|n| n == &name);
    let typed_as = attr
        .typed_as
        .get(&name)
        .cloned()
        .or_else(|| named_typed_as(&param.ty));
    let typed_style = match attr.typed_style.get(&name).map(String::as_str) {
        None | Some("turbofish") => IrTypedStyle::Turbofish,
        Some("annotation") => IrTypedStyle::Annotation,
        Some(other) => {
            return Err(GenError::Parse(format!(
                "bindings.{owner}.args.{name}: unknown typedStyle {other:?}"
            )));
        }
    };
    let (ty, required) = boundary_ty(&param.ty, typed_as.is_some());
    let extract = if let Some(raw) = attr.extract.get(&name) {
        crate::lower_bindings::lower_extract_kind(owner, &name, raw)?
    } else if typed_as.is_some() {
        if required {
            IrExtractKind::RequireTyped
        } else {
            IrExtractKind::OptionalTyped
        }
    } else {
        default_extract(ty, required)
    };
    let local = attr.local.get(&name).cloned().or_else(|| {
        if param.rust_name == name {
            None
        } else {
            Some(param.rust_name.clone())
        }
    });
    Ok(IrBindingArg {
        name,
        ty,
        required,
        host_injected,
        extract,
        typed_as,
        typed_style,
        local,
    })
}

fn named_typed_as(ty: &IrCoreParamTy) -> Option<String> {
    match &ty.ty {
        IrCoreFieldTy::Named(name) => Some(name.clone()),
        _ => None,
    }
}

fn boundary_ty(ty: &IrCoreParamTy, typed: bool) -> (IrBoundaryType, bool) {
    if typed {
        return (IrBoundaryType::Value, !ty.optional);
    }
    let required = !ty.optional;
    let boundary = match &ty.ty {
        IrCoreFieldTy::String => {
            if ty.optional {
                IrBoundaryType::StringOpt
            } else {
                IrBoundaryType::String
            }
        }
        IrCoreFieldTy::F64 => {
            if ty.optional {
                IrBoundaryType::F64Opt
            } else {
                IrBoundaryType::F64
            }
        }
        IrCoreFieldTy::I64 => IrBoundaryType::I64,
        IrCoreFieldTy::Bool => IrBoundaryType::Bool,
        _ => IrBoundaryType::Value,
    };
    (boundary, required)
}

fn derive_doc(func: &IrCoreFn, artifact: IrBindingArtifact, id: &str) -> String {
    match artifact {
        IrBindingArtifact::Webhook => String::new(),
        IrBindingArtifact::Client => {
            route_doc_from_rustdoc(&func.rustdoc).unwrap_or_else(|| format!("Binding for `{id}`."))
        }
        IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders => {
            format!("Binding for `{id}`.")
        }
    }
}

fn route_doc_from_rustdoc(rustdoc: &str) -> Option<String> {
    let first = rustdoc.lines().next()?.trim();
    let start = first.find('`')?;
    let rest = &first[start + 1..];
    let end = rest.find('`')?;
    let route = rest[..end].trim();
    if route.is_empty() {
        return None;
    }
    Some(format!("`{route}`"))
}

fn derive_call(
    func: &IrCoreFn,
    res: &BindingResidueDef,
    artifact: IrBindingArtifact,
    split_path_refs: &[String],
) -> GenResult<IrBindingCall> {
    if res.verbatim_body.is_some() {
        return Ok(IrBindingCall::Verbatim);
    }
    if artifact == IrBindingArtifact::Webhook {
        return Ok(IrBindingCall::Wrap {
            serialize: IrSerializeKind::ToValue,
            args: vec![],
        });
    }
    if artifact == IrBindingArtifact::Client {
        let serialize = if !split_path_refs.is_empty() {
            IrSerializeKind::ClientSplit
        } else if func.params.is_empty() {
            IrSerializeKind::ClientIgnore
        } else {
            IrSerializeKind::ClientAwait
        };
        return Ok(IrBindingCall::Wrap {
            serialize,
            args: vec![],
        });
    }
    let serialize = serialize_from_return(&func.return_ty);
    let call_args = res
        .call_args
        .clone()
        .unwrap_or_else(|| func.params.iter().map(call_arg_token).collect());
    Ok(IrBindingCall::Wrap {
        serialize,
        args: call_args,
    })
}

fn serialize_from_return(ret: &IrCoreParamTy) -> IrSerializeKind {
    if ret.optional {
        if matches!(&ret.ty, IrCoreFieldTy::Named(n) if n == "HelperErrorResult") {
            return IrSerializeKind::OptionHelperErr;
        }
        return IrSerializeKind::ToValue;
    }
    match &ret.ty {
        IrCoreFieldTy::Bool => IrSerializeKind::ValueBool,
        IrCoreFieldTy::String => IrSerializeKind::ValueString,
        IrCoreFieldTy::Result { .. } => IrSerializeKind::ResultAsValue,
        _ => IrSerializeKind::ToValue,
    }
}

fn call_arg_token(param: &IrCoreParam) -> String {
    let local = &param.rust_name;
    if param.ty.optional {
        return match &param.ty.ty {
            IrCoreFieldTy::String => format!("{local}.as_deref()"),
            IrCoreFieldTy::F64
            | IrCoreFieldTy::I64
            | IrCoreFieldTy::U16
            | IrCoreFieldTy::U32
            | IrCoreFieldTy::U64
            | IrCoreFieldTy::Bool => local.to_owned(),
            _ => format!("{local}.as_ref()"),
        };
    }
    if param.by_ref {
        return match &param.ty.ty {
            IrCoreFieldTy::Value | IrCoreFieldTy::Vec(_) | IrCoreFieldTy::Map(_) => {
                local.to_owned()
            }
            _ => format!("&{local}"),
        };
    }
    local.to_owned()
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use crate::ir::{
        IrBindingArtifact, IrBindingCall, IrBindingCatalogLink, IrCoreParam, IrEnvelopeMode,
        IrSerializeKind, IrSyncKind,
    };

    fn sample_fn() -> IrCoreFn {
        IrCoreFn {
            name: "classify_customer_ref".into(),
            module: "customer_sync".into(),
            impl_ty: None,
            crate_name: String::new(),
            rustdoc: String::new(),
            params: vec![IrCoreParam {
                rust_name: "customer_ref".into(),
                by_ref: true,
                ty: IrCoreParamTy {
                    optional: false,
                    ty: IrCoreFieldTy::String,
                },
            }],
            return_ty: IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Named("CustomerRefKind".into()),
            },
            exported: Some(IrExportAttr {
                artifact: Some("decisions".into()),
                catalog: Some("none".into()),
                section: Some("customer-sync".into()),
                emit_order: Some(0),
                ..IrExportAttr::default()
            }),
            is_async: false,
        }
    }

    #[test]
    fn names_camel_and_screaming() {
        let camel = lang_names("classifyCustomerRef");
        assert_eq!(camel.ts, "classifyCustomerRef");
        assert_eq!(camel.py, "classify_customer_ref");
        assert_eq!(camel.rb, "classify_customer_ref");
        assert_eq!(camel.go, "ClassifyCustomerRef");
        assert_eq!(camel.rust, "classify_customer_ref");
        assert_eq!(camel.c, "classifyCustomerRef");
        let scream = lang_names("MCP_TOOL_NAMES");
        assert_eq!(scream.ts, "MCP_TOOL_NAMES");
        assert_eq!(scream.go, "MCP_TOOL_NAMES");
    }

    #[test]
    fn args_name_local_extract() {
        let func = sample_fn();
        let attr = func.exported.as_ref().unwrap();
        let args = derive_args(&func, attr, "classifyCustomerRef").unwrap();
        assert_eq!(args.len(), 1);
        assert_eq!(args[0].name, "customerRef");
        assert_eq!(args[0].local.as_deref(), Some("customer_ref"));
        assert_eq!(args[0].ty, IrBoundaryType::String);
        assert!(args[0].required);
        assert_eq!(args[0].extract, IrExtractKind::RequireString);
    }

    #[test]
    fn serialize_from_named_struct_is_to_value() {
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Named("CustomerRefKind".into()),
            }),
            IrSerializeKind::ToValue
        );
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Bool,
            }),
            IrSerializeKind::ValueBool
        );
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::String,
            }),
            IrSerializeKind::ValueString
        );
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: true,
                ty: IrCoreFieldTy::String,
            }),
            IrSerializeKind::ToValue
        );
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: true,
                ty: IrCoreFieldTy::Named("HelperErrorResult".into()),
            }),
            IrSerializeKind::OptionHelperErr
        );
        assert_eq!(
            serialize_from_return(&IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Result {
                    ok: Box::new(IrCoreFieldTy::Named("CheckLimitsParams".into())),
                    err: Box::new(IrCoreFieldTy::Named("HelperErrorResult".into())),
                },
            }),
            IrSerializeKind::ResultAsValue
        );
    }

    #[test]
    fn call_args_ref_and_as_deref() {
        let owned = IrCoreParam {
            rust_name: "now_ms".into(),
            by_ref: false,
            ty: IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::I64,
            },
        };
        assert_eq!(call_arg_token(&owned), "now_ms");
        let borrowed = IrCoreParam {
            rust_name: "customer_ref".into(),
            by_ref: true,
            ty: IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::String,
            },
        };
        assert_eq!(call_arg_token(&borrowed), "&customer_ref");
        let opt = IrCoreParam {
            rust_name: "email".into(),
            by_ref: true,
            ty: IrCoreParamTy {
                optional: true,
                ty: IrCoreFieldTy::String,
            },
        };
        assert_eq!(call_arg_token(&opt), "email.as_deref()");
    }

    #[test]
    fn rust_fn_name_and_core_call_and_mechanical_doc() {
        let func = sample_fn();
        let mut fns = BTreeMap::new();
        fns.insert(func.core_path(), func);
        let derived = derive_export_bindings(&fns, &BTreeMap::new()).unwrap();
        let symbol = derived.get("classifyCustomerRef").unwrap();
        assert_eq!(symbol.rust_fn_name, "classify_customer_ref_binding");
        assert_eq!(symbol.core_call.as_deref(), Some("classify_customer_ref"));
        assert_eq!(symbol.doc, "Binding for `classifyCustomerRef`.");
        assert_eq!(symbol.return_shape, "value");
        assert!(symbol.split_path_refs.is_empty());
    }

    #[test]
    fn orphan_residue_key_errors() {
        let mut residue = BTreeMap::new();
        residue.insert("missingSymbol".into(), BindingResidueDef::default());
        let err = derive_export_bindings(&BTreeMap::new(), &residue).unwrap_err();
        assert!(
            err.to_string().contains("orphan key missingSymbol"),
            "{err}"
        );
    }

    #[test]
    fn install_replaces_preexisting_symbols() {
        let func = sample_fn();
        let mut ir = crate::ir::Ir {
            core_fns: BTreeMap::new(),
            ..crate::ir::Ir::default()
        };
        ir.core_fns.insert(func.core_path(), func);
        ir.binding_symbols.insert(
            "classifyCustomerRef".into(),
            crate::ir::IrBindingSymbol {
                id: "classifyCustomerRef".into(),
                core: "solvapay_core::customer_sync::classify_customer_ref".into(),
                names: crate::ir::IrLangNames {
                    ts: "classifyCustomerRef".into(),
                    py: "classify_customer_ref".into(),
                    rb: "classify_customer_ref".into(),
                    go: "ClassifyCustomerRef".into(),
                    rust: "classify_customer_ref".into(),
                    c: "classifyCustomerRef".into(),
                },
                catalog: IrBindingCatalogLink::None,
                args: vec![],
                split_path_refs: vec![],
                return_shape: "value".into(),
                sync: IrSyncKind::Sync,
                envelope: IrEnvelopeMode::Sync,
                artifact: IrBindingArtifact::Decisions,
                emit_order: 0,
                section: None,
                doc: "stale yaml".into(),
                doc_wasm: None,
                rust_fn_name: "classify_customer_ref_binding".into(),
                call: IrBindingCall::Verbatim,
                verbatim_body: None,
                verbatim_body_wasm: None,
                dto_type: None,
                core_call: None,
                client_call_args: vec![],
                ts_wrapper: None,
            },
        );
        install_derived_bindings(&mut ir, &BTreeMap::new()).unwrap();
        assert_eq!(
            ir.binding_symbols.get("classifyCustomerRef").unwrap().doc,
            "Binding for `classifyCustomerRef`."
        );
    }

    fn client_fn() -> IrCoreFn {
        IrCoreFn {
            name: "activate_plan".into(),
            module: "client".into(),
            impl_ty: Some("SolvaPayClient".into()),
            crate_name: "solvapay_transport".into(),
            rustdoc: "`POST /v1/sdk/activate` — activate a plan for a customer.".into(),
            params: vec![IrCoreParam {
                rust_name: "params".into(),
                by_ref: false,
                ty: IrCoreParamTy {
                    optional: false,
                    ty: IrCoreFieldTy::Named("ActivatePlanDto".into()),
                },
            }],
            return_ty: IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Result {
                    ok: Box::new(IrCoreFieldTy::Value),
                    err: Box::new(IrCoreFieldTy::Named("HelperErrorResult".into())),
                },
            },
            exported: Some(IrExportAttr {
                catalog: Some("operation".into()),
                section: Some("Group B".into()),
                emit_order: Some(14),
                dto_type: Some("ActivatePlanDto".into()),
                ..IrExportAttr::default()
            }),
            is_async: true,
        }
    }

    #[test]
    fn client_defaults_and_route_doc() {
        let func = client_fn();
        let mut fns = BTreeMap::new();
        fns.insert(func.core_path(), func);
        let derived = derive_export_bindings(&fns, &BTreeMap::new()).unwrap();
        let symbol = derived.get("activatePlan").unwrap();
        assert_eq!(
            symbol.core,
            "solvapay_transport::SolvaPayClient::activate_plan"
        );
        assert_eq!(symbol.artifact, IrBindingArtifact::Client);
        assert_eq!(symbol.sync, IrSyncKind::Async);
        assert_eq!(symbol.envelope, IrEnvelopeMode::Async);
        assert_eq!(
            symbol.catalog,
            IrBindingCatalogLink::Operation("activatePlan".into())
        );
        assert!(symbol.args.is_empty());
        assert_eq!(symbol.doc, "`POST /v1/sdk/activate`");
        assert_eq!(symbol.dto_type.as_deref(), Some("ActivatePlanDto"));
        assert_eq!(symbol.rust_fn_name, "activate_plan");
        assert_eq!(
            symbol.call,
            IrBindingCall::Wrap {
                serialize: IrSerializeKind::ClientAwait,
                args: vec![],
            }
        );
        assert!(!symbol.core.starts_with("solvapay_core::"));
    }

    #[test]
    fn client_empty_params_are_client_ignore() {
        let mut func = client_fn();
        func.name = "get_merchant".into();
        func.params.clear();
        func.exported.as_mut().unwrap().dto_type = None;
        func.exported.as_mut().unwrap().emit_order = Some(8);
        func.rustdoc = "`GET /v1/sdk/merchant` — merchant profile.".into();
        let mut fns = BTreeMap::new();
        fns.insert(func.core_path(), func);
        let derived = derive_export_bindings(&fns, &BTreeMap::new()).unwrap();
        let symbol = derived.get("getMerchant").unwrap();
        assert_eq!(
            symbol.call,
            IrBindingCall::Wrap {
                serialize: IrSerializeKind::ClientIgnore,
                args: vec![],
            }
        );
    }
}
