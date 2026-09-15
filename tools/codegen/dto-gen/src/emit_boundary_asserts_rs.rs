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
                && ir.binding_symbols.values().any(|sym| {
                    sym.core == func.binding_core() && sym.artifact == IrBindingArtifact::Client
                })
        })
        .collect();
    client_fns.sort_by_key(|func| func.core_path());

    let mut body = String::new();
    for func in sync_fns {
        body.push_str(&emit_sync_coercion(func));
        body.push('\n');
    }

    let mut client_types = Vec::new();
    for func in &client_fns {
        collect_named(ir, &func.return_ty.ty, &mut client_types);
        for param in &func.params {
            collect_named(ir, &param.ty.ty, &mut client_types);
        }
        if let Some(sym) = ir
            .binding_symbols
            .values()
            .find(|s| s.core == func.binding_core())
        {
            if let Some(dto) = &sym.dto_type {
                if assertable_named(ir, dto) {
                    client_types.push(dto.clone());
                }
            }
        }
    }
    client_types.sort();
    client_types.dedup();
    for ty in client_types {
        body.push_str(&format!("const _: () = assert_boundary::<{ty}>();\n"));
    }

    Ok(format!(
        "{}{body}",
        generated_header(CommentStyle::LineSlash, "boundary-asserts-rs-out"),
    ))
}

fn emit_sync_coercion(func: &IrCoreFn) -> String {
    let mut params = Vec::new();
    if let Some(impl_ty) = &func.impl_ty {
        params.push(format!("&{impl_ty}"));
    }
    params.extend(func.params.iter().map(rust_param));
    let params = params.join(", ");
    let ret = rust_return(&func.return_ty);
    let path = func.binding_core();
    format!("const _: fn({params}) -> {ret} = {path};")
}

fn collect_named(ir: &Ir, ty: &IrCoreFieldTy, out: &mut Vec<String>) {
    match ty {
        IrCoreFieldTy::Named(name) if assertable_named(ir, name) => out.push(name.clone()),
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
    if name.contains("::") {
        return false;
    }
    ir.core_types
        .get(name)
        .is_some_and(|ty| ty.serde == IrCoreSerde::Both)
        || ir.types.contains_key(name)
}

fn rust_param(param: &IrCoreParam) -> String {
    let inner = rust_inner(&param.ty.ty, param.by_ref);
    if param.ty.optional {
        if param.by_ref {
            match &param.ty.ty {
                IrCoreFieldTy::Vec(item) => format!("Option<&[{}]>", rust_inner(item, false)),
                _ => format!("Option<&{inner}>"),
            }
        } else {
            format!("Option<{inner}>")
        }
    } else if param.by_ref {
        match &param.ty.ty {
            IrCoreFieldTy::Vec(item) => format!("&[{}]", rust_inner(item, false)),
            IrCoreFieldTy::String | IrCoreFieldTy::StaticStr => "&str".into(),
            _ => format!("&{inner}"),
        }
    } else {
        inner
    }
}

fn rust_return(ty: &IrCoreParamTy) -> String {
    if ty.by_ref {
        let rendered = match &ty.ty {
            IrCoreFieldTy::String | IrCoreFieldTy::StaticStr => "&'static str".into(),
            IrCoreFieldTy::Vec(inner) => format!("&'static [{}]", rust_slice_item(inner)),
            other => format!("&'static {}", rust_inner(other, false)),
        };
        if ty.optional {
            format!("Option<{rendered}>")
        } else {
            rendered
        }
    } else {
        let inner = rust_inner(&ty.ty, false);
        if ty.optional {
            format!("Option<{inner}>")
        } else {
            inner
        }
    }
}

fn rust_slice_item(ty: &IrCoreFieldTy) -> String {
    match ty {
        IrCoreFieldTy::String | IrCoreFieldTy::StaticStr => "&'static str".into(),
        IrCoreFieldTy::Tuple(elems) => {
            let parts = elems
                .iter()
                .map(rust_slice_item)
                .collect::<Vec<_>>()
                .join(", ");
            format!("({parts})")
        }
        other => rust_inner(other, false),
    }
}

fn rust_inner(ty: &IrCoreFieldTy, prefer_str: bool) -> String {
    match ty {
        IrCoreFieldTy::String | IrCoreFieldTy::StaticStr if prefer_str => "str".into(),
        IrCoreFieldTy::String => "String".into(),
        IrCoreFieldTy::StaticStr => "&'static str".into(),
        IrCoreFieldTy::Bool => "bool".into(),
        IrCoreFieldTy::U16 => "u16".into(),
        IrCoreFieldTy::U32 => "u32".into(),
        IrCoreFieldTy::U64 => "u64".into(),
        IrCoreFieldTy::I64 => "i64".into(),
        IrCoreFieldTy::F64 => "f64".into(),
        IrCoreFieldTy::Value => "Value".into(),
        IrCoreFieldTy::Unit => "()".into(),
        IrCoreFieldTy::Named(name) if name == "Duration" => "std::time::Duration".into(),
        IrCoreFieldTy::Named(name) => name.clone(),
        IrCoreFieldTy::Vec(inner) => format!("Vec<{}>", rust_inner(inner, false)),
        IrCoreFieldTy::Map(inner) => format!("Map<String, {}>", rust_inner(inner, false)),
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
