//! Walk `solvapay-core` source, root types from `#[solvapay_export]` signatures, and close over named refs.

use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs;
use std::path::Path;

use walkdir::WalkDir;

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrBindingArtifact, IrCoreFieldTy, IrCoreFn, IrCoreShape, IrCoreTsAlias, IrCoreType,
    IrCoreTypesTs,
};
use crate::manifest::{BoundaryTypesTsDef, Manifest};
use crate::scan_core_types::{
    named_refs, named_refs_in_field_ty, scan_core_file_skipping_unsupported, CoreScan,
};

/// Scan every `.rs` file under `core_src`, index by type name, then keep the
/// transitive closure of `roots`.
///
/// # Errors
///
/// Unknown root names, duplicate type names, unresolvable named field refs,
/// and IO/parse failures.
pub fn lower_core_types(ir: &mut Ir, core_src: &Path, manifest: &Manifest) -> GenResult<()> {
    let scan = walk_core_src(core_src)?;
    let index = index_core_types(scan.types)?;
    ir.core_fns = index_core_fns(scan.fns)?;
    let roots = export_type_roots(&ir.core_fns, &index);
    if roots.is_empty() {
        return Err(GenError::Parse(
            "no boundary type roots from #[solvapay_export] signatures".into(),
        ));
    }
    ir.core_types = close_core_types(&index, &roots)?;
    ir.core_types_ts = lower_boundary_types_ts(&manifest.boundary_types_ts);
    Ok(())
}

/// Copy `boundaryTypesTs:` into IR.
pub fn lower_boundary_types_ts(def: &BoundaryTypesTsDef) -> IrCoreTypesTs {
    IrCoreTypesTs {
        omit: def.omit.iter().cloned().collect(),
        aliases: def
            .aliases
            .iter()
            .map(|(name, alias)| {
                (
                    name.clone(),
                    IrCoreTsAlias {
                        of: alias.of.clone(),
                        omit_fields: alias.omit_fields.iter().cloned().collect(),
                    },
                )
            })
            .collect(),
        rename: def.rename.clone(),
        reshape: def.reshape.clone(),
        extra: def.extra.clone(),
    }
}

/// Recursively parse `.rs` files under `core_src`.
///
/// # Errors
///
/// IO or syn parse failures.
pub fn walk_core_src(core_src: &Path) -> GenResult<CoreScan> {
    walk_crate_src(core_src, "solvapay_core")
}

/// Recursively parse `.rs` files under `solvapay-transport` source.
///
/// # Errors
///
/// IO or syn parse failures.
pub fn walk_transport_src(transport_src: &Path) -> GenResult<CoreScan> {
    walk_crate_src(transport_src, "solvapay_transport")
}

/// Index scanned `solvapay-transport` functions. Does not merge into `core_fns`.
///
/// # Errors
///
/// Duplicate paths or IO/parse failures.
pub fn lower_transport_fns(ir: &mut Ir, transport_src: &Path) -> GenResult<()> {
    let scan = walk_transport_src(transport_src)?;
    ir.transport_fns = index_core_fns(scan.fns)?;
    Ok(())
}

fn walk_crate_src(src_root: &Path, crate_name: &str) -> GenResult<CoreScan> {
    let mut out = CoreScan::default();
    for entry in WalkDir::new(src_root) {
        let entry = entry.map_err(|e| GenError::Parse(format!("walkdir: {e}")))?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let rel = path.strip_prefix(src_root).map_err(|e| {
            GenError::Parse(format!(
                "path {} is not under {}: {e}",
                path.display(),
                src_root.display()
            ))
        })?;
        let module = module_from_rel(rel);
        let src = fs::read_to_string(path).map_err(|source| GenError::Io {
            path: path.to_path_buf(),
            source,
        })?;
        let file = scan_core_file_skipping_unsupported(&src, &module)?;
        out.types.extend(file.types);
        for mut func in file.fns {
            func.crate_name = crate_name.to_owned();
            out.fns.push(func);
        }
    }
    Ok(out)
}

