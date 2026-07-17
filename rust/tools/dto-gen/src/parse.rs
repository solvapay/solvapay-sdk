//! OpenAPI snapshot → IR.

use std::collections::{BTreeMap, BTreeSet};

use serde_json::{Map, Value};

use crate::error::{GenError, GenResult};
use crate::ir::{
    Ir, IrEnumVariant, IrField, IrOneOf, IrOneOfVariant, IrRoute, IrStringEnum, IrStruct, IrType,
    IrTypeRef, OneOfStrategy,
};
use crate::name::{nested_item_type_name, nested_type_name, rust_field_name, rust_type_name};

/// Well-known name for the process-payment response union (matches TS overlay).
const PROCESS_PAYMENT_RESULT: &str = "ProcessPaymentResult";
/// Synthetic name for the payment-method response union.
const PAYMENT_METHOD_RESULT: &str = "PaymentMethodResult";

/// Parses a checked-in OpenAPI snapshot JSON value into a deterministic IR.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when the document is not an object with
/// `components.schemas` / `paths`, or when a schema shape cannot be lowered.
pub fn parse_openapi(root: &Value) -> GenResult<Ir> {
    let obj = root
        .as_object()
        .ok_or_else(|| GenError::Parse("openapi root must be an object".into()))?;
    let components = obj
        .get("components")
        .and_then(Value::as_object)
        .ok_or_else(|| GenError::Parse("missing components".into()))?;
    let schemas = components
        .get("schemas")
        .and_then(Value::as_object)
        .ok_or_else(|| GenError::Parse("missing components.schemas".into()))?;
    let paths = obj
        .get("paths")
        .and_then(Value::as_object)
        .ok_or_else(|| GenError::Parse("missing paths".into()))?;

    let mut ctx = ParseCtx::new();

    for (name, schema) in schemas {
        ctx.ensure_schema(name, schema, schemas)?;
    }

    let mut routes = Vec::new();
    for (path, item) in paths {
        let item_obj = match item.as_object() {
            Some(o) => o,
            None => continue,
        };
        for (method, op) in item_obj {
            if !is_http_method(method) {
                continue;
            }
            let op_obj = match op.as_object() {
                Some(o) => o,
                None => continue,
            };
            let operation_id = op_obj
                .get("operationId")
                .and_then(Value::as_str)
                .unwrap_or("anonymous")
                .to_string();
            let request_body = parse_request_body(op_obj, &mut ctx, schemas)?;
            let response_body =
                parse_success_response(op_obj, path, method, &operation_id, &mut ctx, schemas)?;
            routes.push(IrRoute {
                method: method.to_ascii_uppercase(),
                path_template: path.clone(),
                operation_id,
                request_body,
                response_body,
            });
        }
    }

    routes.sort_by(|a, b| (&a.method, &a.path_template).cmp(&(&b.method, &b.path_template)));

    Ok(Ir {
        types: ctx.types,
        overlay_helpers: BTreeMap::new(),
        overlays: BTreeMap::new(),
        routes,
        error_templates: crate::ir::IrErrorTemplates::default(),
        entry_points: BTreeMap::new(),
    })
}

struct ParseCtx {
    types: BTreeMap<String, IrType>,
    /// Schema names currently being lowered (cycle guard).
    visiting: BTreeSet<String>,
}

impl ParseCtx {
    fn new() -> Self {
        Self {
            types: BTreeMap::new(),
            visiting: BTreeSet::new(),
        }
    }

    fn ensure_schema(
        &mut self,
        name: &str,
        schema: &Value,
        schemas: &Map<String, Value>,
    ) -> GenResult<IrTypeRef> {
        if self.types.contains_key(name) {
            return Ok(IrTypeRef::Named(name.to_string()));
        }
        if !self.visiting.insert(name.to_string()) {
            // Cycle: emit a forward named ref; the outer call fills the type.
            return Ok(IrTypeRef::Named(name.to_string()));
        }
        let ty = lower_named_schema(name, schema, self, schemas)?;
        self.types.insert(name.to_string(), ty);
        self.visiting.remove(name);
        Ok(IrTypeRef::Named(name.to_string()))
    }

    fn insert_type(&mut self, name: String, ty: IrType) -> IrTypeRef {
        self.types.insert(name.clone(), ty);
        IrTypeRef::Named(name)
    }
}

