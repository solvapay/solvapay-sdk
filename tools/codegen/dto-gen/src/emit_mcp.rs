//! Generated MCP layer-2 / syncOp named wrappers (Phase 3).

use std::fmt::Write as _;

use crate::doc_render::render_entry_doc_lines;
use crate::emit_client_go::{render_godoc, uncapitalize};
use crate::emit_client_rs::render_rustdoc;
use crate::emit_pyi_py::{render_pydoc, write_pydoc_block};
use crate::error::{GenError, GenResult};
use crate::header::{generated_header, CommentStyle};
use crate::ir::{Ir, IrEntryPoint, IrEntrySection, IrMcpSurface, IrParam};

/// Catalogued MCP entries in stable id order.
pub(crate) fn mcp_entries(ir: &Ir) -> Vec<&IrEntryPoint> {
    let mut rows: Vec<&IrEntryPoint> = ir
        .entry_points
        .values()
        .filter(|entry| entry.section == IrEntrySection::Mcp)
        .collect();
    rows.sort_by(|left, right| left.id.cmp(&right.id));
    rows
}

fn is_layer2(entry: &IrEntryPoint) -> bool {
    matches!(entry.mcp_surface, Some(IrMcpSurface::Layer2))
}

fn is_engine(entry: &IrEntryPoint) -> bool {
    entry.feature.as_deref() == Some("engine")
}

/// `sdks/ruby-mcp/lib/solvapay/mcp/layer2.generated.rb`
pub fn emit_mcp_rb(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}# frozen_string_literal: true\n\n# rubocop:disable Naming/MethodName, Layout/LeadingCommentSpace, Layout/LineLength\n\n",
        generated_header(CommentStyle::Hash, "rb-mcp-layer2-out")
    );
    out.push_str(
        "require \"solvapay\"\n\
         require_relative \"core\"\n\n\
         module SolvaPay\n\
         \x20 module Mcp\n\
         \x20   module Layer2\n\
         \x20     class << self\n",
    );
    for entry in mcp_entries(ir) {
        if !entry.emission.rb.is_generated() {
            continue;
        }
        write_hash_doc(&mut out, entry, "        ", |p| p.names.rb.as_str());
        let sig = positional_sig(entry, |p| p.names.rb.as_str(), "nil");
        let _ = writeln!(out, "        def {}{sig}", entry.names.rb);
        emit_args_hash(&mut out, entry, "          ", |p| p.names.rb.as_str());
        if is_layer2(entry) {
            out.push_str("          as_object_map(SolvaPay::NativeDispatch.call_sync(");
            let _ = writeln!(out, "{:?}, call_args))", entry.names.py);
        } else {
            let _ = writeln!(
                out,
                "          SolvaPay::Mcp::Core.call({:?}, call_args)",
                entry.id
            );
        }
        out.push_str("        end\n\n");
    }
    out.push_str(
        "        def as_object_map(value)\n\
         \x20         return value if value.is_a?(Hash)\n\n\
         \x20         raise SolvaPay::SolvaPayError, \"native call returned unexpected value\"\n\
         \x20       end\n\
         \x20     end\n\
         \x20   end\n\
         \x20 end\n\
         end\n\
         # rubocop:enable Naming/MethodName, Layout/LeadingCommentSpace, Layout/LineLength\n",
    );
    Ok(out)
}

/// `sdks/python-mcp/python/solvapay_mcp/_layer2.generated.py`
pub fn emit_mcp_py(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::Hash, "py-mcp-layer2-out")
    );
    out.push_str(
        "\"\"\"Generated MCP named wrappers.\"\"\"\n\n\
         from __future__ import annotations\n\n\
         import json\n\n\
         from solvapay._native import call_native_sync\n\
         from solvapay_mcp.core import call as call_sync_op\n\n\n\
         def _as_object_map(value: object) -> dict[str, object]:\n\
         \x20   if not isinstance(value, dict):\n\
         \x20       raise TypeError(\"native call returned unexpected value\")\n\
         \x20   return {str(k): v for k, v in value.items()}\n\n",
    );
    for entry in mcp_entries(ir) {
        if !entry.emission.py.is_generated() {
            continue;
        }
        let params = entry
            .params
            .iter()
            .map(|p| {
                if p.required {
                    format!("{}: object", p.names.py)
                } else {
                    format!("{}: object | None = None", p.names.py)
                }
            })
            .collect::<Vec<_>>();
        let ret = if is_layer2(entry) {
            "dict[str, object]"
        } else {
            "object"
        };
        let _ = writeln!(
            out,
            "def {}({}) -> {ret}:",
            entry.names.py,
            params.join(", ")
        );
        write_pydoc_block(&mut out, &render_pydoc(entry), "    ");
        out.push_str("    call_args: dict[str, object] = {}\n");
        for param in &entry.params {
            let local = &param.names.py;
            if param.required {
                let _ = writeln!(out, "    call_args[{:?}] = {local}", param.name);
            } else {
                let _ = writeln!(
                    out,
                    "    if {local} is not None:\n        call_args[{:?}] = {local}",
                    param.name
                );
            }
        }
        if is_layer2(entry) {
            out.push_str("    return _as_object_map(call_native_sync(");
            let _ = writeln!(out, "{:?}, json.dumps(call_args)))\n", entry.names.py);
        } else {
            out.push_str("    return call_sync_op(");
            let _ = writeln!(out, "{:?}, call_args)\n", entry.id);
        }
    }
    Ok(out)
}

