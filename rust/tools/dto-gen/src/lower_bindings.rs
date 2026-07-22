//! Lower `bindings:` descriptors into `Ir.binding_symbols` (§5.7 / step 39G-a).

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrBindingArg, IrBindingArtifact, IrBindingCall, IrBindingCatalogLink, IrBindingSymbol,
    IrBoundaryType, IrEnvelopeMode, IrExtractKind, IrLangNames, IrSerializeKind, IrSyncKind,
    IrTypedStyle,
};
use crate::manifest::{
    BindingArgDef, BindingCallDef, BindingCatalogLink, BindingDef, LangNames, Manifest,
};

/// Populates `ir.binding_symbols` from the contract manifest `bindings:` section.
///
/// # Errors
///
/// Returns parse errors when a boundary type, sync kind, or envelope mode is unknown.
pub fn lower_bindings(ir: &mut Ir, manifest: &Manifest) -> GenResult<()> {
    for (id, def) in &manifest.bindings {
        let symbol = lower_binding(id, def)?;
        ir.binding_symbols.insert(id.clone(), symbol);
    }
    Ok(())
}

fn lower_binding(id: &str, def: &BindingDef) -> GenResult<IrBindingSymbol> {
    let mut args = Vec::with_capacity(def.args.len());
    for arg in &def.args {
        args.push(lower_arg(id, arg)?);
    }
    let envelope = lower_envelope(id, &def.envelope)?;
    let artifact = lower_artifact(id, def.artifact.as_deref(), envelope)?;
    let call = lower_call(id, def.call.as_ref())?;
    Ok(IrBindingSymbol {
        id: id.to_string(),
        core: def.core.clone(),
        names: to_ir_names(def.names.clone()),
        catalog: lower_catalog_link(&def.catalog),
        args,
        split_path_refs: def.split_path_refs.clone(),
        return_shape: def.return_shape.clone(),
        sync: lower_sync(id, &def.sync)?,
        envelope,
        artifact,
        emit_order: def.emit_order.unwrap_or(0),
        section: def.section.clone(),
        doc: def.doc.clone().unwrap_or_default(),
        doc_wasm: def.doc_wasm.clone(),
        rust_fn_name: def
            .rust_fn_name
            .clone()
            .unwrap_or_else(|| def.names.rust.clone()),
        call,
        verbatim_body: def.verbatim_body.clone(),
        verbatim_body_wasm: def.verbatim_body_wasm.clone(),
        dto_type: def.dto_type.clone(),
        core_call: def.core_call.clone(),
        client_call_args: def.client_call_args.clone(),
    })
}

fn lower_arg(owner: &str, arg: &BindingArgDef) -> GenResult<IrBindingArg> {
    let ty = lower_boundary_type(owner, &arg.name, &arg.ty)?;
    let extract = match &arg.extract {
        Some(raw) => lower_extract_kind(owner, &arg.name, raw)?,
        None => default_extract(ty, arg.required),
    };
    let typed_style = match arg.typed_style.as_deref() {
        None | Some("turbofish") => IrTypedStyle::Turbofish,
        Some("annotation") => IrTypedStyle::Annotation,
        Some(other) => {
            return Err(GenError::Parse(format!(
                "bindings.{owner}.args.{}: unknown typedStyle {other:?}",
                arg.name
            )))
        }
    };
    Ok(IrBindingArg {
        name: arg.name.clone(),
        ty,
        required: arg.required,
        host_injected: arg.host_injected,
        extract,
        typed_as: arg.typed_as.clone(),
        typed_style,
        local: arg.local.clone(),
    })
}

fn lower_artifact(
    owner: &str,
    raw: Option<&str>,
    envelope: IrEnvelopeMode,
) -> GenResult<IrBindingArtifact> {
    match raw {
        Some("decisions") => Ok(IrBindingArtifact::Decisions),
        Some("payloadBuilders") => Ok(IrBindingArtifact::PayloadBuilders),
        Some("client") => Ok(IrBindingArtifact::Client),
        Some("webhook") => Ok(IrBindingArtifact::Webhook),
        Some(other) => Err(GenError::Parse(format!(
            "bindings.{owner}: unknown artifact {other:?}"
        ))),
        None => Ok(match envelope {
            IrEnvelopeMode::WebhookThrow => IrBindingArtifact::Webhook,
            _ => IrBindingArtifact::Decisions,
        }),
    }
}

