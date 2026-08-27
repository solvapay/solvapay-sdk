//! Emit `packages/core/src/types/boundary.generated.d.ts` from `Ir.core_types`.

use std::fmt::Write as _;

use crate::emit_ts::{escape_ts, write_ts_doc};
use crate::error::GenResult;
use crate::header::{generated_header, CommentStyle};
use crate::ir::{
    Ir, IrCoreField, IrCoreFieldTy, IrCoreShape, IrCoreTsAlias, IrCoreType, IrCoreTypesTs,
};

/// Emits the consolidated TypeScript boundary-type declarations.
///
/// # Errors
///
/// Returns formatting errors as [`crate::error::GenError`] (none expected for
/// string writes) or [`crate::error::GenError::Parse`] when an overlay names a
/// missing Rust type.
pub fn emit_core_types_ts(ir: &Ir) -> GenResult<String> {
    let overlay = &ir.core_types_ts;
    let mut out = String::new();
    out.push_str(&generated_header(CommentStyle::Block, "core-types-ts-out"));
    out.push('\n');
    out.push_str(
        "import type { SupportedBusinessCountry, TaxIdType } from '../business-details'\n\n",
    );

    for (rust_name, ty) in &ir.core_types {
        if overlay.omit.contains(rust_name) {
            continue;
        }
        let ts_name = overlay
            .rename
            .get(rust_name)
            .cloned()
            .unwrap_or_else(|| rust_name.clone());
        if overlay.reshape.contains_key(&ts_name) {
            continue;
        }
        write_core_type(&mut out, ty, &ts_name, overlay);
    }

    // `BoundaryTypesTsDef` uses `BTreeMap`, so iteration is already key-sorted.
    for (name, rhs) in &overlay.reshape {
        write_verbatim_type(&mut out, name, rhs);
    }

    for (name, alias) in &overlay.aliases {
        write_alias(&mut out, ir, name, alias)?;
    }

    for (name, rhs) in &overlay.extra {
        write_verbatim_type(&mut out, name, rhs);
    }

    while out.ends_with("\n\n") {
        out.pop();
    }
    if !out.ends_with('\n') {
        out.push('\n');
    }
    Ok(out)
}

fn write_verbatim_type(out: &mut String, name: &str, rhs: &str) {
    let rhs = rhs.trim().trim_end_matches(';').trim();
    let (generics, body) = split_generics_rhs(rhs);
    let body = body.trim().trim_end_matches(';').trim();
    if body.starts_with('{') {
        write_object_alias(out, name, &generics, body);
        return;
    }
    if body.contains('\n') || body.trim_start().starts_with('|') {
        let _ = writeln!(out, "export type {name}{generics} =");
        let lines: Vec<&str> = body
            .lines()
            .filter(|line| !line.trim().is_empty())
            .collect();
        let pipe_indent = lines
            .iter()
            .find_map(|line| {
                let t = line.trim_start();
                t.starts_with('|').then_some(line.len() - t.len())
            })
            .unwrap_or(0);
        for line in lines {
            let indent = line.len() - line.trim_start().len();
            let t = line.trim_start();
            if t.starts_with('|') {
                let _ = writeln!(out, "  {t}");
            } else {
                let extra = indent.saturating_sub(pipe_indent);
                let _ = writeln!(out, "  {}{t}", " ".repeat(extra));
            }
        }
        out.push('\n');
        return;
    }
    let _ = writeln!(out, "export type {name}{generics} = {body}\n");
}

fn write_object_alias(out: &mut String, name: &str, generics: &str, body: &str) {
    let inner = body
        .trim()
        .trim_start_matches('{')
        .trim_end()
        .trim_end_matches('}')
        .trim_end();
    let lines: Vec<&str> = inner
        .lines()
        .filter(|line| !line.trim().is_empty())
        .collect();
    let min_indent = lines
        .iter()
        .map(|line| line.len() - line.trim_start().len())
        .min()
        .unwrap_or(0);
    let _ = writeln!(out, "export type {name}{generics} = {{");
    for line in lines {
        let dedented = line.get(min_indent..).unwrap_or(line.trim_start());
        let _ = writeln!(out, "  {dedented}");
    }
    out.push_str("}\n\n");
}

fn split_generics_rhs(rhs: &str) -> (String, String) {
    let trimmed = rhs.trim();
    if let Some(rest) = trimmed.strip_prefix('<') {
        let mut depth = 1i32;
        for (i, c) in rest.char_indices() {
            match c {
                '<' => depth += 1,
                '>' => {
                    depth -= 1;
                    if depth == 0 {
                        let generics = format!("<{}>", &rest[..i]);
                        let after = rest[i + 1..].trim_start();
                        let after = after.strip_prefix('=').unwrap_or(after).trim();
                        return (generics, after.to_owned());
                    }
                }
                _ => {}
            }
        }
    }
    (String::new(), trimmed.to_owned())
}

fn write_alias(out: &mut String, ir: &Ir, name: &str, alias: &IrCoreTsAlias) -> GenResult<()> {
    let source = ir.core_types.get(&alias.of).ok_or_else(|| {
        crate::error::GenError::Parse(format!(
            "boundaryTypesTs alias {name} references unknown type {}",
            alias.of
        ))
    })?;
    match &source.shape {
        IrCoreShape::Struct { fields, .. } => {
            let kept: Vec<_> = fields
                .iter()
                .filter(|f| !alias.omit_fields.contains(&f.wire_name))
                .collect();
            let _ = writeln!(out, "export type {name} = {{");
            for field in kept {
                write_field(out, field, &ir.core_types_ts);
            }
            out.push_str("}\n\n");
        }
        _ => {
            return Err(crate::error::GenError::Parse(format!(
                "boundaryTypesTs alias {name} of {} is not a struct",
                alias.of
            )));
        }
    }
    Ok(())
}