/// Index scanned functions by fully-qualified `solvapay_core::…` path.
///
/// # Errors
///
/// Two functions resolving to the same path.
pub fn index_core_fns(fns: Vec<IrCoreFn>) -> GenResult<BTreeMap<String, IrCoreFn>> {
    let mut index: BTreeMap<String, IrCoreFn> = BTreeMap::new();
    for func in fns {
        let path = func.core_path();
        if let Some(existing) = index.get(&path) {
            return Err(GenError::Parse(format!(
                "duplicate core fn path {path} ({} and {})",
                existing.module, func.module
            )));
        }
        index.insert(path, func);
    }
    Ok(index)
}

/// Every Decisions / PayloadBuilders binding must resolve to a scanned signature.
///
/// Client symbols resolve against `transport_fns` when that index is populated.
/// Webhook symbols live in `solvapay-core` and join like other core helpers.
/// Matching is exact-path: `symbol.core` equals [`IrCoreFn::core_path`] or
/// [`IrCoreFn::binding_core`].
pub(crate) fn join_binding_fns(ir: &Ir) -> GenResult<()> {
    let mut missing = Vec::new();
    for symbol in ir.binding_symbols.values() {
        match symbol.artifact {
            IrBindingArtifact::Decisions | IrBindingArtifact::PayloadBuilders => {
                match resolve_core_fn(ir, symbol) {
                    Ok(_) => {}
                    Err(err) if err.to_string().contains("unresolved core fn join") => {
                        missing.push(format!("{} ({})", symbol.id, symbol.core));
                    }
                    Err(err) => return Err(err),
                }
            }
            IrBindingArtifact::Webhook => match resolve_core_fn(ir, symbol) {
                Ok(_) => {}
                Err(err) if err.to_string().contains("unresolved core fn join") => {
                    missing.push(format!("{} ({})", symbol.id, symbol.core));
                }
                Err(err) => return Err(err),
            },
            IrBindingArtifact::Client => {
                if ir.transport_fns.is_empty() {
                    continue;
                }
                match resolve_transport_fn(ir, symbol) {
                    Ok(_) => {}
                    Err(err) if err.to_string().contains("unresolved transport fn join") => {
                        missing.push(format!("{} ({})", symbol.id, symbol.core));
                    }
                    Err(err) => return Err(err),
                }
            }
        }
    }
    if !missing.is_empty() {
        return Err(GenError::Parse(format!(
            "unresolved core fn join for {} binding(s): {}",
            missing.len(),
            missing.join(", ")
        )));
    }
    Ok(())
}

/// Resolve the scanned signature for a Decisions / PayloadBuilders binding.
///
/// # Errors
///
/// Missing or ambiguous joins (same rules as [`join_binding_fns`]).
pub fn core_fn_for<'a>(ir: &'a Ir, symbol: &crate::ir::IrBindingSymbol) -> GenResult<&'a IrCoreFn> {
    resolve_core_fn(ir, symbol)
}

fn resolve_core_fn<'a>(ir: &'a Ir, symbol: &crate::ir::IrBindingSymbol) -> GenResult<&'a IrCoreFn> {
    resolve_fn_in(&ir.core_fns, symbol, "core")
}

fn resolve_transport_fn<'a>(
    ir: &'a Ir,
    symbol: &crate::ir::IrBindingSymbol,
) -> GenResult<&'a IrCoreFn> {
    resolve_fn_in(&ir.transport_fns, symbol, "transport")
}

fn resolve_fn_in<'a>(
    index: &'a BTreeMap<String, IrCoreFn>,
    symbol: &crate::ir::IrBindingSymbol,
    kind: &str,
) -> GenResult<&'a IrCoreFn> {
    if let Some(func) = index.get(&symbol.core) {
        return Ok(func);
    }
    let matches: Vec<_> = index
        .values()
        .filter(|func| func.binding_core() == symbol.core)
        .collect();
    match matches.as_slice() {
        [func] => Ok(*func),
        [] => Err(GenError::Parse(format!(
            "unresolved {kind} fn join for binding {} ({})",
            symbol.id, symbol.core
        ))),
        _ => Err(GenError::Parse(format!(
            "ambiguous {kind} fn join for binding {}: {} matches {:?}",
            symbol.id,
            symbol.core,
            matches.iter().map(|f| f.core_path()).collect::<Vec<_>>()
        ))),
    }
}