fn lower_call(owner: &str, def: Option<&BindingCallDef>) -> GenResult<IrBindingCall> {
    let Some(def) = def else {
        return Ok(IrBindingCall::Wrap {
            serialize: IrSerializeKind::ToValue,
            args: vec![],
        });
    };
    match def.kind.as_str() {
        "verbatim" => Ok(IrBindingCall::Verbatim),
        "wrap" => {
            let serialize = def.serialize.as_deref().ok_or_else(|| {
                GenError::Parse(format!("bindings.{owner}.call: wrap requires serialize"))
            })?;
            Ok(IrBindingCall::Wrap {
                serialize: lower_serialize_kind(owner, serialize)?,
                args: def.args.clone(),
            })
        }
        other => Err(GenError::Parse(format!(
            "bindings.{owner}.call: unknown kind {other:?}"
        ))),
    }
}

fn lower_serialize_kind(owner: &str, raw: &str) -> GenResult<IrSerializeKind> {
    match raw {
        "toValue" => Ok(IrSerializeKind::ToValue),
        "valueBool" => Ok(IrSerializeKind::ValueBool),
        "valueString" => Ok(IrSerializeKind::ValueString),
        "valueArray" => Ok(IrSerializeKind::ValueArray),
        "optionHelperErr" => Ok(IrSerializeKind::OptionHelperErr),
        "resultAsValue" => Ok(IrSerializeKind::ResultAsValue),
        "clientAwait" => Ok(IrSerializeKind::ClientAwait),
        "clientSplit" => Ok(IrSerializeKind::ClientSplit),
        "clientIgnore" => Ok(IrSerializeKind::ClientIgnore),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}.call: unknown serialize {other:?}"
        ))),
    }
}

fn lower_extract_kind(owner: &str, arg: &str, raw: &str) -> GenResult<IrExtractKind> {
    match raw {
        "requireString" => Ok(IrExtractKind::RequireString),
        "optionalString" => Ok(IrExtractKind::OptionalString),
        "requireF64" => Ok(IrExtractKind::RequireF64),
        "optionalF64" => Ok(IrExtractKind::OptionalF64),
        "requireI64" => Ok(IrExtractKind::RequireI64),
        "requireU32" => Ok(IrExtractKind::RequireU32),
        "optionalU16" => Ok(IrExtractKind::OptionalU16),
        "optionalU32" => Ok(IrExtractKind::OptionalU32),
        "optionalU64" => Ok(IrExtractKind::OptionalU64),
        "requireBool" => Ok(IrExtractKind::RequireBool),
        "requireObject" => Ok(IrExtractKind::RequireObject),
        "requireArray" => Ok(IrExtractKind::RequireArray),
        "requireTyped" => Ok(IrExtractKind::RequireTyped),
        "optionalTyped" => Ok(IrExtractKind::OptionalTyped),
        "optionalValue" => Ok(IrExtractKind::OptionalValue),
        "rawValueOrNull" => Ok(IrExtractKind::RawValueOrNull),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}.args.{arg}: unknown extract {other:?}"
        ))),
    }
}

fn default_extract(ty: IrBoundaryType, required: bool) -> IrExtractKind {
    match (ty, required) {
        (IrBoundaryType::String, true) => IrExtractKind::RequireString,
        (IrBoundaryType::String | IrBoundaryType::StringOpt, false)
        | (IrBoundaryType::StringOpt, true) => IrExtractKind::OptionalString,
        (IrBoundaryType::F64, true) => IrExtractKind::RequireF64,
        (IrBoundaryType::F64 | IrBoundaryType::F64Opt, false) | (IrBoundaryType::F64Opt, true) => {
            IrExtractKind::OptionalF64
        }
        (IrBoundaryType::I64, _) => IrExtractKind::RequireI64,
        (IrBoundaryType::Bool, _) => IrExtractKind::RequireBool,
        (IrBoundaryType::Value, _) => IrExtractKind::OptionalValue,
    }
}

