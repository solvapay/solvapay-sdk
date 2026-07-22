//! IR → Rust source for `solvapay-dto`.

use std::collections::BTreeSet;
use std::fmt::Write as _;

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrField, IrOneOf, IrOverlay, IrOverlayStruct, IrStringEnum, IrStruct, IrType, IrTypeRef,
    OneOfStrategy,
};
use crate::name::to_snake_case;

const GENERATED_HEADER: &str = "// @generated — do not edit. Regenerate with:\n\
//   cargo run -p dto-gen -- \\\n\
//     --snapshot ../contract/openapi/sdk-v1.snapshot.json \\\n\
//     --manifest ../contract/manifest/sdk-contract.yaml \\\n\
//     --out crates/solvapay-dto/src\n";

/// Emitted crate sources written under `--out`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmittedCrate {
    /// `lib.rs` contents.
    pub lib_rs: String,
    /// `schemas.rs` contents.
    pub schemas_rs: String,
    /// `routes.rs` contents.
    pub routes_rs: String,
    /// `overlays.rs` contents (SDK-only types).
    pub overlays_rs: String,
    /// `error_templates.rs` contents (frozen message templates).
    pub error_templates_rs: String,
}

/// Emits the source files for `solvapay-dto` from an IR.
///
/// # Errors
///
/// Returns [`GenError::Unsupported`] when an IR node cannot be rendered.
pub fn emit_crate(ir: &Ir) -> GenResult<EmittedCrate> {
    Ok(EmittedCrate {
        lib_rs: emit_lib(ir),
        schemas_rs: emit_schemas(ir)?,
        routes_rs: emit_routes(ir)?,
        overlays_rs: emit_overlays(ir)?,
        error_templates_rs: emit_error_templates(ir),
    })
}

fn emit_lib(ir: &Ir) -> String {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');
    out.push_str(
        "//! Generated SolvaPay wire DTOs from `contract/openapi/sdk-v1.snapshot.json`.\n",
    );
    out.push_str("//!\n");
    out.push_str("//! Do not hand-edit. Regenerate via `dto-gen`.\n\n");
    out.push_str("pub mod error_templates;\n");
    out.push_str("pub mod overlays;\n");
    out.push_str("pub mod routes;\n");
    out.push_str("pub mod schemas;\n\n");
    out.push_str("pub use overlays::*;\n");
    out.push_str(
        "pub use routes::{match_route, path_matches_template, roundtrip_response, RouteMatch};\n",
    );

    // Overlay names that also exist as OpenAPI schemas must not be glob-reexported
    // from both modules (ambiguous_glob_reexports). Overlay wins at the crate root;
    // the wire type remains available as `schemas::Name`.
    let shadowed: BTreeSet<&str> = ir
        .overlays
        .keys()
        .filter(|name| ir.types.contains_key(name.as_str()))
        .map(String::as_str)
        .collect();

    if shadowed.is_empty() {
        out.push_str("pub use schemas::*;\n");
    } else {
        for name in &shadowed {
            let _ = writeln!(
                out,
                "// `{name}`: crate root → overlays (wire: schemas::{name})"
            );
        }
        out.push_str("pub use schemas::{");
        let mut first = true;
        for name in ir.types.keys() {
            if shadowed.contains(name.as_str()) {
                continue;
            }
            if !first {
                out.push_str(", ");
            }
            first = false;
            out.push_str(name);
        }
        out.push_str("};\n");
    }
    out
}

/// Escapes a string as a Rust `&str` literal body (no surrounding quotes).
fn rust_str_literal(value: &str) -> String {
    let mut out = String::with_capacity(value.len() + 8);
    for ch in value.chars() {
        match ch {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c => out.push(c),
        }
    }
    out
}

