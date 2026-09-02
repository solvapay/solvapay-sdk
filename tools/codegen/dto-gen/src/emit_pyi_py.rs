//! Emit the public Python `.pyi` stub surface from canonical catalog IR (Step 42T).
//!
//! Keeps the JSON-string boundary (`args_json: str` → `str` envelope). Async +
//! `_blocking` twins express the sync matrix; docstrings come from `IrDocModel`.

use std::fmt::Write as _;

use crate::doc_render::render_entry_doc_lines;
use crate::emit_helpers::{catalog_helper_bindings, is_constant_entry, snake};
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrBindingArg, IrBindingSymbol, IrBoundaryType, IrCoreFieldTy, IrCoreParamTy, IrEntryPoint,
    IrEntrySection, IrSyncKind, IrTypeRef,
};

const PREAMBLE: &str = r#""""Portable Python surface stubs (generated from the SDK contract IR)."""

from __future__ import annotations

from solvapay.errors import PaywallError as PaywallError
from solvapay.facade import (
    ApiClient as ApiClient,
    SolvaPay as SolvaPay,
    create_solvapay as create_solvapay,
)
from solvapay.results import (
    PayableAllowResult as PayableAllowResult,
    PayableGateResult as PayableGateResult,
    PayablePaywallResult as PayablePaywallResult,
)

"#;

/// Emits `solvapay/__init__.pyi` contents.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_pyi_py(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n{PREAMBLE}",
        generated_header(CommentStyle::Hash, "py-stub-out")
    );
    out.push_str(
        "class SolvaPayError(Exception):\n\
         \x20   code: str\n\
         \x20   status: int | None\n\
         \n\
         class SolvaPayClient:\n\
         \x20   def __init__(self, api_key: str, api_base_url: str | None = None) -> None: ...\n\
         \x20   @staticmethod\n\
         \x20   def _for_fixtures(\n\
         \x20       api_key: str,\n\
         \x20       api_base_url: str,\n\
         \x20       clock_unix_ms: int | None = None,\n\
         \x20       rng_seed: int | None = None,\n\
         \x20   ) -> SolvaPayClient: ...\n",
    );

    let mut operations: Vec<&IrEntryPoint> = ir
        .entry_points
        .values()
        .filter(|ep| ep.section == IrEntrySection::Operation)
        .collect();
    operations.sort_by(|a, b| a.names.py.cmp(&b.names.py).then(a.id.cmp(&b.id)));

    for ep in operations {
        emit_client_operation(&mut out, ep);
    }

    out.push('\n');
    out.push_str(
        "def version() -> str:\n\
         \x20   \"\"\"Return the installed solvapay package / native module version.\"\"\"\n\
         \x20   ...\n\
         def native_build_info() -> str:\n\
         \x20   \"\"\"Return `{version, coreSha}` JSON for version-stamping diagnostics.\"\"\"\n\
         \x20   ...\n",
    );

    if let Some(verify) = ir.entry_points.get("verifyWebhook") {
        let doc = render_pydoc(verify);
        out.push_str("def verify_webhook(body: str, signature: str, secret: str) -> str:\n");
        write_pydoc_block(&mut out, &doc, "    ");
        out.push_str("    ...\n");
    } else {
        out.push_str("def verify_webhook(body: str, signature: str, secret: str) -> str: ...\n");
    }

    out.push_str(
        "def _verify_webhook_at(\n\
         \x20   body: str, signature: str, secret: str, now_unix_secs: int\n\
         ) -> str: ...\n",
    );

    out.push('\n');
    let helpers: Vec<_> = catalog_helper_bindings(ir)
        .into_iter()
        .filter(|(_, entry)| entry.emission.py.is_generated())
        .collect();
    for (binding, entry) in helpers {
        let doc = render_pydoc(entry);
        if is_constant_entry(entry) {
            let _ = writeln!(out, "{}: {}", entry.names.py, py_helper_return(ir, binding));
            write_pydoc_block(&mut out, &doc, "");
            continue;
        }
        let public_args: Vec<&IrBindingArg> =
            binding.args.iter().filter(|a| !a.host_injected).collect();
        let required: Vec<bool> = public_args.iter().map(|arg| arg.required).collect();
        let params = public_args
            .iter()
            .enumerate()
            .map(|(i, arg)| {
                let name = snake(&arg.name);
                let ty = py_arg_type(arg);
                if arg.required {
                    format!("{name}: {ty}")
                } else if crate::emit_helpers::trailing_has_required(&required, i) {
                    format!("{name}: {ty} | None")
                } else {
                    format!("{name}: {ty} | None = None")
                }
            })
            .collect::<Vec<_>>();
        write_pyi_def(
            &mut out,
            &entry.names.py,
            &params,
            &py_helper_return(ir, binding),
        );
        write_pydoc_block(&mut out, &doc, "    ");
        out.push_str("    ...\n");
    }

    Ok(out)
}