fn lower_catalog_link(link: &BindingCatalogLink) -> IrBindingCatalogLink {
    match link {
        BindingCatalogLink::None => IrBindingCatalogLink::None,
        BindingCatalogLink::Operation { id } => IrBindingCatalogLink::Operation(id.clone()),
        BindingCatalogLink::TopLevel { id } => IrBindingCatalogLink::TopLevel(id.clone()),
        BindingCatalogLink::CoreHelper { id } => IrBindingCatalogLink::CoreHelper(id.clone()),
        BindingCatalogLink::Facade { id } => IrBindingCatalogLink::Facade(id.clone()),
    }
}

fn lower_boundary_type(owner: &str, arg: &str, raw: &str) -> GenResult<IrBoundaryType> {
    match raw {
        "string" => Ok(IrBoundaryType::String),
        "string?" => Ok(IrBoundaryType::StringOpt),
        "f64" => Ok(IrBoundaryType::F64),
        "f64?" => Ok(IrBoundaryType::F64Opt),
        "i64" => Ok(IrBoundaryType::I64),
        "bool" => Ok(IrBoundaryType::Bool),
        "value" => Ok(IrBoundaryType::Value),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}.args.{arg}: unknown boundary type {other:?}"
        ))),
    }
}

fn lower_sync(owner: &str, raw: &str) -> GenResult<IrSyncKind> {
    match raw {
        "sync" => Ok(IrSyncKind::Sync),
        "async" => Ok(IrSyncKind::Async),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}: unknown sync {other:?}"
        ))),
    }
}

fn lower_envelope(owner: &str, raw: &str) -> GenResult<IrEnvelopeMode> {
    match raw {
        "sync" => Ok(IrEnvelopeMode::Sync),
        "async" => Ok(IrEnvelopeMode::Async),
        "webhookThrow" => Ok(IrEnvelopeMode::WebhookThrow),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}: unknown envelope {other:?}"
        ))),
    }
}

fn to_ir_names(names: LangNames) -> IrLangNames {
    IrLangNames {
        ts: names.ts,
        py: names.py,
        rb: names.rb,
        go: names.go,
        rust: names.rust,
    }
}

/// Serializes `binding_symbols` to canonical pretty JSON for the snapshot gate.
#[must_use]
pub fn dump_binding_symbols(ir: &Ir) -> String {
    let mut root = serde_json::Map::new();
    root.insert(
        "_comment".into(),
        serde_json::Value::String(
            "generated — do not edit; regenerate with dto-gen --dump-bindings".into(),
        ),
    );
    let mut symbols = serde_json::Map::new();
    for (id, symbol) in &ir.binding_symbols {
        symbols.insert(id.clone(), binding_symbol_json(symbol));
    }
    root.insert("bindings".into(), serde_json::Value::Object(symbols));
    format!(
        "{}\n",
        serde_json::to_string_pretty(&serde_json::Value::Object(root))
            .unwrap_or_else(|_| "{}".into())
    )
}

fn binding_symbol_json(symbol: &IrBindingSymbol) -> serde_json::Value {
    let args: Vec<serde_json::Value> = symbol
        .args
        .iter()
        .map(|arg| {
            serde_json::json!({
                "name": arg.name,
                "type": boundary_type_str(arg.ty),
                "required": arg.required,
                "hostInjected": arg.host_injected,
                "extract": extract_kind_str(arg.extract),
                "typedAs": arg.typed_as,
                "typedStyle": typed_style_str(arg.typed_style),
                "local": arg.local,
            })
        })
        .collect();
    serde_json::json!({
        "core": symbol.core,
        "names": {
            "ts": symbol.names.ts,
            "py": symbol.names.py,
            "rb": symbol.names.rb,
            "go": symbol.names.go,
            "rust": symbol.names.rust,
        },
        "catalog": catalog_json(&symbol.catalog),
        "args": args,
        "splitPathRefs": symbol.split_path_refs,
        "return": symbol.return_shape,
        "sync": sync_str(symbol.sync),
        "envelope": envelope_str(symbol.envelope),
        "artifact": artifact_str(symbol.artifact),
        "emitOrder": symbol.emit_order,
        "section": symbol.section,
        "doc": symbol.doc,
        "docWasm": symbol.doc_wasm,
        "rustFnName": symbol.rust_fn_name,
        "call": call_json(&symbol.call),
        "verbatimBody": symbol.verbatim_body,
        "verbatimBodyWasm": symbol.verbatim_body_wasm,
        "dtoType": symbol.dto_type,
        "coreCall": symbol.core_call,
        "clientCallArgs": symbol.client_call_args,
    })
}

