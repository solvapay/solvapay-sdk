//! Lower manifest overlay definitions into IR overlay nodes.

use std::collections::{BTreeMap, BTreeSet};

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrEnumVariant, IrField, IrOneOf, IrOneOfVariant, IrOverlay, IrOverlayStruct, IrStringEnum,
    IrType, IrTypeRef, OneOfStrategy,
};
use crate::manifest::{FieldDef, Manifest, OverlayDef};
use crate::name::{rust_field_name, rust_type_name};

/// Merges manifest overlays into `ir.overlays` (and nested helper types into `ir.types` when needed).
///
/// # Errors
///
/// Returns [`GenError::Parse`] / [`GenError::UnknownRef`] when an overlay cannot be lowered.
pub fn lower_overlays(ir: &mut Ir, manifest: &Manifest) -> GenResult<()> {
    // First pass: create stub entries for forward refs, then fill.
    let names: Vec<String> = manifest.overlays.keys().cloned().collect();
    for name in &names {
        let def = manifest
            .overlays
            .get(name)
            .ok_or_else(|| GenError::Parse(format!("missing overlay {name}")))?;
        let overlay = lower_one(ir, name, def, &manifest.overlays)?;
        ir.overlays.insert(name.clone(), overlay);
    }
    Ok(())
}

fn lower_one(
    ir: &mut Ir,
    name: &str,
    def: &OverlayDef,
    catalog: &BTreeMap<String, OverlayDef>,
) -> GenResult<IrOverlay> {
    match def {
        OverlayDef::ExtendDto {
            base,
            doc,
            partial,
            fields,
        } => {
            ensure_base_exists(ir, catalog, base)?;
            let extra = lower_fields(ir, name, fields)?;
            Ok(IrOverlay::Struct(IrOverlayStruct {
                name: name.to_string(),
                doc: doc
                    .clone()
                    .unwrap_or_else(|| format!("SDK overlay extending `{base}`.")),
                flatten_base: Some(base.clone()),
                partial_base: *partial,
                fields: extra,
            }))
        }
        OverlayDef::MapDto {
            base,
            doc,
            renames,
            fields,
        } => {
            if let Some(base) = base {
                ensure_base_exists(ir, catalog, base)?;
            }
            let mut mapped = lower_fields(ir, name, fields)?;
            // Annotate renamed fields in docs when present.
            if !renames.is_empty() {
                for field in &mut mapped {
                    for (wire, sdk) in renames {
                        if field.wire_name == *sdk {
                            let note = format!("Mapped from wire `{wire}`.");
                            if field.doc.is_empty() {
                                field.doc = note;
                            } else if !field.doc.contains(&note) {
                                field.doc = format!("{} {note}", field.doc);
                            }
                        }
                    }
                }
            }
            Ok(IrOverlay::Struct(IrOverlayStruct {
                name: name.to_string(),
                doc: doc
                    .clone()
                    .unwrap_or_else(|| "SDK mapped response overlay.".into()),
                flatten_base: None,
                partial_base: false,
                fields: mapped,
            }))
        }
        OverlayDef::ProjectUnion {
            base,
            doc,
            drop_variants,
            succeeded_fields,
        } => lower_project_union(
            ir,
            name,
            base,
            doc.as_deref(),
            drop_variants,
            succeeded_fields,
        ),
        OverlayDef::Synthetic {
            doc,
            unit,
            marker,
            alias_of,
            array_of,
            enum_variants,
            fields,
        } => {
            let doc = doc.clone().unwrap_or_default();
            if *unit {
                return Ok(IrOverlay::Unit {
                    name: name.to_string(),
                    doc: if doc.is_empty() {
                        "Void / unit sentinel.".into()
                    } else {
                        doc
                    },
                });
            }
            if *marker {
                return Ok(IrOverlay::Marker {
                    name: name.to_string(),
                    doc: if doc.is_empty() {
                        "Catalog-only overlay marker.".into()
                    } else {
                        doc
                    },
                });
            }
            if let Some(target) = alias_of {
                ensure_base_exists(ir, catalog, target)?;
                return Ok(IrOverlay::Alias {
                    name: name.to_string(),
                    target: target.clone(),
                    doc: if doc.is_empty() {
                        format!("Alias of `{target}`.")
                    } else {
                        doc
                    },
                });
            }
            if let Some(item) = array_of {
                ensure_base_exists(ir, catalog, item)?;
                return Ok(IrOverlay::VecAlias {
                    name: name.to_string(),
                    item: item.clone(),
                    doc: if doc.is_empty() {
                        format!("List of `{item}`.")
                    } else {
                        doc
                    },
                });
            }
            if let Some(variants) = enum_variants {
                let mut enum_vars: Vec<IrEnumVariant> = variants
                    .iter()
                    .map(|wire| IrEnumVariant {
                        wire: wire.clone(),
                        rust_name: rust_type_name(wire),
                    })
                    .collect();
                enum_vars.sort_by(|a, b| a.wire.cmp(&b.wire));
                return Ok(IrOverlay::StringEnum(IrStringEnum {
                    name: name.to_string(),
                    doc: if doc.is_empty() {
                        format!("SDK enum `{name}`.")
                    } else {
                        doc
                    },
                    variants: enum_vars,
                }));
            }
            if !fields.is_empty() {
                let lowered = lower_fields(ir, name, fields)?;
                return Ok(IrOverlay::Struct(IrOverlayStruct {
                    name: name.to_string(),
                    doc: if doc.is_empty() {
                        format!("SDK-only type `{name}`.")
                    } else {
                        doc
                    },
                    flatten_base: None,
                    partial_base: false,
                    fields: lowered,
                }));
            }
            Err(GenError::Parse(format!(
                "synthetic overlay `{name}` has no unit/marker/aliasOf/arrayOf/enum/fields"
            )))
        }
    }
}