fn emit_client_operation(out: &mut String, ep: &IrEntryPoint) {
    let name = &ep.names.py;
    let doc = render_pydoc(ep);
    let has_async = ep.availability.py.contains(&IrSyncKind::Async);
    let has_sync = ep.availability.py.contains(&IrSyncKind::Sync);

    if has_async {
        let _ = writeln!(out, "    async def {name}(self, args_json: str) -> str:");
        write_pydoc_block(out, &doc, "        ");
        out.push_str("        ...\n");
    }
    if has_sync {
        let blocking = format!("{name}_blocking");
        let _ = writeln!(out, "    def {blocking}(self, args_json: str) -> str:");
        write_pydoc_block(out, &doc, "        ");
        out.push_str("        ...\n");
    }
}

/// Builds a Python docstring body from the shared IR doc model.
pub(crate) fn render_pydoc(ep: &IrEntryPoint) -> String {
    render_entry_doc_lines(ep, |p| p.names.py.as_str()).join("\n")
}

const PYDOC_WIDTH: usize = 100;

pub(crate) fn write_pydoc_block(out: &mut String, doc: &str, indent: &str) {
    let trimmed = doc.trim();
    if trimmed.is_empty() {
        return;
    }
    let wrapped = wrap_pydoc_lines(trimmed, indent.len());
    if wrapped.len() == 1 {
        let _ = writeln!(out, "{indent}\"\"\"{first}\"\"\"", first = wrapped[0]);
        return;
    }
    let _ = writeln!(out, "{indent}\"\"\"{first}", first = wrapped[0]);
    for line in &wrapped[1..] {
        if line.is_empty() {
            let _ = writeln!(out, "{indent}");
        } else {
            let _ = writeln!(out, "{indent}{line}");
        }
    }
    let _ = writeln!(out, "{indent}\"\"\"");
}

fn wrap_pydoc_lines(doc: &str, indent_len: usize) -> Vec<String> {
    let budget = PYDOC_WIDTH.saturating_sub(indent_len).max(20);
    let mut out = Vec::new();
    for raw in doc.lines() {
        if raw.is_empty() {
            out.push(String::new());
            continue;
        }
        if raw.len() <= budget {
            out.push(raw.to_string());
            continue;
        }
        let mut rest = raw;
        while rest.len() > budget {
            let split_at = rest[..budget]
                .rfind(' ')
                .filter(|idx| *idx > 0)
                .unwrap_or(budget);
            out.push(rest[..split_at].to_string());
            rest = rest[split_at..].trim_start();
        }
        if !rest.is_empty() {
            out.push(rest.to_string());
        }
    }
    out
}

fn write_pyi_def(out: &mut String, name: &str, params: &[String], ret: &str) {
    let one_line = format!("def {name}({}) -> {ret}:", params.join(", "));
    if one_line.len() <= 100 {
        out.push_str(&one_line);
        out.push('\n');
        return;
    }
    let _ = writeln!(out, "def {name}(");
    for param in params {
        let _ = writeln!(out, "    {param},");
    }
    let _ = writeln!(out, ") -> {ret}:");
}

fn py_arg_type(arg: &IrBindingArg) -> &'static str {
    match arg.ty {
        IrBoundaryType::String | IrBoundaryType::StringOpt => "str",
        IrBoundaryType::Bool => "bool",
        IrBoundaryType::F64 | IrBoundaryType::F64Opt => "float",
        IrBoundaryType::I64 => "int",
        IrBoundaryType::Value => "object",
    }
}

fn lookup_core_fn<'a>(ir: &'a Ir, binding: &IrBindingSymbol) -> Option<&'a crate::ir::IrCoreFn> {
    ir.core_fns.get(&binding.core).or_else(|| {
        ir.core_fns
            .values()
            .find(|func| func.core_path() == binding.core || func.binding_core() == binding.core)
    })
}

