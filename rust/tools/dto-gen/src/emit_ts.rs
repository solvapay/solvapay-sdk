//! Emit TypeScript overlay declarations that import wire types from generated.ts.

use std::fmt::Write as _;

use crate::error::GenResult;
use crate::ir::{Ir, IrField, IrOverlay, IrOverlayStruct, IrType, IrTypeRef};
use crate::name::rust_type_name;

const GENERATED_HEADER: &str = "\
/**\n\
 * @generated — do not edit. Regenerate with:\n\
 *   cargo run -p dto-gen -- \\\n\
 *     --snapshot ../contract/openapi/sdk-v1.snapshot.json \\\n\
 *     --manifest ../contract/manifest/sdk-contract.yaml \\\n\
 *     --out crates/solvapay-dto/src \\\n\
 *     --ts-out packages/server/src/types/overlays.generated.d.ts\n\
 */\n\n";

/// Emits `overlays.generated.d.ts` contents.
///
/// # Errors
///
/// Returns formatting errors as [`GenError`] (none expected for string writes).
pub fn emit_overlays_ts(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push_str("import type { components, operations } from './generated'\n\n");

    for ty in ir.overlay_helpers.values() {
        match ty {
            IrType::Struct(st) => {
                write_ts_doc(&mut out, &st.doc);
                let _ = writeln!(out, "export type {} = {{", st.name);
                for field in &st.fields {
                    emit_ts_field(&mut out, ir, field);
                }
                out.push_str("}\n\n");
            }
            IrType::StringEnum(en) => {
                write_ts_doc(&mut out, &en.doc);
                let variants = en
                    .variants
                    .iter()
                    .map(|v| format!("'{}'", escape_ts(&v.wire)))
                    .collect::<Vec<_>>()
                    .join(" | ");
                let _ = writeln!(out, "export type {} = {variants}\n", en.name);
            }
            IrType::OneOf(_) => {}
        }
    }

    for overlay in ir.overlays.values() {
        match overlay {
            IrOverlay::Marker { .. } => {}
            IrOverlay::Unit { name, doc } => {
                write_ts_doc(&mut out, doc);
                let ts_name = rust_type_name(name);
                let _ = writeln!(out, "export type {ts_name} = void\n");
            }
            IrOverlay::Alias { name, target, doc } => {
                if name == target {
                    continue;
                }
                write_ts_doc(&mut out, doc);
                let _ = writeln!(out, "export type {name} = {}\n", ts_alias_target(target));
            }
            IrOverlay::VecAlias { name, item, doc } => {
                write_ts_doc(&mut out, doc);
                let item_ts = ts_named(ir, item);
                let _ = writeln!(out, "export type {name} = Array<{item_ts}>\n");
            }
            IrOverlay::StringEnum(en) => {
                write_ts_doc(&mut out, &en.doc);
                let variants = en
                    .variants
                    .iter()
                    .map(|v| format!("'{}'", escape_ts(&v.wire)))
                    .collect::<Vec<_>>()
                    .join(" | ");
                let _ = writeln!(out, "export type {} = {variants}\n", en.name);
            }
            IrOverlay::OneOf(one) => {
                write_ts_doc(&mut out, &one.doc);
                let mut arms = Vec::new();
                for variant in &one.variants {
                    arms.push(format!("| {}", ts_type_ref(ir, &variant.ty)));
                }
                let _ = writeln!(out, "export type {} =\n  {}\n", one.name, arms.join("\n  "));
            }
            IrOverlay::Struct(st) => {
                emit_ts_struct(&mut out, ir, st);
            }
        }
    }

    Ok(out)
}

/// Maps an alias target name to a TypeScript type expression.
pub(crate) fn ts_alias_target(target: &str) -> String {
    match target {
        "PaymentMethodResult" => {
            "operations['PaymentMethodSdkController_getPaymentMethod']['responses']['200']['content']['application/json']"
                .into()
        }
        other => format!("components['schemas']['{other}']"),
    }
}

fn emit_ts_struct(out: &mut String, ir: &Ir, st: &IrOverlayStruct) {
    write_ts_doc(out, &st.doc);
    if let Some(base) = &st.flatten_base {
        let base_ts = ts_named(ir, base);
        let base_ts = if st.partial_base {
            format!("Partial<{base_ts}>")
        } else {
            base_ts
        };
        let _ = writeln!(out, "export type {} = {base_ts} & {{", st.name);
    } else {
        let _ = writeln!(out, "export type {} = {{", st.name);
    }
    for field in &st.fields {
        emit_ts_field(out, ir, field);
    }
    out.push_str("}\n\n");
}

fn emit_ts_field(out: &mut String, ir: &Ir, field: &IrField) {
    write_ts_doc(out, &field.doc);
    let optional = if field.required { "" } else { "?" };
    let mut ty = ts_type_ref(ir, &field.ty);
    if field.nullable {
        ty = format!("{ty} | null");
    }
    let _ = writeln!(out, "  {}{optional}: {ty}", field.wire_name);
}

/// Resolves a named IR/overlay type to a TypeScript type expression.
pub(crate) fn ts_named(ir: &Ir, name: &str) -> String {
    if ir.overlays.contains_key(name) || ir.overlay_helpers.contains_key(name) {
        name.to_string()
    } else {
        format!("components['schemas']['{name}']")
    }
}

/// Maps an [`IrTypeRef`] to a TypeScript type expression.
pub(crate) fn ts_type_ref(ir: &Ir, ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::String => "string".into(),
        IrTypeRef::I64 | IrTypeRef::F64 => "number".into(),
        IrTypeRef::Bool => "boolean".into(),
        IrTypeRef::Value => "unknown".into(),
        IrTypeRef::Vec(inner) => format!("Array<{}>", ts_type_ref(ir, inner)),
        IrTypeRef::Map(inner) => format!("Record<string, {}>", ts_type_ref(ir, inner)),
        IrTypeRef::Named(name) => ts_named(ir, name),
        IrTypeRef::LiteralString(s) => {
            format!("'{}'", s.replace('\\', "\\\\").replace('\'', "\\'"))
        }
    }
}

/// Writes a TSDoc block when `doc` is non-empty.
pub(crate) fn write_ts_doc(out: &mut String, doc: &str) {
    let trimmed = doc.trim();
    if trimmed.is_empty() {
        return;
    }
    out.push_str("/**\n");
    for line in trimmed.lines() {
        let _ = writeln!(out, " * {line}");
    }
    out.push_str(" */\n");
}

fn escape_ts(s: &str) -> String {
    s.replace('\\', "\\\\").replace('\'', "\\'")
}