/// `sdks/go/mcp/layer2_generated.go`
pub fn emit_mcp_go(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::Go, "go-mcp-layer2-out")
    );
    out.push_str(
        "package mcp\n\n\
         import (\n\
         \t\"context\"\n\
         \t\"encoding/json\"\n\
         )\n\n",
    );
    for entry in mcp_entries(ir) {
        if !entry.emission.go.is_generated() {
            continue;
        }
        let go_name = &entry.names.go;
        for line in render_godoc(entry, go_name) {
            if line.is_empty() {
                out.push_str("//\n");
            } else {
                let _ = writeln!(out, "// {line}");
            }
        }
        let params = entry
            .params
            .iter()
            .map(|p| format!("{} any", uncapitalize(&p.names.go)))
            .collect::<Vec<_>>();
        let param_list = if params.is_empty() {
            "ctx context.Context".to_string()
        } else {
            format!("ctx context.Context, {}", params.join(", "))
        };
        let _ = writeln!(
            out,
            "func {go_name}({param_list}) (json.RawMessage, error) {{"
        );
        out.push_str("\tcall_args := map[string]any{}\n");
        for param in &entry.params {
            let local = uncapitalize(&param.names.go);
            if param.required {
                let _ = writeln!(out, "\tcall_args[{:?}] = {local}", param.name);
            } else {
                let _ = writeln!(
                    out,
                    "\tif {local} != nil {{\n\t\tcall_args[{:?}] = {local}\n\t}}",
                    param.name
                );
            }
        }
        if is_layer2(entry) {
            let export = layer2_wasm_export(ir, entry)?;
            let _ = writeln!(out, "\treturn callLayer2(ctx, {export:?}, call_args)\n}}\n");
        } else {
            let _ = writeln!(
                out,
                "\treturn CallSync(ctx, {:?}, call_args)\n}}\n",
                entry.id
            );
        }
    }
    Ok(out)
}

fn layer2_wasm_export(ir: &Ir, entry: &IrEntryPoint) -> GenResult<String> {
    let Some(binding) = ir
        .binding_symbols
        .values()
        .find(|sym| sym.names.ts == entry.names.ts || sym.id == entry.id)
    else {
        return Err(GenError::Parse(format!(
            "{}: no binding symbol for MCP layer-2 wasm export",
            entry.id
        )));
    };
    Ok(format!("sv_{}", binding.rust_fn_name))
}

/// `sdks/typescript/mcp-core/src/native-mcp.generated.ts`
pub fn emit_mcp_ts(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::LineSlash, "ts-mcp-native-out")
    );
    out.push_str("import { callMcpSyncOp, dispatchSync } from './native-mcp-dispatch'\n\n");
    for entry in mcp_entries(ir) {
        if !entry.emission.ts.is_generated() {
            continue;
        }
        let doc = render_entry_doc_lines(entry, |p| p.names.ts.as_str()).join("\n");
        out.push_str(&format_jsdoc(&doc));
        let params = entry
            .params
            .iter()
            .map(|p| {
                if p.required {
                    format!("{}: unknown", p.names.ts)
                } else {
                    format!("{}?: unknown", p.names.ts)
                }
            })
            .collect::<Vec<_>>();
        let _ = writeln!(
            out,
            "export function {}({}): unknown {{",
            ts_ident(&entry.names.ts),
            params.join(", ")
        );
        out.push_str("  const call_args: Record<string, unknown> = {}\n");
        for param in &entry.params {
            let local = &param.names.ts;
            if param.required {
                let _ = writeln!(out, "  call_args['{}'] = {local}", param.name);
            } else {
                let _ = writeln!(
                    out,
                    "  if ({local} !== undefined) call_args['{}'] = {local}",
                    param.name
                );
            }
        }
        if is_layer2(entry) {
            let _ = writeln!(
                out,
                "  return dispatchSync('{}', call_args)\n}}\n",
                entry.names.ts
            );
        } else {
            let _ = writeln!(
                out,
                "  return callMcpSyncOp('{}', call_args)\n}}\n",
                entry.id
            );
        }
    }
    Ok(out)
}