fn py_helper_return(ir: &Ir, binding: &IrBindingSymbol) -> String {
    lookup_core_fn(ir, binding).map_or_else(
        || "object".to_owned(),
        |func| py_from_core_ty(&func.return_ty),
    )
}

fn py_from_core_ty(ty: &IrCoreParamTy) -> String {
    let base = py_from_field_ty(&ty.ty);
    if ty.optional {
        format!("{base} | None")
    } else {
        base
    }
}

fn py_from_field_ty(ty: &IrCoreFieldTy) -> String {
    match ty {
        IrCoreFieldTy::String => "str".into(),
        IrCoreFieldTy::Bool => "bool".into(),
        IrCoreFieldTy::U16 | IrCoreFieldTy::U32 | IrCoreFieldTy::U64 | IrCoreFieldTy::I64 => {
            "int".into()
        }
        IrCoreFieldTy::F64 => "float".into(),
        IrCoreFieldTy::Unit => "None".into(),
        IrCoreFieldTy::Vec(item) => format!("list[{}]", py_from_field_ty(item)),
        IrCoreFieldTy::Map(item) => format!("dict[str, {}]", py_from_field_ty(item)),
        IrCoreFieldTy::Result { ok, .. } => py_from_field_ty(ok),
        IrCoreFieldTy::Tuple(items) => {
            let inner = items
                .iter()
                .map(py_from_field_ty)
                .collect::<Vec<_>>()
                .join(", ");
            format!("tuple[{inner}]")
        }
        IrCoreFieldTy::Value | IrCoreFieldTy::Named(_) => "object".into(),
    }
}

