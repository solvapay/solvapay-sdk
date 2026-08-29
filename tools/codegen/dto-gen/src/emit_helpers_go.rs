//! Emit `helpers_generated.go` portable helper forwarders.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use crate::emit_client_go::{render_godoc, uncapitalize};
use crate::emit_helpers::{catalog_helper_bindings, is_constant_entry};
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArg, IrBindingSymbol};

/// Emits `sdks/go/helpers_generated.go`.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a derived wasm export is missing from the
/// Go shim census.
pub fn emit_helpers_go(ir: &Ir) -> GenResult<String> {
    let census = go_export_census(ir);
    let mut out = format!("{}\n", generated_header(CommentStyle::Go, "go-helpers-out"));
    out.push_str(
        "package solvapay\n\n\
         import (\n\
         \t\"context\"\n\n\
         \t\"github.com/solvapay/solvapay-go/internal/nativecall\"\n\
         )\n\n",
    );
    for (binding, entry) in catalog_helper_bindings(ir) {
        if !entry.emission.go.is_generated() {
            continue;
        }
        let export = format!("sv_{}", binding.rust_fn_name);
        if !census.contains(&export) {
            return Err(GenError::Parse(format!(
                "{}: derived wasm export {export} is absent from the Go shim census",
                entry.id
            )));
        }
        let go_name = &entry.names.go;
        for line in render_godoc(entry, go_name) {
            if line.is_empty() {
                out.push_str("//\n");
            } else {
                let _ = writeln!(out, "// {line}");
            }
        }
        if is_constant_entry(entry) {
            let _ = writeln!(
                out,
                "func {go_name}(ctx context.Context) (any, error) {{\n\
                 \treturn nativecall.CallSync(ctx, {export:?}, \"{{}}\")\n\
                 }}\n"
            );
            continue;
        }
        let public_args: Vec<&IrBindingArg> =
            binding.args.iter().filter(|a| !a.host_injected).collect();
        let params = public_args
            .iter()
            .map(|arg| format!("{} any", uncapitalize(&arg.name)))
            .collect::<Vec<_>>();
        let param_list = if params.is_empty() {
            "ctx context.Context".to_string()
        } else {
            format!("ctx context.Context, {}", params.join(", "))
        };
        let _ = writeln!(out, "func {go_name}({param_list}) (any, error) {{");
        out.push_str("\treturn nativecall.CallSync(ctx, ");
        let _ = write!(out, "{export:?}, mustJSON(map[string]any{{");
        if public_args.is_empty() {
            out.push_str("}))\n}\n\n");
            continue;
        }
        out.push('\n');
        for arg in &public_args {
            let local = uncapitalize(&arg.name);
            let _ = writeln!(out, "\t\t{:?}: {local},", arg.name);
        }
        out.push_str("\t}))\n}\n\n");
    }
    Ok(out)
}

fn go_export_census(ir: &Ir) -> BTreeSet<String> {
    ir.binding_symbols
        .values()
        .map(|sym: &IrBindingSymbol| format!("sv_{}", sym.rust_fn_name))
        .collect()
}