/// Emits `error_templates.rs` from `ir.error_templates`.
fn emit_error_templates(ir: &Ir) -> String {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');
    out.push_str(
        "//! Frozen error message templates from `contract/manifest/sdk-contract.yaml`.\n\n",
    );

    out.push_str("/// Webhook verification messages keyed by stable code.\n");
    out.push_str("pub mod webhook {\n");
    for (code, message) in &ir.error_templates.webhook_messages {
        let const_name = to_snake_case(code).to_ascii_uppercase();
        let _ = writeln!(
            out,
            "    /// Frozen message for `{code}`.\n    pub const {const_name}: &str = \"{}\";",
            rust_str_literal(message)
        );
    }
    out.push_str("}\n\n");

    out.push_str("/// Paywall throw messages (`PaywallError` construction).\n");
    out.push_str("pub mod paywall {\n");
    for (kind, message) in &ir.error_templates.paywall_messages {
        let const_name = to_snake_case(kind).to_ascii_uppercase();
        let _ = writeln!(
            out,
            "    /// Frozen throw message for `{kind}`.\n    pub const {const_name}: &str = \"{}\";",
            rust_str_literal(message)
        );
    }
    out.push_str("}\n\n");

    out.push_str("/// MCP adapter-internal frozen messages (step 34).\n");
    out.push_str("pub mod mcp {\n");
    for (key, message) in &ir.error_templates.mcp_messages {
        let const_name = to_snake_case(key).to_ascii_uppercase();
        let _ = writeln!(
            out,
            "    /// Frozen message for `{key}`.\n    pub const {const_name}: &str = \"{}\";",
            rust_str_literal(message)
        );
    }
    out.push_str("}\n\n");

    out.push_str("/// Transport failure template (step 21).\n");
    out.push_str("pub mod transport {\n");
    let _ = writeln!(
        out,
        "    /// Default transport message template.\n    pub const MESSAGE_TEMPLATE: &str = \"{}\";",
        rust_str_literal(&ir.error_templates.transport_template)
    );
    out.push_str("}\n\n");

    out.push_str("/// All manifest client operation ids (camelCase, sorted).\n");
    out.push_str("pub const OPERATION_NAMES: &[&str] = &[\n");
    for op_id in ir.error_templates.operations.keys() {
        let _ = writeln!(out, "    \"{}\",", rust_str_literal(op_id));
    }
    out.push_str("];\n\n");

    out.push_str("/// Per-operation HTTP / validation message templates.\n");
    out.push_str("pub mod operations {\n");
    for (op_id, op) in &ir.error_templates.operations {
        let mod_name = to_snake_case(op_id);
        let _ = writeln!(out, "    /// Templates for `{op_id}`.");
        let _ = writeln!(out, "    pub mod {mod_name} {{");
        let _ = writeln!(
            out,
            "        /// Default failure template.\n        pub const DEFAULT: &str = \"{}\";",
            rust_str_literal(&op.default_template)
        );
        if !op.cases.is_empty() {
            out.push_str("        /// Status- / shape-specific case templates (manifest order).\n");
            out.push_str("        pub const CASES: &[&str] = &[\n");
            for case in &op.cases {
                let _ = writeln!(out, "            \"{}\",", rust_str_literal(case));
            }
            out.push_str("        ];\n");
        }
        out.push_str("    }\n");
    }
    out.push_str("}\n");

    out
}

fn emit_overlays(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');
    out.push_str("//! SDK-only overlay types from `contract/manifest/sdk-contract.yaml`.\n\n");
    out.push_str("use std::collections::BTreeMap;\n\n");
    out.push_str("use serde::{Deserialize, Serialize};\n");
    out.push_str("use serde_json::Value;\n\n");
    out.push_str("use crate::schemas;\n\n");

    // Overlay helpers (nested objects / projected arms) before the catalog types.
    for ty in ir.overlay_helpers.values() {
        match ty {
            IrType::Struct(st) => {
                emit_struct(&mut out, st)?;
                out.push('\n');
            }
            IrType::StringEnum(en) => {
                emit_string_enum(&mut out, en)?;
                out.push('\n');
            }
            IrType::OneOf(one) => {
                emit_oneof(&mut out, one)?;
                out.push('\n');
            }
        }
    }

    let order = overlay_emit_order(ir);
    for name in order {
        let Some(overlay) = ir.overlays.get(&name) else {
            continue;
        };
        match overlay {
            IrOverlay::Marker { .. } => {}
            IrOverlay::Unit { name, doc } => {
                write_doc(&mut out, doc);
                let rust_name = crate::name::rust_type_name(name);
                let _ = writeln!(out, "pub type {rust_name} = ();\n");
            }
            IrOverlay::Alias { name, target, doc } => {
                // Identity aliases already exist in schemas — skip to avoid glob collisions.
                if name == target {
                    continue;
                }
                write_doc(&mut out, doc);
                let target_path = type_path(ir, target);
                let _ = writeln!(out, "pub type {name} = {target_path};\n");
            }
            IrOverlay::VecAlias { name, item, doc } => {
                write_doc(&mut out, doc);
                let item_path = type_path(ir, item);
                let _ = writeln!(out, "pub type {name} = Vec<{item_path}>;\n");
            }
            IrOverlay::StringEnum(en) => {
                emit_string_enum(&mut out, en)?;
                out.push('\n');
            }
            IrOverlay::OneOf(one) => {
                emit_overlay_oneof(&mut out, ir, one)?;
                out.push('\n');
            }
            IrOverlay::Struct(st) => {
                emit_overlay_struct(&mut out, ir, st)?;
                out.push('\n');
            }
        }
    }
    Ok(out)
}