/// Maps an IR boundary / wire type to a Python annotation (§5.6 type-mapping).
#[allow(dead_code)] // exercised by unit tests; reserved for non-JSON params
fn py_type_ref(ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::String | IrTypeRef::LiteralString(_) => "str".into(),
        IrTypeRef::I64 => "int".into(),
        IrTypeRef::F64 => "float".into(),
        IrTypeRef::Bool | IrTypeRef::LiteralBool(_) => "bool".into(),
        IrTypeRef::Vec(item) => format!("list[{}]", py_type_ref(item)),
        IrTypeRef::Map(item) => format!("dict[str, {}]", py_type_ref(item)),
        // JSON-string boundary: named DTOs / free-form values stay opaque strings
        // at the portable client surface (no TypedDict emission in 42T).
        IrTypeRef::Value | IrTypeRef::Named(_) => "str".into(),
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use crate::ir::{
        IrAvailability, IrDefaults, IrDocModel, IrEmissionMatrix, IrErrorKind, IrLangNames,
        IrParam, IrRubyReceiver, IrRubyTarget,
    };
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
            core_types: BTreeMap::new(),
            core_types_ts: Default::default(),
            core_fns: Default::default(),
            transport_fns: Default::default(),
        }
    }

    fn check_limits_ep() -> IrEntryPoint {
        IrEntryPoint {
            id: "checkLimits".into(),
            section: IrEntrySection::Operation,
            names: IrLangNames {
                ts: "checkLimits".into(),
                py: "check_limits".into(),
                rb: "check_limits".into(),
                go: "CheckLimits".into(),
                rust: "check_limits".into(),
                c: "checkLimits".into(),
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
                    c: "params".into(),
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
            emission: IrEmissionMatrix::default(),
            mcp_surface: None,
            feature: None,
            ruby_target: IrRubyTarget {
                owner: "SolvaPay::Client".into(),
                name: "check_limits".into(),
                receiver: IrRubyReceiver::ClientInstance,
                takes_block: false,
            },
            defaults: IrDefaults::default(),
            errors: vec![IrErrorKind::Api],
            docs: IrDocModel {
                summary:
                    "Check remaining usage/spend limits for a customer against a product's plan."
                        .into(),
                returns: Some(
                    "Current remaining limits, optionally including plan details.".into(),
                ),
            },
        }
    }

    #[test]
    fn emits_generated_header_and_future_annotations() {
        let out = emit_pyi_py(&empty_ir()).unwrap();
        assert!(out.starts_with("# @generated by dto-gen (--py-stub-out) — do not edit."));
        assert!(out.contains("from __future__ import annotations"));
        assert!(!out.contains("Any"));
        assert!(!out.contains("__getattr__"));
    }

    #[test]
    fn emits_async_and_blocking_twins_with_docstrings() {
        let mut ir = empty_ir();
        ir.entry_points
            .insert("checkLimits".into(), check_limits_ep());
        let out = emit_pyi_py(&ir).unwrap();
        assert!(out.contains("async def check_limits(self, args_json: str) -> str:"));
        assert!(out.contains("def check_limits_blocking(self, args_json: str) -> str:"));
        assert!(out.contains(
            "Check remaining usage/spend limits for a customer against a product's plan."
        ));
        assert!(out.contains("@param params Limits request including customer and product refs."));
        assert!(
            out.contains("@returns Current remaining limits, optionally including plan details.")
        );
        assert!(!out.contains("Any"));
        assert!(!out.contains("__getattr__"));
    }

    #[test]
    fn wraps_pydoc_lines_within_ruff_e501_width() {
        let long = "@param params RPC method, Authorization header, auth mode, public origin, and optional verification overrides.";
        let indent_len = 8;
        let lines = wrap_pydoc_lines(long, indent_len);
        assert!(
            lines.len() > 1,
            "expected a wrap for a line longer than the ruff budget"
        );
        assert!(
            lines
                .iter()
                .all(|line| indent_len + line.len() <= PYDOC_WIDTH),
            "wrapped lines must stay within ruff E501 width: {lines:?}"
        );
    }

    #[test]
    fn every_catalogued_operation_method_has_nonempty_docstring() {
        let mut ir = empty_ir();
        ir.entry_points
            .insert("checkLimits".into(), check_limits_ep());
        let out = emit_pyi_py(&ir).unwrap();
        // Both twins carry a docstring opener immediately after the signature.
        assert!(
            out.contains("async def check_limits(self, args_json: str) -> str:\n        \"\"\"")
        );
        assert!(
            out.contains("def check_limits_blocking(self, args_json: str) -> str:\n        \"\"\"")
        );
    }

    #[test]
    fn full_catalog_operations_all_emit_docstrings() {
        use crate::lower_catalog::lower_catalog;
        use crate::manifest::Manifest;
        use std::fs;

        let paths = repo_paths::load().expect("repo-paths");
        let raw = fs::read_to_string(paths.contract_input("sdkManifest").unwrap()).unwrap();
        let manifest: Manifest = serde_norway::from_str(&raw).unwrap();
        let mut ir = empty_ir();
        lower_catalog(&mut ir, &manifest).unwrap();
        crate::check_doc_coverage(&ir).expect("IR doc coverage");
        let out = emit_pyi_py(&ir).unwrap();
        for ep in ir.entry_points.values() {
            if ep.section != IrEntrySection::Operation {
                continue;
            }
            let name = &ep.names.py;
            if ep.availability.py.contains(&IrSyncKind::Async) {
                let needle =
                    format!("async def {name}(self, args_json: str) -> str:\n        \"\"\"");
                assert!(out.contains(&needle), "missing docstring for async {name}");
            }
            if ep.availability.py.contains(&IrSyncKind::Sync) {
                let blocking = format!("{name}_blocking");
                let needle =
                    format!("def {blocking}(self, args_json: str) -> str:\n        \"\"\"");
                assert!(out.contains(&needle), "missing docstring for {blocking}");
            }
        }
    }

    #[test]
    fn py_type_ref_follows_section_5_6_table() {
        assert_eq!(py_type_ref(&IrTypeRef::String), "str");
        assert_eq!(py_type_ref(&IrTypeRef::I64), "int");
        assert_eq!(py_type_ref(&IrTypeRef::F64), "float");
        assert_eq!(py_type_ref(&IrTypeRef::Bool), "bool");
        assert_eq!(
            py_type_ref(&IrTypeRef::Vec(Box::new(IrTypeRef::String))),
            "list[str]"
        );
        assert_eq!(
            py_type_ref(&IrTypeRef::Map(Box::new(IrTypeRef::I64))),
            "dict[str, int]"
        );
        assert_eq!(
            py_type_ref(&IrTypeRef::Named("CheckLimitsRequest".into())),
            "str"
        );
    }
}