fn is_http_method(method: &str) -> bool {
    matches!(
        method,
        "get" | "post" | "put" | "patch" | "delete" | "head" | "options" | "trace"
    )
}

fn lower_named_schema(
    name: &str,
    schema: &Value,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrType> {
    let obj = schema
        .as_object()
        .ok_or_else(|| GenError::Parse(format!("schema {name} must be an object")))?;

    if let Some(values) = obj.get("enum").and_then(Value::as_array) {
        if obj.get("type").and_then(Value::as_str) == Some("string")
            || values.iter().all(|v| v.as_str().is_some())
        {
            return Ok(IrType::StringEnum(string_enum_from_values(
                name,
                doc_of(obj),
                values,
            )?));
        }
    }

    if obj.get("type").and_then(Value::as_str) == Some("object") || obj.contains_key("properties") {
        return Ok(IrType::Struct(lower_struct(name, obj, ctx, schemas)?));
    }

    Err(GenError::Unsupported {
        name: name.to_string(),
        detail: format!(
            "unsupported top-level schema keys: {:?}",
            obj.keys().collect::<Vec<_>>()
        ),
    })
}

fn lower_struct(
    name: &str,
    obj: &Map<String, Value>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrStruct> {
    let required: BTreeSet<String> = obj
        .get("required")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_string)
                .collect()
        })
        .unwrap_or_default();

    let props = obj
        .get("properties")
        .and_then(Value::as_object)
        .cloned()
        .unwrap_or_default();

    let mut fields = Vec::new();
    for (prop_name, prop_schema) in &props {
        let prop_obj = prop_schema.as_object();
        let nullable = prop_obj
            .and_then(|o| o.get("nullable"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        let doc = prop_obj
            .map(doc_of)
            .unwrap_or_else(|| format!("Field `{prop_name}`."));
        let ty = lower_type_ref(prop_schema, Some(name), Some(prop_name), ctx, schemas)?;
        fields.push(IrField {
            wire_name: prop_name.clone(),
            rust_name: rust_field_name(prop_name),
            doc,
            ty,
            required: required.contains(prop_name),
            nullable,
        });
    }
    fields.sort_by(|a, b| a.wire_name.cmp(&b.wire_name));

    Ok(IrStruct {
        name: name.to_string(),
        doc: doc_of(obj),
        fields,
    })
}

fn lower_type_ref(
    schema: &Value,
    parent: Option<&str>,
    field: Option<&str>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    if let Some(r) = schema
        .as_object()
        .and_then(|o| o.get("$ref"))
        .and_then(Value::as_str)
    {
        let name = ref_name(r)?;
        let def = schemas
            .get(name)
            .ok_or_else(|| GenError::UnknownRef(name.to_string()))?;
        return ctx.ensure_schema(name, def, schemas);
    }

    let obj = match schema.as_object() {
        Some(o) => o,
        None => return Ok(IrTypeRef::Value),
    };

    if let Some(all_of) = obj.get("allOf").and_then(Value::as_array) {
        if let Some(inner) = all_of.first() {
            return lower_type_ref(inner, parent, field, ctx, schemas);
        }
        return Ok(IrTypeRef::Value);
    }

    if let Some(one_of) = obj.get("oneOf").and_then(Value::as_array) {
        return lower_inline_one_of(one_of, parent, field, ctx, schemas);
    }

    if let Some(values) = obj.get("enum").and_then(Value::as_array) {
        return lower_enum_property(values, obj, parent, field, ctx);
    }

    match obj.get("type").and_then(Value::as_str) {
        Some("string") => Ok(IrTypeRef::String),
        Some("integer") => Ok(IrTypeRef::I64),
        Some("number") => Ok(IrTypeRef::F64),
        Some("boolean") => Ok(IrTypeRef::Bool),
        Some("array") => {
            let items = obj.get("items").unwrap_or(&Value::Null);
            let item_ty = if items.as_object().is_some_and(|o| {
                o.get("type").and_then(Value::as_str) == Some("object")
                    && o.contains_key("properties")
            }) {
                let parent_name = parent.unwrap_or("Anon");
                let field_name = field.unwrap_or("item");
                let item_name = nested_item_type_name(parent_name, field_name);
                let item_obj = items
                    .as_object()
                    .ok_or_else(|| GenError::Parse("array items".into()))?;
                let st = lower_struct(&item_name, item_obj, ctx, schemas)?;
                ctx.insert_type(item_name.clone(), IrType::Struct(st));
                IrTypeRef::Named(item_name)
            } else {
                lower_type_ref(items, parent, field, ctx, schemas)?
            };
            Ok(IrTypeRef::Vec(Box::new(item_ty)))
        }
        Some("object") => lower_object_property(obj, parent, field, ctx, schemas),
        None => {
            // Empty schema `{}` (e.g. UpdateCustomerRequest.metadata) → free-form map.
            if obj.is_empty() || obj.get("additionalProperties").is_some() {
                Ok(IrTypeRef::Map(Box::new(IrTypeRef::Value)))
            } else {
                Ok(IrTypeRef::Value)
            }
        }
        Some(other) => Err(GenError::Unsupported {
            name: format!("{}.{}", parent.unwrap_or("?"), field.unwrap_or("?")),
            detail: format!("unknown type {other:?}"),
        }),
    }
}

fn lower_object_property(
    obj: &Map<String, Value>,
    parent: Option<&str>,
    field: Option<&str>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    if let Some(props) = obj.get("properties").and_then(Value::as_object) {
        if !props.is_empty() {
            let parent_name = parent.unwrap_or("Anon");
            let field_name = field.unwrap_or("value");
            let nested = nested_type_name(parent_name, field_name);
            let st = lower_struct(&nested, obj, ctx, schemas)?;
            return Ok(ctx.insert_type(nested, IrType::Struct(st)));
        }
    }

    match obj.get("additionalProperties") {
        Some(Value::Bool(true)) | None => Ok(IrTypeRef::Map(Box::new(IrTypeRef::Value))),
        Some(Value::Object(ap)) if ap.is_empty() => Ok(IrTypeRef::Map(Box::new(IrTypeRef::Value))),
        Some(ap) => {
            let value_ty = lower_type_ref(ap, parent, field, ctx, schemas)?;
            Ok(IrTypeRef::Map(Box::new(value_ty)))
        }
    }
}

fn lower_enum_property(
    values: &[Value],
    obj: &Map<String, Value>,
    parent: Option<&str>,
    field: Option<&str>,
    ctx: &mut ParseCtx,
) -> GenResult<IrTypeRef> {
    // Zod/OpenAPI quirk: `enum: [true]` with `type: number` → bool.
    if values.len() == 1 {
        if let Some(b) = values[0].as_bool() {
            let _ = b;
            return Ok(IrTypeRef::Bool);
        }
    }
    if values.iter().all(|v| v.as_bool().is_some()) {
        return Ok(IrTypeRef::Bool);
    }
    if values.iter().all(|v| v.as_str().is_some()) {
        let parent_name = parent.unwrap_or("Anon");
        let field_name = field.unwrap_or("value");
        let enum_name = nested_type_name(parent_name, field_name);
        if !ctx.types.contains_key(&enum_name) {
            let en = string_enum_from_values(&enum_name, doc_of(obj), values)?;
            ctx.insert_type(enum_name.clone(), IrType::StringEnum(en));
        }
        return Ok(IrTypeRef::Named(enum_name));
    }
    if values
        .iter()
        .all(|v| v.as_i64().is_some() || v.as_f64().is_some())
    {
        return Ok(IrTypeRef::F64);
    }
    Ok(IrTypeRef::Value)
}

fn lower_inline_one_of(
    one_of: &[Value],
    parent: Option<&str>,
    field: Option<&str>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    // telephone-style: all branches are strings → String.
    if one_of.iter().all(|branch| {
        branch
            .as_object()
            .and_then(|o| o.get("type"))
            .and_then(Value::as_str)
            == Some("string")
    }) {
        return Ok(IrTypeRef::String);
    }

    let parent_name = parent.unwrap_or("Anon");
    let field_name = field.unwrap_or("value");
    let union_name = nested_type_name(parent_name, field_name);

    let mut variants = Vec::new();
    for (idx, branch) in one_of.iter().enumerate() {
        if let Some(r) = branch
            .as_object()
            .and_then(|o| o.get("$ref"))
            .and_then(Value::as_str)
        {
            let name = ref_name(r)?;
            let def = schemas
                .get(name)
                .ok_or_else(|| GenError::UnknownRef(name.to_string()))?;
            ctx.ensure_schema(name, def, schemas)?;
            variants.push(IrOneOfVariant {
                rust_name: rust_type_name(name),
                tag_value: None,
                ty: IrTypeRef::Named(name.to_string()),
            });
        } else {
            let branch_name = format!("{union_name}{idx}");
            let branch_obj = branch.as_object().ok_or_else(|| {
                GenError::Parse(format!("oneOf branch in {union_name} must be object"))
            })?;
            let st = lower_struct(&branch_name, branch_obj, ctx, schemas)?;
            ctx.insert_type(branch_name.clone(), IrType::Struct(st));
            variants.push(IrOneOfVariant {
                rust_name: format!("Variant{idx}"),
                tag_value: None,
                ty: IrTypeRef::Named(branch_name),
            });
        }
    }

    // Prefer Success before Skipped when both exist (debited: true before false).
    variants.sort_by(|a, b| a.rust_name.cmp(&b.rust_name));

    let one = IrOneOf {
        name: union_name.clone(),
        doc: format!("Union for `{parent_name}.{field_name}`."),
        strategy: OneOfStrategy::Untagged,
        discriminator: None,
        variants,
    };
    Ok(ctx.insert_type(union_name, IrType::OneOf(one)))
}

fn parse_request_body(
    op: &Map<String, Value>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<Option<IrTypeRef>> {
    let schema = op
        .get("requestBody")
        .and_then(Value::as_object)
        .and_then(|rb| rb.get("content"))
        .and_then(Value::as_object)
        .and_then(|c| c.get("application/json"))
        .and_then(Value::as_object)
        .and_then(|j| j.get("schema"));
    match schema {
        Some(s) => Ok(Some(lower_type_ref(s, None, None, ctx, schemas)?)),
        None => Ok(None),
    }
}

fn parse_success_response(
    op: &Map<String, Value>,
    path: &str,
    method: &str,
    operation_id: &str,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<Option<IrTypeRef>> {
    let responses = match op.get("responses").and_then(Value::as_object) {
        Some(r) => r,
        None => return Ok(None),
    };

    let mut success_codes: Vec<&String> = responses.keys().filter(|k| k.starts_with('2')).collect();
    success_codes.sort();

    for code in success_codes {
        let resp = match responses.get(code).and_then(Value::as_object) {
            Some(r) => r,
            None => continue,
        };
        let schema = resp
            .get("content")
            .and_then(Value::as_object)
            .and_then(|c| c.get("application/json"))
            .and_then(Value::as_object)
            .and_then(|j| j.get("schema"));
        let Some(schema) = schema else {
            continue;
        };

        if let Some(r) = schema
            .as_object()
            .and_then(|o| o.get("$ref"))
            .and_then(Value::as_str)
        {
            let name = ref_name(r)?;
            let def = schemas
                .get(name)
                .ok_or_else(|| GenError::UnknownRef(name.to_string()))?;
            return Ok(Some(ctx.ensure_schema(name, def, schemas)?));
        }

        if let Some(one_of) = schema
            .as_object()
            .and_then(|o| o.get("oneOf"))
            .and_then(Value::as_array)
        {
            let disc = schema
                .as_object()
                .and_then(|o| o.get("discriminator"))
                .and_then(Value::as_object)
                .and_then(|d| d.get("propertyName"))
                .and_then(Value::as_str)
                .map(str::to_string);

            if path.ends_with("/process")
                && method.eq_ignore_ascii_case("post")
                && disc.as_deref() == Some("status")
            {
                return Ok(Some(build_process_payment_result(
                    one_of, &disc, ctx, schemas,
                )?));
            }

            if path == "/v1/sdk/payment-method"
                && method.eq_ignore_ascii_case("get")
                && disc.as_deref() == Some("kind")
            {
                return Ok(Some(build_payment_method_result(
                    one_of, &disc, ctx, schemas,
                )?));
            }

            let name = format!("{}Response", rust_type_name(operation_id));
            return Ok(Some(build_generic_oneof(
                &name,
                one_of,
                disc,
                OneOfStrategy::Untagged,
                ctx,
                schemas,
            )?));
        }

        if schema
            .as_object()
            .and_then(|o| o.get("type"))
            .and_then(Value::as_str)
            == Some("array")
        {
            let items = schema
                .as_object()
                .and_then(|o| o.get("items"))
                .unwrap_or(&Value::Null);
            let item_ty = lower_type_ref(items, Some(operation_id), Some("item"), ctx, schemas)?;
            return Ok(Some(IrTypeRef::Vec(Box::new(item_ty))));
        }

        // Inline object response → synthetic named struct.
        if let Some(obj) = schema.as_object() {
            if obj.contains_key("properties")
                || obj.get("type").and_then(Value::as_str) == Some("object")
            {
                let name = response_type_name(operation_id, method, path);
                if !ctx.types.contains_key(&name) {
                    let st = lower_struct(&name, obj, ctx, schemas)?;
                    ctx.insert_type(name.clone(), IrType::Struct(st));
                }
                return Ok(Some(IrTypeRef::Named(name)));
            }
        }
    }

    Ok(None)
}

fn build_process_payment_result(
    one_of: &[Value],
    disc: &Option<String>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    let mut variants = Vec::new();
    for branch in one_of {
        let r = branch
            .as_object()
            .and_then(|o| o.get("$ref"))
            .and_then(Value::as_str)
            .ok_or_else(|| GenError::Parse("ProcessPaymentResult branch must be $ref".into()))?;
        let name = ref_name(r)?;
        let def = schemas
            .get(name)
            .ok_or_else(|| GenError::UnknownRef(name.to_string()))?;
        ctx.ensure_schema(name, def, schemas)?;
        variants.push(IrOneOfVariant {
            rust_name: rust_type_name(name.trim_start_matches("ProcessPayment")),
            tag_value: None,
            ty: IrTypeRef::Named(name.to_string()),
        });
    }

    // Untagged order: specific succeeded arms before bare.
    let order = [
        "SucceededRecurring",
        "SucceededOneTime",
        "Processing",
        "Timeout",
        "Failed",
        "Cancelled",
        "SucceededBare",
    ];
    variants.sort_by_key(|v| {
        order
            .iter()
            .position(|n| *n == v.rust_name)
            .unwrap_or(usize::MAX)
    });

    let one = IrOneOf {
        name: PROCESS_PAYMENT_RESULT.to_string(),
        doc: "Payment intent status with optional purchase enrichment on success.".into(),
        strategy: OneOfStrategy::ProcessPaymentResult,
        discriminator: disc.clone(),
        variants,
    };
    Ok(ctx.insert_type(PROCESS_PAYMENT_RESULT.to_string(), IrType::OneOf(one)))
}

fn build_payment_method_result(
    one_of: &[Value],
    disc: &Option<String>,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    let mut variants = Vec::new();
    for (idx, branch) in one_of.iter().enumerate() {
        let branch_obj = branch
            .as_object()
            .ok_or_else(|| GenError::Parse("PaymentMethodResult branch must be object".into()))?;
        let tag = branch_obj
            .get("properties")
            .and_then(Value::as_object)
            .and_then(|p| p.get("kind"))
            .and_then(Value::as_object)
            .and_then(|k| k.get("enum"))
            .and_then(Value::as_array)
            .and_then(|e| e.first())
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        let branch_name = format!("PaymentMethod{}", rust_type_name(tag));
        if !ctx.types.contains_key(&branch_name) {
            let st = lower_struct(&branch_name, branch_obj, ctx, schemas)?;
            ctx.insert_type(branch_name.clone(), IrType::Struct(st));
        }
        variants.push(IrOneOfVariant {
            rust_name: rust_type_name(tag),
            tag_value: Some(tag.to_string()),
            ty: IrTypeRef::Named(branch_name),
        });
        let _ = idx;
    }

    let one = IrOneOf {
        name: PAYMENT_METHOD_RESULT.to_string(),
        doc: "Default payment method on file, or `kind: none` when absent.".into(),
        strategy: OneOfStrategy::InternallyTagged,
        discriminator: disc.clone(),
        variants,
    };
    Ok(ctx.insert_type(PAYMENT_METHOD_RESULT.to_string(), IrType::OneOf(one)))
}

fn build_generic_oneof(
    name: &str,
    one_of: &[Value],
    disc: Option<String>,
    strategy: OneOfStrategy,
    ctx: &mut ParseCtx,
    schemas: &Map<String, Value>,
) -> GenResult<IrTypeRef> {
    let mut variants = Vec::new();
    for (idx, branch) in one_of.iter().enumerate() {
        if let Some(r) = branch
            .as_object()
            .and_then(|o| o.get("$ref"))
            .and_then(Value::as_str)
        {
            let ref_name_s = ref_name(r)?;
            let def = schemas
                .get(ref_name_s)
                .ok_or_else(|| GenError::UnknownRef(ref_name_s.to_string()))?;
            ctx.ensure_schema(ref_name_s, def, schemas)?;
            variants.push(IrOneOfVariant {
                rust_name: rust_type_name(ref_name_s),
                tag_value: None,
                ty: IrTypeRef::Named(ref_name_s.to_string()),
            });
        } else if let Some(obj) = branch.as_object() {
            let branch_name = format!("{name}{idx}");
            let st = lower_struct(&branch_name, obj, ctx, schemas)?;
            ctx.insert_type(branch_name.clone(), IrType::Struct(st));
            variants.push(IrOneOfVariant {
                rust_name: format!("Variant{idx}"),
                tag_value: None,
                ty: IrTypeRef::Named(branch_name),
            });
        }
    }
    let one = IrOneOf {
        name: name.to_string(),
        doc: format!("Generated union `{name}`."),
        strategy,
        discriminator: disc,
        variants,
    };
    Ok(ctx.insert_type(name.to_string(), IrType::OneOf(one)))
}

fn response_type_name(operation_id: &str, method: &str, path: &str) -> String {
    // Prefer a short name from the trailing path segment + method.
    let leaf = path
        .trim_matches('/')
        .rsplit('/')
        .find(|s| !s.starts_with('{'))
        .unwrap_or(operation_id);
    let base = rust_type_name(leaf);
    format!("{}{}Response", rust_type_name(method), base)
}

fn string_enum_from_values(name: &str, doc: String, values: &[Value]) -> GenResult<IrStringEnum> {
    let mut variants = Vec::new();
    for v in values {
        let wire = v
            .as_str()
            .ok_or_else(|| GenError::Parse(format!("enum {name} has non-string value")))?
            .to_string();
        variants.push(IrEnumVariant {
            rust_name: rust_type_name(&wire),
            wire,
        });
    }
    variants.sort_by(|a, b| a.wire.cmp(&b.wire));
    variants.dedup_by(|a, b| a.wire == b.wire);
    Ok(IrStringEnum {
        name: name.to_string(),
        doc,
        variants,
    })
}

fn ref_name(r: &str) -> GenResult<&str> {
    const PREFIX: &str = "#/components/schemas/";
    r.strip_prefix(PREFIX)
        .ok_or_else(|| GenError::Parse(format!("unsupported $ref: {r}")))
}

fn doc_of(obj: &Map<String, Value>) -> String {
    obj.get("description")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .unwrap_or_else(|| "Generated wire DTO.".to_string())
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
    use serde_json::json;

    #[test]
    fn parses_simple_struct_and_route() {
        let doc = json!({
            "components": {
                "schemas": {
                    "ActivatePlanDto": {
                        "type": "object",
                        "required": ["customerRef", "productRef", "planRef"],
                        "properties": {
                            "customerRef": { "type": "string" },
                            "planRef": { "type": "string" },
                            "productRef": { "type": "string" }
                        }
                    }
                }
            },
            "paths": {
                "/v1/sdk/activate": {
                    "post": {
                        "operationId": "ActivateSdkController_activate",
                        "requestBody": {
                            "content": {
                                "application/json": {
                                    "schema": { "$ref": "#/components/schemas/ActivatePlanDto" }
                                }
                            }
                        },
                        "responses": {
                            "200": {
                                "content": {
                                    "application/json": {
                                        "schema": { "$ref": "#/components/schemas/ActivatePlanDto" }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        });
        let ir = parse_openapi(&doc).expect("parse");
        assert!(ir.types.contains_key("ActivatePlanDto"));
        assert_eq!(ir.routes.len(), 1);
        assert_eq!(ir.routes[0].method, "POST");
    }
}