fn call_json(call: &IrBindingCall) -> serde_json::Value {
    match call {
        IrBindingCall::Verbatim => serde_json::json!({ "kind": "verbatim" }),
        IrBindingCall::Wrap { serialize, args } => serde_json::json!({
            "kind": "wrap",
            "serialize": serialize_kind_str(*serialize),
            "args": args,
        }),
    }
}

fn artifact_str(artifact: IrBindingArtifact) -> &'static str {
    match artifact {
        IrBindingArtifact::Decisions => "decisions",
        IrBindingArtifact::PayloadBuilders => "payloadBuilders",
        IrBindingArtifact::Client => "client",
        IrBindingArtifact::Webhook => "webhook",
    }
}

fn serialize_kind_str(kind: IrSerializeKind) -> &'static str {
    match kind {
        IrSerializeKind::ToValue => "toValue",
        IrSerializeKind::ValueBool => "valueBool",
        IrSerializeKind::ValueString => "valueString",
        IrSerializeKind::ValueArray => "valueArray",
        IrSerializeKind::OptionHelperErr => "optionHelperErr",
        IrSerializeKind::ResultAsValue => "resultAsValue",
        IrSerializeKind::ClientAwait => "clientAwait",
        IrSerializeKind::ClientSplit => "clientSplit",
        IrSerializeKind::ClientIgnore => "clientIgnore",
    }
}

fn typed_style_str(style: IrTypedStyle) -> &'static str {
    match style {
        IrTypedStyle::Turbofish => "turbofish",
        IrTypedStyle::Annotation => "annotation",
    }
}

fn extract_kind_str(kind: IrExtractKind) -> &'static str {
    match kind {
        IrExtractKind::RequireString => "requireString",
        IrExtractKind::OptionalString => "optionalString",
        IrExtractKind::RequireF64 => "requireF64",
        IrExtractKind::OptionalF64 => "optionalF64",
        IrExtractKind::RequireI64 => "requireI64",
        IrExtractKind::RequireU32 => "requireU32",
        IrExtractKind::OptionalU16 => "optionalU16",
        IrExtractKind::OptionalU32 => "optionalU32",
        IrExtractKind::OptionalU64 => "optionalU64",
        IrExtractKind::RequireBool => "requireBool",
        IrExtractKind::RequireObject => "requireObject",
        IrExtractKind::RequireArray => "requireArray",
        IrExtractKind::RequireTyped => "requireTyped",
        IrExtractKind::OptionalTyped => "optionalTyped",
        IrExtractKind::OptionalValue => "optionalValue",
        IrExtractKind::RawValueOrNull => "rawValueOrNull",
    }
}

fn catalog_json(link: &IrBindingCatalogLink) -> serde_json::Value {
    match link {
        IrBindingCatalogLink::None => serde_json::json!({ "kind": "none" }),
        IrBindingCatalogLink::Operation(id) => {
            serde_json::json!({ "kind": "operation", "id": id })
        }
        IrBindingCatalogLink::TopLevel(id) => serde_json::json!({ "kind": "topLevel", "id": id }),
        IrBindingCatalogLink::CoreHelper(id) => {
            serde_json::json!({ "kind": "coreHelper", "id": id })
        }
        IrBindingCatalogLink::Facade(id) => serde_json::json!({ "kind": "facade", "id": id }),
    }
}

