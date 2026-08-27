//! Binding-symbol dump and extract/sync/envelope lowering helpers.

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrBindingArg, IrBindingArtifact, IrBindingCall, IrBindingCatalogLink, IrBindingSymbol,
    IrBoundaryType, IrEnvelopeMode, IrExtractKind, IrSerializeKind, IrSyncKind, IrTypedStyle,
};
use crate::manifest::BindingArgDef;

pub(crate) fn lower_ts_wrapper(
    def: &crate::manifest::BindingTsWrapperDef,
) -> crate::ir::IrTsWrapper {
    crate::ir::IrTsWrapper {
        export_name: def.export_name.clone(),
        generics: def.generics.clone(),
        return_type: def.return_type.clone(),
        param_types: def.param_types.clone(),
        optional_style: def.optional_style.clone(),
        param_style: def.param_style.clone(),
        pass_through: def.pass_through,
        object_param: def.object_param,
        post_process: def.post_process.clone(),
        dispatch_args: def.dispatch_args.clone(),
        doc: def.doc.clone(),
        server_comment: def.server_comment.clone(),
        signature: def.signature.clone(),
    }
}

pub(crate) fn lower_arg(owner: &str, arg: &BindingArgDef) -> GenResult<IrBindingArg> {
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

pub(crate) fn lower_artifact(
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

pub(crate) fn lower_extract_kind(owner: &str, arg: &str, raw: &str) -> GenResult<IrExtractKind> {
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

pub(crate) fn default_extract(ty: IrBoundaryType, required: bool) -> IrExtractKind {
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

pub(crate) fn lower_sync(owner: &str, raw: &str) -> GenResult<IrSyncKind> {
    match raw {
        "sync" => Ok(IrSyncKind::Sync),
        "async" => Ok(IrSyncKind::Async),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}: unknown sync {other:?}"
        ))),
    }
}

pub(crate) fn lower_envelope(owner: &str, raw: &str) -> GenResult<IrEnvelopeMode> {
    match raw {
        "sync" => Ok(IrEnvelopeMode::Sync),
        "async" => Ok(IrEnvelopeMode::Async),
        "webhookThrow" => Ok(IrEnvelopeMode::WebhookThrow),
        other => Err(GenError::Parse(format!(
            "bindings.{owner}: unknown envelope {other:?}"
        ))),
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
            "c": symbol.names.c,
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
    use crate::ir::IrLangNames;

    fn names(id: &str) -> IrLangNames {
        IrLangNames {
            ts: id.into(),
            py: id.into(),
            rb: id.into(),
            go: id.into(),
            rust: id.into(),
            c: id.into(),
        }
    }

    fn symbol(id: &str) -> IrBindingSymbol {
        IrBindingSymbol {
            id: id.into(),
            core: format!("solvapay_core::example::{id}"),
            names: names(id),
            catalog: IrBindingCatalogLink::None,
            args: vec![],
            split_path_refs: vec![],
            return_shape: "value".into(),
            sync: IrSyncKind::Sync,
            envelope: IrEnvelopeMode::Sync,
            artifact: IrBindingArtifact::Decisions,
            emit_order: 0,
            section: None,
            doc: format!("Binding for `{id}`."),
            doc_wasm: None,
            rust_fn_name: format!("{id}_binding"),
            call: IrBindingCall::Wrap {
                serialize: IrSerializeKind::ToValue,
                args: vec![],
            },
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: Some(id.into()),
            client_call_args: vec![],
            ts_wrapper: None,
        }
    }

    #[test]
    fn dump_is_byte_idempotent() {
        let mut ir = Ir::default();
        ir.binding_symbols
            .insert("classifyCustomerRef".into(), symbol("classifyCustomerRef"));
        let first = dump_binding_symbols(&ir);
        let second = dump_binding_symbols(&ir);
        assert_eq!(first, second);
        assert!(first.contains("\"classifyCustomerRef\""));
    }
}