fn lower_project_union(
    ir: &mut Ir,
    name: &str,
    base: &str,
    doc: Option<&str>,
    drop_variants: &[String],
    succeeded_fields: &BTreeMap<String, FieldDef>,
) -> GenResult<IrOverlay> {
    let drop: BTreeSet<&str> = drop_variants.iter().map(String::as_str).collect();
    let base_ty = ir.types.get(base).cloned().ok_or_else(|| {
        GenError::UnknownRef(format!("projectUnion base `{base}` not in IR types"))
    })?;
    let IrType::OneOf(base_one) = base_ty else {
        return Err(GenError::Parse(format!(
            "projectUnion base `{base}` is not a oneOf"
        )));
    };

    let mut variants = Vec::new();
    for variant in &base_one.variants {
        if drop.contains(variant.rust_name.as_str()) {
            continue;
        }
        if variant.rust_name == "SucceededBare" {
            let branch_name = format!("{name}Succeeded");
            let mut fields = vec![IrField {
                wire_name: "status".into(),
                rust_name: "status".into(),
                doc: "Status discriminator.".into(),
                ty: IrTypeRef::String,
                required: true,
                nullable: false,
            }];
            fields.extend(lower_fields(ir, &branch_name, succeeded_fields)?);
            ir.overlay_helpers.insert(
                branch_name.clone(),
                IrType::Struct(crate::ir::IrStruct {
                    name: branch_name.clone(),
                    doc: "Projected succeeded arm.".into(),
                    fields,
                }),
            );
            variants.push(IrOneOfVariant {
                rust_name: "Succeeded".into(),
                tag_value: Some("succeeded".into()),
                ty: IrTypeRef::Named(branch_name),
            });
            continue;
        }
        variants.push(variant.clone());
    }

    Ok(IrOverlay::OneOf(IrOneOf {
        name: name.to_string(),
        doc: doc.unwrap_or("Projected union overlay.").to_string(),
        strategy: OneOfStrategy::Untagged,
        discriminator: base_one.discriminator.clone(),
        variants,
    }))
}

fn ensure_base_exists(
    ir: &Ir,
    catalog: &BTreeMap<String, OverlayDef>,
    name: &str,
) -> GenResult<()> {
    if ir.types.contains_key(name)
        || ir.overlay_helpers.contains_key(name)
        || ir.overlays.contains_key(name)
        || catalog.contains_key(name)
    {
        return Ok(());
    }
    Err(GenError::UnknownRef(name.to_string()))
}