fn overlay_emit_order(ir: &Ir) -> Vec<String> {
    let mut pending: BTreeSet<String> = ir.overlays.keys().cloned().collect();
    let mut done = BTreeSet::new();
    let mut order = Vec::new();

    while !pending.is_empty() {
        let mut progressed = false;
        let candidates: Vec<String> = pending.iter().cloned().collect();
        for name in candidates {
            let deps = overlay_deps(ir, &name);
            if deps
                .iter()
                .all(|d| done.contains(d) || ir.types.contains_key(d))
            {
                pending.remove(&name);
                done.insert(name.clone());
                order.push(name);
                progressed = true;
            }
        }
        if !progressed {
            // Cycle or missing dep — emit remaining alphabetically.
            let mut rest: Vec<String> = pending.into_iter().collect();
            rest.sort();
            order.extend(rest);
            break;
        }
    }
    order
}

fn overlay_deps(ir: &Ir, name: &str) -> Vec<String> {
    let Some(overlay) = ir.overlays.get(name) else {
        return vec![];
    };
    match overlay {
        IrOverlay::Alias { target, .. } => vec![target.clone()],
        IrOverlay::VecAlias { item, .. } => vec![item.clone()],
        IrOverlay::Struct(st) => {
            let mut deps = Vec::new();
            if let Some(base) = &st.flatten_base {
                deps.push(base.clone());
            }
            for field in &st.fields {
                collect_named_refs(&field.ty, &mut deps);
            }
            deps
        }
        IrOverlay::OneOf(one) => {
            let mut deps = Vec::new();
            for variant in &one.variants {
                collect_named_refs(&variant.ty, &mut deps);
            }
            deps
        }
        IrOverlay::StringEnum(_) | IrOverlay::Unit { .. } | IrOverlay::Marker { .. } => vec![],
    }
}

fn collect_named_refs(ty: &IrTypeRef, out: &mut Vec<String>) {
    match ty {
        IrTypeRef::Named(n) => out.push(n.clone()),
        IrTypeRef::Vec(inner) | IrTypeRef::Map(inner) => collect_named_refs(inner, out),
        IrTypeRef::LiteralString(_)
        | IrTypeRef::String
        | IrTypeRef::I64
        | IrTypeRef::F64
        | IrTypeRef::Bool
        | IrTypeRef::Value => {}
    }
}

fn type_path(ir: &Ir, name: &str) -> String {
    if ir.overlays.contains_key(name) || ir.overlay_helpers.contains_key(name) {
        name.to_string()
    } else {
        format!("schemas::{name}")
    }
}

fn emit_overlay_struct(out: &mut String, ir: &Ir, st: &IrOverlayStruct) -> GenResult<()> {
    write_doc(out, &st.doc);
    out.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");
    let _ = writeln!(out, "pub struct {} {{", st.name);
    if let Some(base) = &st.flatten_base {
        let base_path = type_path(ir, base);
        out.push_str("    /// Flattened base DTO fields.\n");
        out.push_str("    #[serde(flatten)]\n");
        let _ = writeln!(out, "    pub base: {base_path},");
    }
    for field in &st.fields {
        emit_overlay_field(out, ir, field)?;
    }
    out.push_str("}\n");
    Ok(())
}

fn emit_overlay_field(out: &mut String, ir: &Ir, field: &IrField) -> GenResult<()> {
    write_doc_indented(out, &field.doc, "    ");
    let rust_ty = render_overlay_type_ref(ir, &field.ty);
    let ty_str = if field.required && !field.nullable {
        rust_ty
    } else {
        format!("Option<{rust_ty}>")
    };

    let _ = writeln!(
        out,
        "    #[serde(rename = \"{}\")]",
        escape_str(&field.wire_name)
    );
    if !field.required || field.nullable {
        out.push_str("    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n");
    }
    let _ = writeln!(out, "    pub {}: {},", field.rust_name, ty_str);
    Ok(())
}