fn module_from_rel(rel: &Path) -> String {
    let mut parts: Vec<String> = rel
        .iter()
        .map(|s| s.to_string_lossy().into_owned())
        .collect();
    if let Some(file) = parts.last() {
        if file.ends_with(".rs") {
            let stem = file.trim_end_matches(".rs").to_owned();
            parts.pop();
            if stem != "mod" && stem != "lib" {
                parts.push(stem);
            }
        }
    }
    parts.join("::")
}

/// Index scanned types by bare name. Duplicate names are an error.
///
/// # Errors
///
/// Two modules defining the same type name.
pub fn index_core_types(types: Vec<IrCoreType>) -> GenResult<BTreeMap<String, IrCoreType>> {
    let mut index: BTreeMap<String, IrCoreType> = BTreeMap::new();
    for ty in types {
        if let Some(existing) = index.get(&ty.name) {
            return Err(GenError::Parse(format!(
                "duplicate core type name {}: {} and {}",
                ty.name, existing.module, ty.module
            )));
        }
        index.insert(ty.name.clone(), ty);
    }
    Ok(index)
}

/// Named types on `#[solvapay_export]` signatures that exist in the core type index.
///
/// Overlay DTOs, `Result`, and std types are skipped because they are not
/// `solvapay-core` structs/enums.
#[must_use]
pub fn export_type_roots(
    fns: &BTreeMap<String, IrCoreFn>,
    index: &BTreeMap<String, IrCoreType>,
) -> Vec<String> {
    let mut roots = BTreeSet::new();
    for func in fns.values() {
        let Some(attr) = &func.exported else {
            continue;
        };
        let mut names = Vec::new();
        for param in &func.params {
            names.extend(named_refs_in_field_ty(&param.ty.ty));
        }
        names.extend(named_refs_in_field_ty(&func.return_ty.ty));
        names.extend(attr.typed_as.values().cloned());
        for name in names {
            if index.contains_key(&name) {
                roots.insert(name);
            }
        }
    }
    roots.into_iter().collect()
}

/// Keep `roots` plus every named type they reference, transitively.
///
/// # Errors
///
/// Unknown root or named field reference.
pub fn close_core_types(
    index: &BTreeMap<String, IrCoreType>,
    roots: &[String],
) -> GenResult<BTreeMap<String, IrCoreType>> {
    let mut selected: BTreeSet<String> = BTreeSet::new();
    let mut queue: VecDeque<String> = VecDeque::new();
    for root in roots {
        if !index.contains_key(root) {
            return Err(GenError::Parse(format!(
                "unknown boundary type root: {root}"
            )));
        }
        if selected.insert(root.clone()) {
            queue.push_back(root.clone());
        }
    }
    while let Some(name) = queue.pop_front() {
        let ty = index
            .get(&name)
            .ok_or_else(|| GenError::Parse(format!("unknown core type ref: {name}")))?;
        for dep in named_refs(ty) {
            if !index.contains_key(&dep) {
                return Err(GenError::Parse(format!(
                    "unknown core type ref {dep} from {name}"
                )));
            }
            if selected.insert(dep.clone()) {
                queue.push_back(dep);
            }
        }
    }
    let mut out = BTreeMap::new();
    for name in selected {
        match index.get(&name) {
            Some(ty) => {
                out.insert(name, ty.clone());
            }
            None => {
                return Err(GenError::Parse(format!("unknown core type ref: {name}")));
            }
        }
    }
    Ok(out)
}

/// Pretty-print `ir.core_types` for the drift-gated snapshot.
///
/// # Errors
///
/// JSON serialization failure (should not happen for this value shape).
pub fn dump_core_types(ir: &Ir) -> GenResult<String> {
    let mut root = serde_json::Map::new();
    root.insert(
        "_comment".into(),
        serde_json::Value::String(
            "generated — do not edit; regenerate with dto-gen --dump-boundary-types".into(),
        ),
    );
    let mut types = serde_json::Map::new();
    for (name, ty) in &ir.core_types {
        types.insert(name.clone(), core_type_json(ty));
    }
    root.insert("types".into(), serde_json::Value::Object(types));
    let mut fns = serde_json::Map::new();
    for (path, func) in &ir.core_fns {
        fns.insert(path.clone(), core_fn_json(func));
    }
    root.insert("fns".into(), serde_json::Value::Object(fns));
    let pretty = serde_json::to_string_pretty(&serde_json::Value::Object(root))
        .map_err(|e| GenError::Parse(format!("core types dump: {e}")))?;
    Ok(format!("{pretty}\n"))
}

