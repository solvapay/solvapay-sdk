//! Emit `internal/boundary-asserts/src/asserts.generated.rs`.

use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrBindingArtifact, IrCoreFieldTy, IrCoreFn, IrCoreParam, IrCoreParamTy, IrCoreSerde,
};

/// Compile-time boundary backstop source.
pub fn emit_boundary_asserts(ir: &Ir) -> GenResult<String> {
    let mut sync_fns: Vec<&IrCoreFn> = ir
        .core_fns
        .values()
        .filter(|func| func.exported.is_some() && !func.is_async)
        .collect();
    sync_fns.sort_by_key(|func| func.core_path());

    let mut client_fns: Vec<&IrCoreFn> = ir
        .transport_fns
        .values()
        .filter(|func| {
            func.exported.is_some()
                && func.is_async
                && ir
                    .binding_symbols
                    .values()
                    .any(|sym| sym.core == func.binding_core() && sym.artifact == IrBindingArtifact::Client)
        })
        .collect();
    client_fns.sort_by_key(|func| func.core_path());

    let mut body = String::new();
    for func in sync_fns {
        if can_fn_pointer(func) {
            body.push_str(&emit_sync_coercion(func));
            body.push('\n');
        } else {
            body.push_str(&emit_named_asserts(ir, func));
        }
    }
    for func in &client_fns {
        body.push_str(&emit_named_asserts(ir, func));
        if let Some(sym) = ir.binding_symbols.values().find(|s| s.core == func.binding_core()) {
            if let Some(dto) = &sym.dto_type {
                if !dto.contains("Mcp") && !dto.contains("::") {
                    body.push_str(&format!("const _: () = assert_boundary::<{dto}>();\n"));
                }
            }
        }
    }

    Ok(format!(
        "{}{body}",
        generated_header(CommentStyle::LineSlash, "boundary-asserts-rs-out"),
    ))
}

fn can_fn_pointer(func: &IrCoreFn) -> bool {
    func.params.iter().all(|p| is_simple(&p.ty.ty) && !is_duration(&p.ty.ty))
        && is_simple(&func.return_ty.ty)
        && !is_duration(&func.return_ty.ty)
        && !stringy_return(&func.return_ty)
}

fn is_duration(ty: &IrCoreFieldTy) -> bool {
    matches!(ty, IrCoreFieldTy::Named(name) if name == "Duration")
}

fn stringy_return(ty: &IrCoreParamTy) -> bool {
    match &ty.ty {
        IrCoreFieldTy::String => true,
        IrCoreFieldTy::Result { ok, err } => {
            matches!(ok.as_ref(), IrCoreFieldTy::String)
                || matches!(err.as_ref(), IrCoreFieldTy::String)
        }
        _ => false,
    }
}

fn is_simple(ty: &IrCoreFieldTy) -> bool {
    match ty {
        IrCoreFieldTy::String
        | IrCoreFieldTy::Bool
        | IrCoreFieldTy::U16
        | IrCoreFieldTy::U32
        | IrCoreFieldTy::U64
        | IrCoreFieldTy::I64
        | IrCoreFieldTy::F64
        | IrCoreFieldTy::Value
        | IrCoreFieldTy::Unit
        | IrCoreFieldTy::Named(_) => true,
        IrCoreFieldTy::Result { ok, err } => is_simple(ok) && is_simple(err),
        _ => false,
    }
}

fn emit_sync_coercion(func: &IrCoreFn) -> String {
    let params = func
        .params
        .iter()
        .map(rust_param)
        .collect::<Vec<_>>()
        .join(", ");
    let ret = rust_return(&func.return_ty);
    let path = rust_path(func);
    format!("const _: fn({params}) -> {ret} = {path};")
}

fn emit_named_asserts(ir: &Ir, func: &IrCoreFn) -> String {
    let mut types = Vec::new();
    for param in &func.params {
        collect_named(ir, &param.ty.ty, &mut types);
    }
    collect_named(ir, &func.return_ty.ty, &mut types);
    types.sort();
    types.dedup();
    let mut out = String::new();
    for ty in types {
        out.push_str(&format!("const _: () = assert_boundary::<{ty}>();\n"));
    }
    out
}

fn collect_named(ir: &Ir, ty: &IrCoreFieldTy, out: &mut Vec<String>) {
    match ty {
        IrCoreFieldTy::Named(name)
            if assertable_named(ir, name) && !name.contains("Mcp") && !name.contains("::") =>
        {
            out.push(name.clone())
        }
        IrCoreFieldTy::Vec(inner) | IrCoreFieldTy::Map(inner) => collect_named(ir, inner, out),
        IrCoreFieldTy::Tuple(elems) => {
            for elem in elems {
                collect_named(ir, elem, out);
            }
        }
        IrCoreFieldTy::Result { ok, err } => {
            collect_named(ir, ok, out);
            collect_named(ir, err, out);
        }
        _ => {}
    }
}

fn assertable_named(ir: &Ir, name: &str) -> bool {
    ir.core_types
        .get(name)
        .is_some_and(|ty| ty.serde == IrCoreSerde::Both)
}

fn rust_path(func: &IrCoreFn) -> String {
    func.binding_core()
}

fn rust_param(param: &IrCoreParam) -> String {
    let inner = rust_inner(&param.ty.ty, param.by_ref);
    if param.ty.optional {
        if param.by_ref {
            format!("Option<&{inner}>")
        } else {
            format!("Option<{inner}>")
        }
    } else if param.by_ref {
        format!("&{inner}")
    } else {
        inner
    }
}

fn rust_return(ty: &IrCoreParamTy) -> String {
    let inner = rust_inner(&ty.ty, false);
    if ty.optional {
        format!("Option<{inner}>")
    } else {
        inner
    }
}

fn rust_inner(ty: &IrCoreFieldTy, prefer_str: bool) -> String {
    match ty {
        IrCoreFieldTy::String if prefer_str => "str".into(),
        IrCoreFieldTy::String => "String".into(),
        IrCoreFieldTy::Bool => "bool".into(),
        IrCoreFieldTy::U16 => "u16".into(),
        IrCoreFieldTy::U32 => "u32".into(),
        IrCoreFieldTy::U64 => "u64".into(),
        IrCoreFieldTy::I64 => "i64".into(),
        IrCoreFieldTy::F64 => "f64".into(),
        IrCoreFieldTy::Value => "Value".into(),
        IrCoreFieldTy::Unit => "()".into(),
        IrCoreFieldTy::Named(name) => name.clone(),
        IrCoreFieldTy::Vec(inner) => format!("Vec<{}>", rust_inner(inner, false)),
        IrCoreFieldTy::Map(inner) => format!(
            "std::collections::BTreeMap<String, {}>",
            rust_inner(inner, false)
        ),
        IrCoreFieldTy::Tuple(elems) => {
            let parts = elems
                .iter()
                .map(|e| rust_inner(e, false))
                .collect::<Vec<_>>()
                .join(", ");
            format!("({parts})")
        }
        IrCoreFieldTy::Result { ok, err } => {
            format!(
                "Result<{}, {}>",
                rust_inner(ok, false),
                rust_inner(err, false)
            )
        }
    }
}