fn write_doc_indented(out: &mut String, doc: &str, indent: &str) {
    let trimmed = doc.trim();
    if trimmed.is_empty() {
        let _ = writeln!(out, "{indent}/// Overlay field.");
        return;
    }
    for line in trimmed.lines() {
        let _ = writeln!(out, "{indent}/// {line}");
    }
}

fn emit_overlay_oneof(out: &mut String, ir: &Ir, one: &IrOneOf) -> GenResult<()> {
    write_doc(out, &one.doc);
    out.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");
    out.push_str("#[serde(untagged)]\n");
    out.push_str("#[allow(clippy::large_enum_variant)]\n");
    let _ = writeln!(out, "pub enum {} {{", one.name);
    for variant in &one.variants {
        write_doc(out, &format!("Variant `{}`.", variant.rust_name));
        let _ = writeln!(
            out,
            "    {}({}),",
            variant.rust_name,
            render_overlay_type_ref(ir, &variant.ty)
        );
    }
    out.push_str("}\n");
    Ok(())
}

fn render_overlay_type_ref(ir: &Ir, ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::String | IrTypeRef::LiteralString(_) => "String".into(),
        IrTypeRef::I64 => "i64".into(),
        IrTypeRef::F64 => "f64".into(),
        IrTypeRef::Bool => "bool".into(),
        IrTypeRef::Value => "Value".into(),
        IrTypeRef::Vec(inner) => format!("Vec<{}>", render_overlay_type_ref(ir, inner)),
        IrTypeRef::Map(inner) => {
            if matches!(inner.as_ref(), IrTypeRef::Value) {
                "BTreeMap<String, Value>".into()
            } else {
                format!("BTreeMap<String, {}>", render_overlay_type_ref(ir, inner))
            }
        }
        IrTypeRef::Named(name) => type_path(ir, name),
    }
}

fn emit_schemas(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');
    out.push_str("//! Generated wire schemas.\n\n");
    out.push_str("use std::collections::BTreeMap;\n\n");
    out.push_str("use serde::{Deserialize, Serialize};\n");
    out.push_str("use serde_json::Value;\n\n");

    for ty in ir.types.values() {
        match ty {
            IrType::Struct(st) => emit_struct(&mut out, st)?,
            IrType::StringEnum(en) => emit_string_enum(&mut out, en)?,
            IrType::OneOf(one) => emit_oneof(&mut out, one)?,
        }
        out.push('\n');
    }
    Ok(out)
}

fn emit_struct(out: &mut String, st: &IrStruct) -> GenResult<()> {
    write_doc(out, &st.doc);
    out.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");
    let _ = writeln!(out, "pub struct {} {{", st.name);
    for field in &st.fields {
        emit_field(out, field)?;
    }
    out.push_str("}\n");
    Ok(())
}

fn emit_field(out: &mut String, field: &IrField) -> GenResult<()> {
    write_doc(out, &field.doc);
    let rust_ty = render_type_ref(&field.ty);
    // Wire DTOs accept sparse fixture / backend bodies: every field is Option.
    // OpenAPI `required` remains in the IR for later validation overlays (step 16+).
    // Nullable fields that are explicitly JSON null are preserved (no skip).
    let ty_str = format!("Option<{rust_ty}>");

    let _ = writeln!(
        out,
        "    #[serde(rename = \"{}\")]",
        escape_str(&field.wire_name)
    );

    // Omit absent fields. Explicit JSON null on nullable properties deserializes as
    // `None` and is omitted on re-serialize; the round-trip harness treats
    // absent ≡ null for equality (see solvapay-dto client_roundtrip test).
    out.push_str("    #[serde(default, skip_serializing_if = \"Option::is_none\")]\n");

    let _ = field.required;
    let _ = field.nullable;
    let _ = writeln!(out, "    pub {}: {},", field.rust_name, ty_str);
    Ok(())
}

fn emit_string_enum(out: &mut String, en: &IrStringEnum) -> GenResult<()> {
    write_doc(out, &en.doc);
    out.push_str("#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]\n");
    let _ = writeln!(out, "pub enum {} {{", en.name);
    for variant in &en.variants {
        let _ = writeln!(out, "    /// Wire value `{}`.", escape_str(&variant.wire));
        let _ = writeln!(
            out,
            "    #[serde(rename = \"{}\")]",
            escape_str(&variant.wire)
        );
        let _ = writeln!(out, "    {},", variant.rust_name);
    }
    out.push_str("}\n");
    Ok(())
}