/// `sdks/rust-mcp/src/layer2_generated.rs`
pub fn emit_mcp_rs(ir: &Ir) -> GenResult<String> {
    let mut out = format!(
        "{}\n",
        generated_header(CommentStyle::LineSlash, "rs-mcp-layer2-out")
    );
    out.push_str(
        "//! Generated MCP named wrappers over `call_sync`.\n\
         #![allow(dead_code, unused_mut)]\n\n\
         use serde_json::Value;\n\n\
         use crate::core::call_sync;\n\n",
    );
    for entry in mcp_entries(ir) {
        if !entry.emission.rust.is_generated() {
            continue;
        }
        if is_engine(entry) {
            out.push_str("#[cfg(feature = \"engine\")]\n");
        }
        for line in render_rustdoc(entry) {
            if line.is_empty() {
                out.push_str("///\n");
            } else {
                let _ = writeln!(out, "/// {line}");
            }
        }
        let params = entry
            .params
            .iter()
            .map(|p| {
                if p.required {
                    format!("{}: Value", p.names.rust)
                } else {
                    format!("{}: Option<Value>", p.names.rust)
                }
            })
            .collect::<Vec<_>>();
        let _ = writeln!(
            out,
            "pub fn {}({}) -> Result<Value, String> {{",
            rust_ident(&entry.names.rust),
            params.join(", ")
        );
        out.push_str("    let mut call_args = serde_json::Map::new();\n");
        for param in &entry.params {
            let local = rust_ident(&param.names.rust);
            if param.required {
                let _ = writeln!(
                    out,
                    "    call_args.insert({:?}.to_owned(), {local});",
                    param.name
                );
            } else {
                let _ = writeln!(
                    out,
                    "    if let Some(value) = {local} {{\n        call_args.insert({:?}.to_owned(), value);\n    }}",
                    param.name
                );
            }
        }
        let _ = writeln!(
            out,
            "    call_sync({:?}, &Value::Object(call_args))\n}}\n",
            entry.id
        );
    }
    Ok(out)
}

fn rust_ident(name: &str) -> String {
    if name.chars().all(|c| c.is_ascii_uppercase() || c == '_') {
        name.to_ascii_lowercase()
    } else {
        name.to_owned()
    }
}

fn ts_ident(name: &str) -> String {
    name.to_owned()
}

fn positional_sig(entry: &IrEntryPoint, name: impl Fn(&IrParam) -> &str, optional: &str) -> String {
    if entry.params.is_empty() {
        return String::new();
    }
    let parts = entry
        .params
        .iter()
        .map(|p| {
            if p.required {
                name(p).to_owned()
            } else {
                format!("{} = {optional}", name(p))
            }
        })
        .collect::<Vec<_>>();
    format!("({})", parts.join(", "))
}

fn emit_args_hash(
    out: &mut String,
    entry: &IrEntryPoint,
    indent: &str,
    name: impl Fn(&IrParam) -> &str,
) {
    let _ = writeln!(out, "{indent}call_args = {{}} #: Hash[String, untyped]");
    for param in &entry.params {
        let local = name(param);
        if param.required {
            let _ = writeln!(out, "{indent}call_args[{:?}] = {local}", param.name);
        } else {
            let _ = writeln!(
                out,
                "{indent}call_args[{:?}] = {local} unless {local}.nil?",
                param.name
            );
        }
    }
}

fn write_hash_doc(
    out: &mut String,
    entry: &IrEntryPoint,
    indent: &str,
    lang: impl Fn(&IrParam) -> &str,
) {
    let raw = render_entry_doc_lines(entry, |p| lang(p));
    for line in raw {
        let line = if let Some(rest) = line.strip_prefix("@returns ") {
            format!("@return {rest}")
        } else {
            line
        };
        let _ = writeln!(out, "{indent}# {line}");
    }
}

fn format_jsdoc(body: &str) -> String {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return String::new();
    }
    if !trimmed.contains('\n') {
        return format!("/** {trimmed} */\n");
    }
    let mut out = String::from("/**\n");
    for line in trimmed.lines() {
        if line.is_empty() {
            out.push_str(" *\n");
        } else {
            out.push_str(" * ");
            out.push_str(line);
            out.push('\n');
        }
    }
    out.push_str(" */\n");
    out
}
