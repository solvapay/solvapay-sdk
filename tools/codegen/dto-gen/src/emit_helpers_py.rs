//! Emit `helpers.generated.py` portable helper forwarders.

use std::fmt::Write as _;

use crate::emit_helpers::{catalog_helper_bindings, is_constant_entry, snake};
use crate::emit_pyi_py::{render_pydoc, write_pydoc_block};
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrBindingArg, IrBoundaryType, IrEntryPoint};

/// Emits `sdks/python/python/solvapay/helpers.generated.py`.
///
/// # Errors
///
/// Returns formatting failures as [`crate::error::GenError`].
pub fn emit_helpers_py(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::Hash, "py-helpers-out")
    );
    out.push_str(
        "\"\"\"Generated portable helper forwarding.\"\"\"\n\n\
         from __future__ import annotations\n\n\
         import json\n\
         from typing import Any\n\n\
         from solvapay._native import call_native_sync\n\n",
    );
    let mut constants: Vec<(&str, &IrEntryPoint)> = Vec::new();
    for (binding, entry) in catalog_helper_bindings(ir) {
        if !entry.emission.py.is_generated() {
            continue;
        }
        if is_constant_entry(entry) {
            constants.push((binding.names.py.as_str(), entry));
            continue;
        }
        emit_py_fn(&mut out, entry, &binding.args, &binding.names.py);
    }
    if !constants.is_empty() {
        out.push_str("_CONSTANT_IDS = frozenset({\n");
        for (name, entry) in &constants {
            let _ = writeln!(out, "    # {}", entry.docs.summary.trim());
            let _ = writeln!(out, "    {name:?},");
        }
        out.push_str("})\n\n");
        out.push_str(
            "def __getattr__(name: str) -> Any:\n\
             \x20   \"\"\"Lazy constant loader so `import solvapay` does not require the extension.\"\"\"\n\
             \x20   if name not in _CONSTANT_IDS:\n\
             \x20       raise AttributeError(f\"module {__name__!r} has no attribute {name!r}\")\n\
             \x20   return call_native_sync(name, json.dumps({}))\n",
        );
    }
    Ok(out)
}

fn emit_py_fn(out: &mut String, entry: &IrEntryPoint, args: &[IrBindingArg], native_name: &str) {
    let public_args: Vec<&IrBindingArg> = args.iter().filter(|a| !a.host_injected).collect();
    let params = public_args
        .iter()
        .map(|arg| {
            let name = snake(&arg.name);
            let ty = py_arg_type(arg);
            if arg.required {
                format!("{name}: {ty}")
            } else {
                format!("{name}: {ty} | None = None")
            }
        })
        .collect::<Vec<_>>();
    let sig = params.join(", ");
    let _ = writeln!(out, "def {}({sig}) -> Any:", entry.names.py);
    write_pydoc_block(out, &render_pydoc(entry), "    ");
    out.push_str("    payload: dict[str, Any] = {}\n");
    for arg in &public_args {
        let name = snake(&arg.name);
        if arg.required {
            let _ = writeln!(out, "    payload[{:?}] = {name}", arg.name);
        } else {
            let _ = writeln!(
                out,
                "    if {name} is not None:\n        payload[{:?}] = {name}",
                arg.name
            );
        }
    }
    let _ = writeln!(
        out,
        "    return call_native_sync({native_name:?}, json.dumps(payload))\n"
    );
}

fn py_arg_type(arg: &IrBindingArg) -> &'static str {
    match arg.ty {
        IrBoundaryType::String | IrBoundaryType::StringOpt => "str",
        IrBoundaryType::Bool => "bool",
        IrBoundaryType::F64 | IrBoundaryType::F64Opt => "float",
        IrBoundaryType::I64 => "int",
        _ => "Any",
    }
}