fn emit_oneof(out: &mut String, one: &IrOneOf) -> GenResult<()> {
    write_doc(out, &one.doc);
    out.push_str("#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n");

    // All oneOf strategies emit `#[serde(untagged)]` of named payload structs.
    // Internally-tagged newtypes that still embed the discriminator field do not
    // round-trip with serde; untagged try-each preserves wire fidelity and is
    // required for ProcessPaymentResult's non-unique `status` discriminator.
    let _ = one.strategy;
    if one.strategy == OneOfStrategy::InternallyTagged && one.discriminator.is_none() {
        return Err(GenError::Unsupported {
            name: one.name.clone(),
            detail: "internally tagged oneOf missing discriminator".into(),
        });
    }

    out.push_str("#[serde(untagged)]\n");
    // Succeeded arms embed nested purchase info; size difference is expected.
    out.push_str("#[allow(clippy::large_enum_variant)]\n");
    let _ = writeln!(out, "pub enum {} {{", one.name);
    for variant in &one.variants {
        write_doc(out, &format!("Variant `{}`.", variant.rust_name));
        let _ = writeln!(
            out,
            "    {}({}),",
            variant.rust_name,
            render_type_ref(&variant.ty)
        );
    }
    out.push_str("}\n");
    Ok(())
}

fn emit_routes(ir: &Ir) -> GenResult<String> {
    let mut out = String::new();
    out.push_str(GENERATED_HEADER);
    out.push('\n');
    out.push_str("//! Route table and JSON round-trip helpers for generated DTOs.\n\n");
    out.push_str("use serde_json::Value;\n\n");
    out.push_str("use crate::schemas;\n\n");

    out.push_str("/// A matched OpenAPI route and its response body Rust type name.\n");
    out.push_str("#[derive(Debug, Clone, PartialEq, Eq)]\n");
    out.push_str("pub struct RouteMatch {\n");
    out.push_str("    /// Uppercase HTTP method.\n");
    out.push_str("    pub method: &'static str,\n");
    out.push_str("    /// Templated OpenAPI path.\n");
    out.push_str("    pub path_template: &'static str,\n");
    out.push_str("    /// OpenAPI operationId.\n");
    out.push_str("    pub operation_id: &'static str,\n");
    out.push_str("    /// Response DTO type key when a 2xx JSON schema exists.\n");
    out.push_str("    pub response_type: Option<&'static str>,\n");
    out.push_str("}\n\n");

    out.push_str("/// OpenAPI routes compiled from the snapshot (method + path template).\n");
    out.push_str("const ROUTES: &[RouteMatch] = &[\n");
    for route in &ir.routes {
        let response_type = route
            .response_body
            .as_ref()
            .map(type_ref_key)
            .map(|k| format!("Some(\"{k}\")"))
            .unwrap_or_else(|| "None".to_string());
        let _ = writeln!(
            out,
            "    RouteMatch {{ method: \"{}\", path_template: \"{}\", operation_id: \"{}\", response_type: {response_type} }},",
            escape_str(&route.method),
            escape_str(&route.path_template),
            escape_str(&route.operation_id),
        );
    }
    out.push_str("];\n\n");

    out.push_str("/// Returns true when `concrete` matches an OpenAPI path template.\n");
    out.push_str("///\n");
    out.push_str("/// `{param}` segments match any single path segment.\n");
    out.push_str("pub fn path_matches_template(template: &str, concrete: &str) -> bool {\n");
    out.push_str(
        "    let t: Vec<&str> = template.split('/').filter(|s| !s.is_empty()).collect();\n",
    );
    out.push_str(
        "    let c: Vec<&str> = concrete.split('/').filter(|s| !s.is_empty()).collect();\n",
    );
    out.push_str("    if t.len() != c.len() {\n");
    out.push_str("        return false;\n");
    out.push_str("    }\n");
    out.push_str("    t.iter().zip(c.iter()).all(|(tp, cp)| {\n");
    out.push_str("        (tp.starts_with('{') && tp.ends_with('}')) || *tp == *cp\n");
    out.push_str("    })\n");
    out.push_str("}\n\n");

    out.push_str("/// Looks up a route by method + concrete path.\n");
    out.push_str("pub fn match_route(method: &str, path: &str) -> Option<&'static RouteMatch> {\n");
    out.push_str("    let method = method.to_ascii_uppercase();\n");
    out.push_str("    ROUTES.iter().find(|route| {\n");
    out.push_str(
        "        route.method == method && path_matches_template(route.path_template, path)\n",
    );
    out.push_str("    })\n");
    out.push_str("}\n\n");

    out.push_str("/// Deserializes `body` into the route's response DTO and re-serializes it.\n");
    out.push_str("///\n");
    out.push_str("/// # Errors\n");
    out.push_str("///\n");
    out.push_str("/// Returns a string error when the route is unknown, has no response type,\n");
    out.push_str("/// or serde fails.\n");
    out.push_str(
        "pub fn roundtrip_response(method: &str, path: &str, body: &Value) -> Result<Value, String> {\n",
    );
    out.push_str("    let route = match_route(method, path).ok_or_else(|| {\n");
    out.push_str("        format!(\"no route for {method} {path}\")\n");
    out.push_str("    })?;\n");
    out.push_str("    let type_name = route.response_type.ok_or_else(|| {\n");
    out.push_str("        format!(\"route {} has no JSON response body\", route.operation_id)\n");
    out.push_str("    })?;\n");
    out.push_str("    roundtrip_by_type(type_name, body)\n");
    out.push_str("}\n\n");

    out.push_str("/// Deserializes and re-serializes `body` as the named generated DTO type.\n");
    out.push_str(
        "fn roundtrip_by_type(type_name: &str, body: &Value) -> Result<Value, String> {\n",
    );
    out.push_str("    match type_name {\n");
    out.push_str(&emit_roundtrip_arms(ir)?);
    out.push_str("    }\n");
    out.push_str("}\n");

    Ok(out)
}