fn core_type_json(ty: &IrCoreType) -> serde_json::Value {
    let mut obj = serde_json::Map::new();
    obj.insert(
        "module".into(),
        serde_json::Value::String(ty.module.clone()),
    );
    obj.insert(
        "rustdoc".into(),
        serde_json::Value::String(ty.rustdoc.clone()),
    );
    obj.insert(
        "serde".into(),
        serde_json::Value::String(
            match ty.serde {
                crate::ir::IrCoreSerde::None => "none",
                crate::ir::IrCoreSerde::Serialize => "serialize",
                crate::ir::IrCoreSerde::Deserialize => "deserialize",
                crate::ir::IrCoreSerde::Both => "both",
            }
            .into(),
        ),
    );
    obj.insert(
        "cfgFeature".into(),
        match &ty.cfg_feature {
            Some(f) => serde_json::Value::String(f.clone()),
            None => serde_json::Value::Null,
        },
    );
    obj.insert("shape".into(), shape_json(&ty.shape));
    serde_json::Value::Object(obj)
}

fn core_fn_json(func: &IrCoreFn) -> serde_json::Value {
    serde_json::json!({
        "name": func.name,
        "module": func.module,
        "implTy": func.impl_ty,
        "rustdoc": func.rustdoc,
        "params": func.params.iter().map(|p| serde_json::json!({
            "rustName": p.rust_name,
            "byRef": p.by_ref,
            "optional": p.ty.optional,
            "ty": field_ty_json(&p.ty.ty),
        })).collect::<Vec<_>>(),
        "return": {
            "optional": func.return_ty.optional,
            "ty": field_ty_json(&func.return_ty.ty),
        },
    })
}

fn shape_json(shape: &IrCoreShape) -> serde_json::Value {
    match shape {
        IrCoreShape::Struct { rename_all, fields } => serde_json::json!({
            "kind": "struct",
            "renameAll": rename_all,
            "fields": fields.iter().map(field_json).collect::<Vec<_>>(),
        }),
        IrCoreShape::UnitEnum {
            rename_all,
            variants,
        } => serde_json::json!({
            "kind": "unitEnum",
            "renameAll": rename_all,
            "variants": variants.iter().map(variant_json).collect::<Vec<_>>(),
        }),
        IrCoreShape::TaggedEnum {
            tag,
            rename_all,
            variants,
        } => serde_json::json!({
            "kind": "taggedEnum",
            "tag": tag,
            "renameAll": rename_all,
            "variants": variants.iter().map(variant_json).collect::<Vec<_>>(),
        }),
        IrCoreShape::UntaggedEnum {
            rename_all,
            variants,
        } => serde_json::json!({
            "kind": "untaggedEnum",
            "renameAll": rename_all,
            "variants": variants.iter().map(variant_json).collect::<Vec<_>>(),
        }),
    }
}

fn field_json(field: &crate::ir::IrCoreField) -> serde_json::Value {
    serde_json::json!({
        "rustName": field.rust_name,
        "wireName": field.wire_name,
        "rustdoc": field.rustdoc,
        "optional": field.optional,
        "skipSerializingIf": field.skip_serializing_if,
        "serdeDefault": field.serde_default,
        "serializeWith": field.serialize_with,
        "cfgFeature": field.cfg_feature,
        "ty": field_ty_json(&field.ty),
    })
}

fn variant_json(variant: &crate::ir::IrCoreVariant) -> serde_json::Value {
    serde_json::json!({
        "rustName": variant.rust_name,
        "wireName": variant.wire_name,
        "rustdoc": variant.rustdoc,
        "cfgFeature": variant.cfg_feature,
        "fields": variant.fields.iter().map(field_json).collect::<Vec<_>>(),
    })
}

