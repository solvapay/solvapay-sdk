//! Shared JSON Schema helpers for payable tool registration.

use serde_json::{json, Map, Value};

use crate::helper_error::HelperErrorResult;

/// Compile a string-field map into a JSON Schema object.
///
/// Binding entry: `fields` is a JSON object of `{ type: "string" }` specs.
///
/// Hosts that only accept `type: "string"` fields (Go / Rust MCP) share this
/// check so they cannot drift on rejected specs.
///
/// # Errors
///
/// Transport helper error when a field is not an object with `type: "string"`.
pub fn compile_string_field_input_schema(
    fields: Option<&Map<String, Value>>,
) -> Result<Value, HelperErrorResult> {
    let mut schema = Map::new();
    schema.insert("type".to_owned(), json!("object"));
    let Some(fields) = fields else {
        schema.insert("properties".to_owned(), json!({}));
        return Ok(Value::Object(schema));
    };
    let mut properties = Map::new();
    let mut required = Vec::new();
    for (key, spec) in fields {
        let obj = spec.as_object().ok_or_else(|| {
            HelperErrorResult::transport(format!("unsupported inputSchema for field {key}"))
        })?;
        let typ = obj.get("type").and_then(Value::as_str);
        if typ != Some("string") {
            return Err(HelperErrorResult::transport(format!(
                "unsupported inputSchema for field {key}"
            )));
        }
        properties.insert(key.clone(), json!({ "type": "string" }));
        required.push(key.clone());
    }
    schema.insert("properties".to_owned(), Value::Object(properties));
    if !required.is_empty() {
        schema.insert("required".to_owned(), json!(required));
    }
    Ok(Value::Object(schema))
}

/// Binding wrapper: `fields` is a JSON object of `{ type: "string" }` specs.
///
/// # Errors
///
/// Transport helper error when `fields` is not an object or a field is not `type: "string"`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-schema",
    emit_order = 90
)]
pub fn compile_string_field_input_schema_json(
    fields: Option<&Value>,
) -> Result<Value, HelperErrorResult> {
    let map = match fields {
        None | Some(Value::Null) => None,
        Some(Value::Object(map)) => Some(map),
        Some(_) => {
            return Err(HelperErrorResult::transport(
                "compile_string_field_input_schema fields must be an object",
            ))
        }
    };
    compile_string_field_input_schema(map)
}

/// MCP 2.2 `outputSchema` requires `type`. Core anyOf/oneOf unions omit it.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-schema",
    emit_order = 91
)]
pub fn ensure_output_schema_object_type(schema: &Value) -> Value {
    match schema {
        Value::Object(map) if !map.contains_key("type") => {
            let mut next = map.clone();
            next.insert("type".to_owned(), json!("object"));
            Value::Object(next)
        }
        other => other.clone(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used)]

    use super::*;

    #[test]
    fn empty_fields_are_object_schema() {
        let schema = compile_string_field_input_schema(None).unwrap();
        assert_eq!(schema["type"], "object");
        assert_eq!(schema["properties"], json!({}));
    }

    #[test]
    fn rejects_non_string_field() {
        let mut fields = Map::new();
        fields.insert("n".to_owned(), json!({ "type": "number" }));
        let err = compile_string_field_input_schema(Some(&fields)).unwrap_err();
        assert!(err
            .details
            .as_deref()
            .unwrap_or("")
            .contains("unsupported inputSchema"));
    }

    #[test]
    fn stamps_missing_output_type() {
        let stamped = ensure_output_schema_object_type(&json!({ "properties": {} }));
        assert_eq!(stamped["type"], "object");
    }
}