fn emit_roundtrip_arms(ir: &Ir) -> GenResult<String> {
    let mut keys = BTreeSet::new();
    for route in &ir.routes {
        if let Some(ty) = &route.response_body {
            keys.insert(type_ref_key(ty));
        }
    }

    let mut out = String::new();
    for key in keys {
        if let Some(inner) = key.strip_prefix("Vec<").and_then(|s| s.strip_suffix('>')) {
            let _ = writeln!(
                out,
                "        \"{key}\" => {{\n            let parsed: Vec<schemas::{inner}> = serde_json::from_value(body.clone())\n                .map_err(|e| e.to_string())?;\n            serde_json::to_value(parsed).map_err(|e| e.to_string())\n        }}"
            );
        } else {
            let _ = writeln!(
                out,
                "        \"{key}\" => {{\n            let parsed: schemas::{key} = serde_json::from_value(body.clone())\n                .map_err(|e| e.to_string())?;\n            serde_json::to_value(parsed).map_err(|e| e.to_string())\n        }}"
            );
        }
    }
    out.push_str("        other => Err(format!(\"no round-trip arm for {other}\")),\n");
    Ok(out)
}

fn type_ref_key(ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::Named(n) => n.clone(),
        IrTypeRef::Vec(inner) => format!("Vec<{}>", type_ref_key(inner)),
        other => render_type_ref(other),
    }
}

fn render_type_ref(ty: &IrTypeRef) -> String {
    match ty {
        IrTypeRef::String | IrTypeRef::LiteralString(_) => "String".into(),
        IrTypeRef::I64 => "i64".into(),
        IrTypeRef::F64 => "f64".into(),
        IrTypeRef::Bool => "bool".into(),
        IrTypeRef::Value => "Value".into(),
        IrTypeRef::Vec(inner) => format!("Vec<{}>", render_type_ref(inner)),
        IrTypeRef::Map(inner) => {
            if matches!(inner.as_ref(), IrTypeRef::Value) {
                "BTreeMap<String, Value>".into()
            } else {
                format!("BTreeMap<String, {}>", render_type_ref(inner))
            }
        }
        IrTypeRef::Named(name) => name.clone(),
    }
}

fn write_doc(out: &mut String, doc: &str) {
    let trimmed = doc.trim();
    if trimmed.is_empty() {
        out.push_str("/// Generated wire DTO.\n");
        return;
    }
    for line in trimmed.lines() {
        let _ = writeln!(out, "/// {line}");
    }
}