fn field_ty_json(ty: &IrCoreFieldTy) -> serde_json::Value {
    match ty {
        IrCoreFieldTy::String => serde_json::json!({ "kind": "string" }),
        IrCoreFieldTy::Bool => serde_json::json!({ "kind": "bool" }),
        IrCoreFieldTy::U16 => serde_json::json!({ "kind": "u16" }),
        IrCoreFieldTy::U32 => serde_json::json!({ "kind": "u32" }),
        IrCoreFieldTy::U64 => serde_json::json!({ "kind": "u64" }),
        IrCoreFieldTy::I64 => serde_json::json!({ "kind": "i64" }),
        IrCoreFieldTy::F64 => serde_json::json!({ "kind": "f64" }),
        IrCoreFieldTy::Value => serde_json::json!({ "kind": "value" }),
        IrCoreFieldTy::Unit => serde_json::json!({ "kind": "unit" }),
        IrCoreFieldTy::Tuple(elems) => serde_json::json!({
            "kind": "tuple",
            "elems": elems.iter().map(field_ty_json).collect::<Vec<_>>(),
        }),
        IrCoreFieldTy::Vec(inner) => {
            serde_json::json!({ "kind": "vec", "item": field_ty_json(inner) })
        }
        IrCoreFieldTy::Map(inner) => {
            serde_json::json!({ "kind": "map", "value": field_ty_json(inner) })
        }
        IrCoreFieldTy::Named(name) => serde_json::json!({ "kind": "named", "name": name }),
        IrCoreFieldTy::Result { ok, err } => serde_json::json!({
            "kind": "result",
            "ok": field_ty_json(ok),
            "err": field_ty_json(err),
        }),
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use crate::ir::{IrCoreFieldTy, IrCoreFn, IrCoreParamTy};
    use crate::scan_core_types::{scan_core_file, scan_core_types};

    const PAYWALL_OUTCOME: &str = r#"
#[derive(Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "camelCase")]
pub enum PaywallOutcome {
    Allow,
    Gate { gate: PaywallGate },
}
"#;

    const PAYWALL_GATE: &str = r#"
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallGate {
    pub kind: PaywallGateKind,
    pub product: String,
    pub checkout_url: String,
    pub message: String,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaywallGateKind {
    PaymentRequired,
    ActivationRequired,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallGateLimits {
    pub plan: Option<String>,
}
"#;

    fn index_from_snippets() -> BTreeMap<String, IrCoreType> {
        let mut types = scan_core_types(PAYWALL_OUTCOME, "paywall_decision").unwrap();
        types.extend(scan_core_types(PAYWALL_GATE, "paywall_gate").unwrap());
        index_core_types(types).unwrap()
    }

    #[test]
    fn paywall_outcome_closure_pulls_gate_and_kind() {
        let index = index_from_snippets();
        let closed = close_core_types(&index, &["PaywallOutcome".into()]).unwrap();
        assert!(closed.contains_key("PaywallOutcome"));
        assert!(closed.contains_key("PaywallGate"));
        assert!(closed.contains_key("PaywallGateKind"));
        assert!(
            !closed.contains_key("PaywallGateLimits"),
            "PaywallGateLimits is not a named field of PaywallOutcome/PaywallGate"
        );
        let with_limits = close_core_types(
            &index,
            &["PaywallOutcome".into(), "PaywallGateLimits".into()],
        )
        .unwrap();
        assert!(with_limits.contains_key("PaywallGateLimits"));
    }

    #[test]
    fn export_roots_close_over_annotated_signatures_not_unexported_fns() {
        let src = r#"
#[derive(Serialize)]
pub struct CheckLimitsParams { pub product_ref: String }
#[derive(Serialize)]
pub struct HelperErrorResult { pub error: String }
#[derive(Serialize)]
pub struct UnusedRoot { pub x: String }

#[solvapay_export]
pub fn resolve_check_limits_params() -> Result<CheckLimitsParams, HelperErrorResult> {
    unimplemented!()
}

pub fn ignore_me(_u: UnusedRoot) {}
"#;
        let scan = scan_core_file(src, "limits", false).unwrap();
        let index = index_core_types(scan.types).unwrap();
        let fns = index_core_fns(scan.fns).unwrap();
        let roots = export_type_roots(&fns, &index);
        assert_eq!(
            roots,
            vec![
                "CheckLimitsParams".to_string(),
                "HelperErrorResult".to_string()
            ]
        );
        assert!(!roots.iter().any(|n| n == "UnusedRoot"));
    }

    #[test]
    fn unknown_root_is_an_error() {
        let index = index_from_snippets();
        let err = close_core_types(&index, &["DoesNotExist".into()]).unwrap_err();
        assert!(
            err.to_string().contains("unknown boundary type root"),
            "{err}"
        );
    }

    #[test]
    fn duplicate_type_name_is_an_error() {
        let a = scan_core_types("pub struct Dup { pub x: String }", "one").unwrap();
        let b = scan_core_types("pub struct Dup { pub y: String }", "two").unwrap();
        let mut types = a;
        types.extend(b);
        let err = index_core_types(types).unwrap_err();
        assert!(
            err.to_string().contains("duplicate core type name Dup"),
            "{err}"
        );
    }

    #[test]
    fn dump_is_byte_idempotent() {
        let index = index_from_snippets();
        let closed = close_core_types(&index, &["PaywallOutcome".into()]).unwrap();
        let ir = Ir {
            core_types: closed,
            core_types_ts: Default::default(),
            core_fns: Default::default(),
            transport_fns: Default::default(),
            ..Ir::default()
        };
        let first = dump_core_types(&ir).unwrap();
        let second = dump_core_types(&ir).unwrap();
        assert_eq!(first, second);
        let again = close_core_types(&index, &["PaywallOutcome".into()]).unwrap();
        assert_eq!(ir.core_types, again);
    }

    fn dummy_fn(name: &str, module: &str) -> IrCoreFn {
        IrCoreFn {
            name: name.into(),
            module: module.into(),
            impl_ty: None,
            crate_name: String::new(),
            rustdoc: String::new(),
            params: vec![],
            return_ty: IrCoreParamTy {
                optional: false,
                ty: IrCoreFieldTy::Bool,
            },
            exported: None,
            is_async: false,
        }
    }

    fn dummy_decisions(id: &str, core: &str) -> crate::ir::IrBindingSymbol {
        crate::ir::IrBindingSymbol {
            id: id.into(),
            core: core.into(),
            names: crate::ir::IrLangNames {
                ts: id.into(),
                py: id.into(),
                rb: id.into(),
                go: id.into(),
                rust: id.into(),
            },
            catalog: crate::ir::IrBindingCatalogLink::None,
            args: vec![],
            split_path_refs: vec![],
            return_shape: "value".into(),
            sync: crate::ir::IrSyncKind::Sync,
            envelope: crate::ir::IrEnvelopeMode::Sync,
            artifact: IrBindingArtifact::Decisions,
            emit_order: 0,
            section: None,
            doc: String::new(),
            doc_wasm: None,
            rust_fn_name: id.into(),
            call: crate::ir::IrBindingCall::Verbatim,
            verbatim_body: None,
            verbatim_body_wasm: None,
            dto_type: None,
            core_call: None,
            client_call_args: vec![],
            ts_wrapper: None,
        }
    }

    #[test]
    fn join_rejects_bare_name_when_path_differs() {
        let func = dummy_fn("classify_customer_ref", "customer_sync");
        let mut ir = Ir {
            core_fns: BTreeMap::new(),
            ..Ir::default()
        };
        ir.core_fns.insert(func.core_path(), func);
        ir.binding_symbols.insert(
            "classifyCustomerRef".into(),
            dummy_decisions(
                "classifyCustomerRef",
                "solvapay_core::wrong::classify_customer_ref",
            ),
        );
        let err = join_binding_fns(&ir).unwrap_err();
        assert!(err.to_string().contains("unresolved core fn join"), "{err}");
    }

    #[test]
    fn join_accepts_binding_core_first_segment() {
        let func = dummy_fn("mcp_tool_names_json", "mcp::tool_names");
        let mut ir = Ir {
            core_fns: BTreeMap::new(),
            ..Ir::default()
        };
        ir.core_fns.insert(func.core_path(), func);
        ir.binding_symbols.insert(
            "MCP_TOOL_NAMES".into(),
            dummy_decisions("MCP_TOOL_NAMES", "solvapay_core::mcp::mcp_tool_names_json"),
        );
        join_binding_fns(&ir).unwrap();
    }
}