/// Lowers a map of overlay/param fields into sorted [`IrField`] values.
pub(crate) fn lower_fields(
    ir: &mut Ir,
    parent: &str,
    fields: &BTreeMap<String, FieldDef>,
) -> GenResult<Vec<IrField>> {
    let mut out = Vec::new();
    for (wire_name, field) in fields {
        let ty = lower_type_ref(ir, parent, wire_name, field)?;
        out.push(IrField {
            wire_name: wire_name.clone(),
            rust_name: rust_field_name(wire_name),
            doc: field.doc.clone().unwrap_or_default(),
            ty,
            required: field.required,
            nullable: field.nullable,
        });
    }
    out.sort_by(|a, b| a.wire_name.cmp(&b.wire_name));
    Ok(out)
}

/// Lowers one FieldDef type expression into an [`IrTypeRef`].
pub(crate) fn lower_type_ref(
    ir: &mut Ir,
    parent: &str,
    field_name: &str,
    field: &FieldDef,
) -> GenResult<IrTypeRef> {
    if let Some(name) = &field.ref_name {
        return Ok(IrTypeRef::Named(name.clone()));
    }
    if let Some(inner) = &field.array {
        let item = lower_type_ref(ir, parent, field_name, inner)?;
        return Ok(IrTypeRef::Vec(Box::new(item)));
    }
    if let Some(inner) = &field.map {
        let value = lower_type_ref(ir, parent, field_name, inner)?;
        return Ok(IrTypeRef::Map(Box::new(value)));
    }
    if let Some(variants) = &field.enum_variants {
        let enum_name = format!("{}{}", rust_type_name(parent), rust_type_name(field_name));
        let mut enum_vars: Vec<IrEnumVariant> = variants
            .iter()
            .map(|wire| IrEnumVariant {
                wire: wire.clone(),
                rust_name: rust_type_name(wire),
            })
            .collect();
        enum_vars.sort_by(|a, b| a.wire.cmp(&b.wire));
        ir.overlay_helpers.insert(
            enum_name.clone(),
            IrType::StringEnum(IrStringEnum {
                name: enum_name.clone(),
                doc: format!("Enum for `{parent}.{field_name}`."),
                variants: enum_vars,
            }),
        );
        return Ok(IrTypeRef::Named(enum_name));
    }
    if let Some(object) = &field.object {
        let nested_name = format!("{}{}", rust_type_name(parent), rust_type_name(field_name));
        let nested_fields = lower_fields(ir, &nested_name, object)?;
        ir.overlay_helpers.insert(
            nested_name.clone(),
            IrType::Struct(crate::ir::IrStruct {
                name: nested_name.clone(),
                doc: format!("Inline object for `{parent}.{field_name}`."),
                fields: nested_fields,
            }),
        );
        return Ok(IrTypeRef::Named(nested_name));
    }
    if let Some(lit) = &field.literal {
        return Ok(match lit {
            serde_json::Value::Bool(_) => IrTypeRef::Bool,
            serde_json::Value::Number(n) if n.is_i64() => IrTypeRef::I64,
            serde_json::Value::Number(_) => IrTypeRef::F64,
            serde_json::Value::String(s) => IrTypeRef::LiteralString(s.clone()),
            _ => IrTypeRef::String,
        });
    }
    match field.ty.as_deref() {
        Some("string") => Ok(IrTypeRef::String),
        Some("number") => Ok(IrTypeRef::F64),
        Some("integer") => Ok(IrTypeRef::I64),
        Some("boolean") => Ok(IrTypeRef::Bool),
        Some("unknown") => Ok(IrTypeRef::Value),
        Some(other) => Err(GenError::Parse(format!(
            "unknown overlay field type `{other}` on {parent}.{field_name}"
        ))),
        None => Err(GenError::Parse(format!(
            "overlay field {parent}.{field_name} missing type/ref"
        ))),
    }
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
    use crate::ir::IrStruct;

    fn empty_ir() -> Ir {
        Ir {
            types: BTreeMap::new(),
            overlay_helpers: BTreeMap::new(),
            overlays: BTreeMap::new(),
            routes: vec![],
            error_templates: crate::ir::IrErrorTemplates::default(),
            entry_points: BTreeMap::new(),
            binding_symbols: BTreeMap::new(),
        }
    }

    #[test]
    fn lowers_extend_dto_with_flatten_base() {
        let mut ir = empty_ir();
        ir.types.insert(
            "LimitResponse".into(),
            IrType::Struct(IrStruct {
                name: "LimitResponse".into(),
                doc: "wire".into(),
                fields: vec![],
            }),
        );
        let mut fields = BTreeMap::new();
        fields.insert(
            "plan".into(),
            FieldDef {
                ty: Some("string".into()),
                ref_name: None,
                array: None,
                map: None,
                enum_variants: None,
                literal: None,
                object: None,
                required: true,
                nullable: false,
                doc: None,
            },
        );
        let manifest = Manifest {
            operations: BTreeMap::new(),
            overlays: BTreeMap::from([(
                "LimitResponseWithPlan".into(),
                OverlayDef::ExtendDto {
                    base: "LimitResponse".into(),
                    doc: None,
                    partial: false,
                    fields,
                },
            )]),
            errors: None,
            top_level: BTreeMap::new(),
            core_helpers: BTreeMap::new(),
            facade: BTreeMap::new(),
            bindings: BTreeMap::new(),
            defaults: Default::default(),
        };
        lower_overlays(&mut ir, &manifest).expect("lower");
        match ir.overlays.get("LimitResponseWithPlan").expect("overlay") {
            IrOverlay::Struct(st) => {
                assert_eq!(st.flatten_base.as_deref(), Some("LimitResponse"));
                assert_eq!(st.fields.len(), 1);
                assert_eq!(st.fields[0].wire_name, "plan");
                assert!(st.fields[0].required);
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn lowers_project_union_topup() {
        let mut ir = empty_ir();
        ir.types.insert(
            "ProcessPaymentSucceededBare".into(),
            IrType::Struct(IrStruct {
                name: "ProcessPaymentSucceededBare".into(),
                doc: "".into(),
                fields: vec![],
            }),
        );
        ir.types.insert(
            "ProcessPaymentProcessing".into(),
            IrType::Struct(IrStruct {
                name: "ProcessPaymentProcessing".into(),
                doc: "".into(),
                fields: vec![],
            }),
        );
        ir.types.insert(
            "ProcessPaymentResult".into(),
            IrType::OneOf(IrOneOf {
                name: "ProcessPaymentResult".into(),
                doc: "".into(),
                strategy: OneOfStrategy::ProcessPaymentResult,
                discriminator: Some("status".into()),
                variants: vec![
                    IrOneOfVariant {
                        rust_name: "SucceededRecurring".into(),
                        tag_value: None,
                        ty: IrTypeRef::Named("X".into()),
                    },
                    IrOneOfVariant {
                        rust_name: "SucceededOneTime".into(),
                        tag_value: None,
                        ty: IrTypeRef::Named("Y".into()),
                    },
                    IrOneOfVariant {
                        rust_name: "SucceededBare".into(),
                        tag_value: None,
                        ty: IrTypeRef::Named("ProcessPaymentSucceededBare".into()),
                    },
                    IrOneOfVariant {
                        rust_name: "Processing".into(),
                        tag_value: None,
                        ty: IrTypeRef::Named("ProcessPaymentProcessing".into()),
                    },
                ],
            }),
        );
        let mut succeeded_fields = BTreeMap::new();
        succeeded_fields.insert(
            "creditsAdded".into(),
            FieldDef {
                ty: Some("number".into()),
                ref_name: None,
                array: None,
                map: None,
                enum_variants: None,
                literal: None,
                object: None,
                required: false,
                nullable: false,
                doc: None,
            },
        );
        let manifest = Manifest {
            operations: BTreeMap::new(),
            overlays: BTreeMap::from([(
                "TopupProcessResult".into(),
                OverlayDef::ProjectUnion {
                    base: "ProcessPaymentResult".into(),
                    doc: Some("Topup projection.".into()),
                    drop_variants: vec!["SucceededRecurring".into(), "SucceededOneTime".into()],
                    succeeded_fields,
                },
            )]),
            errors: None,
            top_level: BTreeMap::new(),
            core_helpers: BTreeMap::new(),
            facade: BTreeMap::new(),
            bindings: BTreeMap::new(),
            defaults: Default::default(),
        };
        lower_overlays(&mut ir, &manifest).expect("lower");
        match ir.overlays.get("TopupProcessResult").expect("overlay") {
            IrOverlay::OneOf(one) => {
                assert_eq!(one.variants.len(), 2);
                assert_eq!(one.variants[0].rust_name, "Succeeded");
                assert_eq!(one.variants[1].rust_name, "Processing");
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