fn write_core_type(out: &mut String, ty: &IrCoreType, ts_name: &str, overlay: &IrCoreTypesTs) {
    write_ts_doc(out, &ty.rustdoc, "");
    match &ty.shape {
        IrCoreShape::Struct { fields, .. } => {
            let _ = writeln!(out, "export type {ts_name} = {{");
            for field in fields {
                write_field(out, field, overlay);
            }
            out.push_str("}\n\n");
        }
        IrCoreShape::UnitEnum { variants, .. } => {
            let members = variants
                .iter()
                .map(|v| format!("'{}'", escape_ts(&v.wire_name)))
                .collect::<Vec<_>>()
                .join(" | ");
            let _ = writeln!(out, "export type {ts_name} = {members}\n");
        }
        IrCoreShape::TaggedEnum { tag, variants, .. } => {
            let mut arms = Vec::new();
            for variant in variants {
                let mut parts = vec![format!("{tag}: '{}'", escape_ts(&variant.wire_name))];
                for field in &variant.fields {
                    let (opt, ts_ty) = field_ts(field, overlay);
                    parts.push(format!("{}{opt}: {ts_ty}", field.wire_name));
                }
                arms.push(format!("  | {{ {} }}", parts.join("; ")));
            }
            let _ = writeln!(out, "export type {ts_name} =\n{}\n", arms.join("\n"));
        }
        IrCoreShape::UntaggedEnum { variants, .. } => {
            let mut arms = Vec::new();
            for variant in variants {
                let mut parts = Vec::new();
                for field in &variant.fields {
                    let (opt, ts_ty) = field_ts(field, overlay);
                    let ts_ty = literal_success(&variant.rust_name, &field.rust_name, &ts_ty);
                    parts.push(format!("{}{opt}: {ts_ty}", field.wire_name));
                }
                arms.push(format!("  | {{ {} }}", parts.join("; ")));
            }
            let _ = writeln!(out, "export type {ts_name} =\n{}\n", arms.join("\n"));
        }
    }
}

fn literal_success(variant: &str, field: &str, ts_ty: &str) -> String {
    if field != "success" || ts_ty != "boolean" {
        return ts_ty.to_owned();
    }
    match variant {
        "Success" => "true".into(),
        "Failure" => "false".into(),
        _ => ts_ty.to_owned(),
    }
}

fn write_field(out: &mut String, field: &IrCoreField, overlay: &IrCoreTypesTs) {
    write_ts_doc(out, &field.rustdoc, "  ");
    let (opt, ts_ty) = field_ts(field, overlay);
    let _ = writeln!(out, "  {}{opt}: {ts_ty}", field.wire_name);
}

fn field_ts(field: &IrCoreField, overlay: &IrCoreTypesTs) -> (&'static str, String) {
    let ts_ty = map_ty(&field.ty, overlay);
    if !field.optional {
        return ("", ts_ty);
    }
    if field.skip_serializing_if.is_some() || field.serde_default {
        ("?", ts_ty)
    } else {
        ("", format!("{ts_ty} | null"))
    }
}

fn map_ty(ty: &IrCoreFieldTy, overlay: &IrCoreTypesTs) -> String {
    match ty {
        IrCoreFieldTy::String => "string".into(),
        IrCoreFieldTy::Bool => "boolean".into(),
        IrCoreFieldTy::U16
        | IrCoreFieldTy::U32
        | IrCoreFieldTy::U64
        | IrCoreFieldTy::I64
        | IrCoreFieldTy::F64 => "number".into(),
        IrCoreFieldTy::Value => "unknown".into(),
        IrCoreFieldTy::Unit => "void".into(),
        IrCoreFieldTy::Tuple(elems) => {
            let inner = elems
                .iter()
                .map(|elem| map_ty(elem, overlay))
                .collect::<Vec<_>>()
                .join(", ");
            format!("[{inner}]")
        }
        IrCoreFieldTy::Vec(inner) => format!("{}[]", map_ty(inner, overlay)),
        IrCoreFieldTy::Map(inner) => format!("Record<string, {}>", map_ty(inner, overlay)),
        IrCoreFieldTy::Named(name) => {
            if overlay.omit.contains(name) {
                "unknown".into()
            } else if let Some(renamed) = overlay.rename.get(name) {
                renamed.clone()
            } else {
                name.clone()
            }
        }
        IrCoreFieldTy::Result { .. } => "unknown".into(),
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
    use crate::ir::{IrCoreSerde, IrCoreVariant};

    #[test]
    fn unit_enum_emits_string_union() {
        let ty = IrCoreType {
            name: "LookupErrorKind".into(),
            module: "customer_sync".into(),
            rustdoc: String::new(),
            serde: IrCoreSerde::Both,
            cfg_feature: None,
            shape: IrCoreShape::UnitEnum {
                rename_all: Some("camelCase".into()),
                variants: vec![
                    IrCoreVariant {
                        rust_name: "ExpectedMissing".into(),
                        wire_name: "expectedMissing".into(),
                        rustdoc: String::new(),
                        fields: vec![],
                        cfg_feature: None,
                    },
                    IrCoreVariant {
                        rust_name: "Unexpected".into(),
                        wire_name: "unexpected".into(),
                        rustdoc: String::new(),
                        fields: vec![],
                        cfg_feature: None,
                    },
                ],
            },
        };
        let mut ir = Ir::default();
        ir.core_types.insert(ty.name.clone(), ty);
        let out = emit_core_types_ts(&ir).unwrap();
        assert!(out.contains("export type LookupErrorKind = 'expectedMissing' | 'unexpected'"));
    }
}