fn escape_str(s: &str) -> String {
    s.replace('\\', "\\\\").replace('"', "\\\"")
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use crate::ir::{IrEnumVariant, IrOneOfVariant, IrRoute};
    use std::collections::BTreeMap;

    #[test]
    fn emits_process_payment_untagged_enum() {
        let mut types = BTreeMap::new();
        types.insert(
            "ProcessPaymentSucceededBare".into(),
            IrType::Struct(IrStruct {
                name: "ProcessPaymentSucceededBare".into(),
                doc: "Bare succeeded.".into(),
                fields: vec![IrField {
                    wire_name: "status".into(),
                    rust_name: "status".into(),
                    doc: "Status.".into(),
                    ty: IrTypeRef::Named("ProcessPaymentSucceededBareStatus".into()),
                    required: true,
                    nullable: false,
                }],
            }),
        );
        types.insert(
            "ProcessPaymentSucceededBareStatus".into(),
            IrType::StringEnum(IrStringEnum {
                name: "ProcessPaymentSucceededBareStatus".into(),
                doc: "status".into(),
                variants: vec![IrEnumVariant {
                    wire: "succeeded".into(),
                    rust_name: "Succeeded".into(),
                }],
            }),
        );
        types.insert(
            "ProcessPaymentResult".into(),
            IrType::OneOf(IrOneOf {
                name: "ProcessPaymentResult".into(),
                doc: "Process payment result.".into(),
                strategy: OneOfStrategy::ProcessPaymentResult,
                discriminator: Some("status".into()),
                variants: vec![IrOneOfVariant {
                    rust_name: "SucceededBare".into(),
                    tag_value: None,
                    ty: IrTypeRef::Named("ProcessPaymentSucceededBare".into()),
                }],
            }),
        );
        let ir = Ir {
            types,
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![IrRoute {
                method: "POST".into(),
                path_template: "/v1/sdk/payment-intents/{processorPaymentId}/process".into(),
                operation_id: "PaymentIntentSdkController_processPaymentIntent".into(),
                request_body: None,
                response_body: Some(IrTypeRef::Named("ProcessPaymentResult".into())),
            }],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
        };
        let emitted = emit_crate(&ir).expect("emit");
        assert!(emitted.schemas_rs.contains("#[serde(untagged)]"));
        assert!(emitted.schemas_rs.contains("pub enum ProcessPaymentResult"));
        assert!(emitted.schemas_rs.contains("// @generated"));
        assert!(emitted.routes_rs.contains("ProcessPaymentResult"));
        assert!(emitted.overlays_rs.contains("// @generated"));
        assert!(emitted.lib_rs.contains("pub mod overlays;"));
        assert!(emitted.lib_rs.contains("pub mod error_templates;"));
        assert!(emitted.lib_rs.contains("pub use schemas::*;"));
        assert!(emitted.error_templates_rs.contains("// @generated"));
        assert!(emitted
            .error_templates_rs
            .contains("pub const OPERATION_NAMES"));
    }

    #[test]
    fn lib_rs_excludes_schema_names_shadowed_by_overlays() {
        let mut types = BTreeMap::new();
        types.insert(
            "OneTimePurchaseInfo".into(),
            IrType::Struct(IrStruct {
                name: "OneTimePurchaseInfo".into(),
                doc: "wire".into(),
                fields: vec![],
            }),
        );
        types.insert(
            "OtherWire".into(),
            IrType::Struct(IrStruct {
                name: "OtherWire".into(),
                doc: "wire".into(),
                fields: vec![],
            }),
        );
        let mut overlays = BTreeMap::new();
        overlays.insert(
            "OneTimePurchaseInfo".into(),
            IrOverlay::Struct(IrOverlayStruct {
                name: "OneTimePurchaseInfo".into(),
                doc: "sdk".into(),
                flatten_base: None,
                partial_base: false,
                fields: vec![],
            }),
        );
        let ir = Ir {
            types,
            overlay_helpers: BTreeMap::new(),
            overlays,
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
        };
        let lib = emit_lib(&ir);
        assert!(lib.contains("crate root → overlays"));
        assert!(lib.contains("pub use schemas::{OtherWire};"));
        assert!(!lib.contains("pub use schemas::*;"));
        assert!(!lib.contains("schemas::{OneTimePurchaseInfo"));
        assert!(!lib.contains("OtherWire, OneTimePurchaseInfo"));
    }
}
