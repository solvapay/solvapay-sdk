from solvapay_mcp.register import ensure_output_schema_type


def test_adds_object_type_to_any_of_union() -> None:
    schema = {"anyOf": [{"type": "object"}, {"type": "object", "required": ["error"]}]}
    assert ensure_output_schema_type(schema) == {**schema, "type": "object"}


def test_leaves_typed_schema_unchanged() -> None:
    schema = {"type": "object", "properties": {"n": {"type": "number"}}}
    assert ensure_output_schema_type(schema) is schema