fn boundary_type_str(ty: IrBoundaryType) -> &'static str {
    match ty {
        IrBoundaryType::String => "string",
        IrBoundaryType::StringOpt => "string?",
        IrBoundaryType::F64 => "f64",
        IrBoundaryType::F64Opt => "f64?",
        IrBoundaryType::I64 => "i64",
        IrBoundaryType::Bool => "bool",
        IrBoundaryType::Value => "value",
    }
}

fn sync_str(sync: IrSyncKind) -> &'static str {
    match sync {
        IrSyncKind::Sync => "sync",
        IrSyncKind::Async => "async",
    }
}

fn envelope_str(envelope: IrEnvelopeMode) -> &'static str {
    match envelope {
        IrEnvelopeMode::Sync => "sync",
        IrEnvelopeMode::Async => "async",
        IrEnvelopeMode::WebhookThrow => "webhookThrow",
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
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
    fn lowers_binding_symbols() {
        let yaml = r#"
bindings:
  updateCustomer:
    core: solvapay_transport::SolvaPayClient::update_customer
    names:
      ts: updateCustomer
      py: update_customer
      rb: update_customer
      go: UpdateCustomer
      rust: update_customer
    catalog:
      kind: operation
      id: updateCustomer
    args: []
    splitPathRefs:
      - customerRef
    return: value
    sync: async
    envelope: async
  buildCreateCustomerParams:
    core: solvapay_core::customer_sync::build_create_customer_params
    names:
      ts: buildCreateCustomerParams
      py: build_create_customer_params
      rb: build_create_customer_params
      go: BuildCreateCustomerParams
      rust: build_create_customer_params
    catalog:
      kind: none
    args:
      - name: nowMs
        type: i64
        required: true
        hostInjected: true
    splitPathRefs: []
    return: value
    sync: sync
    envelope: sync
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir = empty_ir();
        lower_bindings(&mut ir, &manifest).unwrap();
        assert_eq!(ir.binding_symbols.len(), 2);
        let update = ir.binding_symbols.get("updateCustomer").unwrap();
        assert_eq!(update.split_path_refs, vec!["customerRef".to_string()]);
        assert_eq!(update.sync, IrSyncKind::Async);
        assert_eq!(update.envelope, IrEnvelopeMode::Async);
        assert!(matches!(
            &update.catalog,
            IrBindingCatalogLink::Operation(id) if id == "updateCustomer"
        ));
        let build = ir.binding_symbols.get("buildCreateCustomerParams").unwrap();
        assert!(build.args[0].host_injected);
        assert_eq!(build.args[0].ty, IrBoundaryType::I64);
    }

    #[test]
    fn binding_symbols_idempotent_across_two_lowers() {
        let yaml = r#"
bindings:
  classifyCustomerRef:
    core: solvapay_core::customer_sync::classify_customer_ref
    names:
      ts: classifyCustomerRef
      py: classify_customer_ref
      rb: classify_customer_ref
      go: ClassifyCustomerRef
      rust: classify_customer_ref
    catalog:
      kind: none
    args:
      - name: customerRef
        type: string
        required: true
    splitPathRefs: []
    return: value
    sync: sync
    envelope: sync
  verifyWebhook:
    core: solvapay_core::webhook::verify_webhook
    names:
      ts: verifyWebhook
      py: verify_webhook
      rb: verify_webhook
      go: VerifyWebhook
      rust: verify_webhook
    catalog:
      kind: topLevel
      id: verifyWebhook
    args:
      - name: body
        type: string
        required: true
      - name: nowUnixSecs
        type: i64
        required: true
        hostInjected: true
    splitPathRefs: []
    return: value
    sync: sync
    envelope: webhookThrow
"#;
        let manifest: Manifest = serde_norway::from_str(yaml).unwrap();
        let mut ir_a = empty_ir();
        lower_bindings(&mut ir_a, &manifest).unwrap();
        let mut ir_b = empty_ir();
        lower_bindings(&mut ir_b, &manifest).unwrap();
        assert_eq!(ir_a.binding_symbols, ir_b.binding_symbols);
        assert_eq!(dump_binding_symbols(&ir_a), dump_binding_symbols(&ir_b));
    }
}
