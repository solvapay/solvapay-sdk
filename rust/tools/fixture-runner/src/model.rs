//! §5.3 golden-fixture model (mirrors scripts/lib/fixture-schema.ts).

use serde_json::{Map, Value};
use std::collections::BTreeMap;

use crate::error::{RunnerError, RunnerResult};

/// HTTP methods accepted on `wire.request.method`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpMethod {
    /// `GET`
    Get,
    /// `POST`
    Post,
    /// `PUT`
    Put,
    /// `PATCH`
    Patch,
    /// `DELETE`
    Delete,
}

impl HttpMethod {
    /// Parses a wire-method string into an [`HttpMethod`] variant.
    ///
    /// Mirrors the five verbs allowed by the TS fixture schema on `wire.request.method`.
    ///
    /// # Arguments
    ///
    /// * `raw` - Uppercase HTTP verb (`GET`, `POST`, `PUT`, `PATCH`, or `DELETE`).
    ///
    /// # Returns
    ///
    /// The matching variant, or [`RunnerError::Parse`] when `raw` is not one of the five allowed verbs.
    fn parse(raw: &str) -> RunnerResult<Self> {
        match raw {
            "GET" => Ok(Self::Get),
            "POST" => Ok(Self::Post),
            "PUT" => Ok(Self::Put),
            "PATCH" => Ok(Self::Patch),
            "DELETE" => Ok(Self::Delete),
            other => Err(RunnerError::Parse(format!(
                "wire.request.method must be GET|POST|PUT|PATCH|DELETE, got {other:?}"
            ))),
        }
    }
}

/// Expected error shape under `expect.error` (mirrors the TS `FixtureErrorExpect` schema).
#[derive(Debug, Clone, PartialEq)]
pub struct FixtureErrorExpect {
    /// Optional error constructor/name (e.g. `"Error"`).
    pub name: Option<String>,
    /// Required human-readable message matched by the runner.
    pub message: String,
    /// Optional HTTP status when the fixture models an API failure.
    pub status: Option<i64>,
    /// Optional error kind discriminator from the contract.
    pub kind: Option<String>,
    /// Optional machine-readable error code.
    pub code: Option<String>,
}

/// Exactly one of `result` or `error` — enforced by [`FixtureExpect::try_new`].
#[derive(Debug, Clone, PartialEq)]
pub enum FixtureExpect {
    /// Success path: deep-compared JSON value under `expect.result`.
    Result(Value),
    /// Failure path: structured error expectation under `expect.error`.
    Error(FixtureErrorExpect),
}

/// Recorded HTTP request in a wire fixture (`wire.request`).
#[derive(Debug, Clone, PartialEq)]
pub struct WireRequest {
    /// HTTP verb sent to the API.
    pub method: HttpMethod,
    /// Request path (without host).
    pub path: String,
    /// Optional query parameters as string key-value pairs.
    pub query: Option<BTreeMap<String, String>>,
    /// Optional request headers.
    pub headers: Option<BTreeMap<String, String>>,
    /// Optional JSON request body.
    pub body: Option<Value>,
}

/// Recorded HTTP response in a wire fixture (`wire.response`).
#[derive(Debug, Clone, PartialEq)]
pub struct WireResponse {
    /// HTTP status code.
    pub status: i64,
    /// JSON response body (required when `wire` is present).
    pub body: Value,
}

/// Optional captured HTTP exchange for client-fixture suites (`wire`).
#[derive(Debug, Clone, PartialEq)]
pub struct Wire {
    /// Outbound request the SDK should have made.
    pub request: WireRequest,
    /// Inbound response the mock transport returned.
    pub response: WireResponse,
}

/// Callable input block (`input`) naming the bound function and its arguments.
#[derive(Debug, Clone, PartialEq)]
pub struct FixtureInput {
    /// Registry key — matches `input.fn` and a TS `FixtureRegistry` entry.
    pub fn_name: String,
    /// Named JSON arguments passed to the binding (`input.args`).
    pub args: BTreeMap<String, Value>,
    /// ISO-8601 clock string — kept as `String` (no chrono; §7.2).
    pub clock: Option<String>,
    /// Deterministic RNG seed for host adapters that simulate randomness.
    pub rng_seed: Option<i64>,
}

/// A parsed §5.3 golden fixture: suite metadata, input, optional wire, and expectation.
#[derive(Debug, Clone, PartialEq)]
pub struct Fixture {
    /// Top-level suite directory name (e.g. `business-details`).
    pub suite: String,
    /// Case file stem within the suite.
    pub case: String,
    /// Function invocation payload.
    pub input: FixtureInput,
    /// Present for client HTTP fixtures; `None` for pure core-function cases.
    pub wire: Option<Wire>,
    /// Success or error expectation after invocation.
    pub expect: FixtureExpect,
}

impl FixtureExpect {
    /// Constructs a [`FixtureExpect`] from optional success and error payloads.
    ///
    /// Enforces the TS `superRefine` rule: exactly one of `result` or `error` must be present.
    ///
    /// # Arguments
    ///
    /// * `result` - JSON value under `expect.result`, including `Some(Value::Null)` when the key is present with a null value.
    /// * `error` - Parsed error expectation under `expect.error`, or `None` when that key is absent.
    ///
    /// # Returns
    ///
    /// [`FixtureExpect::Result`] or [`FixtureExpect::Error`], or [`RunnerError::Parse`] when both or neither argument is `Some`.
    pub fn try_new(result: Option<Value>, error: Option<FixtureErrorExpect>) -> RunnerResult<Self> {
        match (result, error) {
            (Some(value), None) => Ok(Self::Result(value)),
            (None, Some(err)) => Ok(Self::Error(err)),
            (Some(_), Some(_)) | (None, None) => Err(RunnerError::Parse(
                "expect must contain exactly one of result or error".to_owned(),
            )),
        }
    }
}

/// Parses and validates a §5.3 golden fixture from a JSON value.
///
/// Walks top-level `suite`, `case`, `input`, optional `wire`, and `expect` fields.
///
/// # Arguments
///
/// * `raw` - Root JSON value of a fixture file (must be an object).
///
/// # Returns
///
/// A fully validated [`Fixture`], or [`RunnerError::Parse`] when shape, types, or mutual-exclusion rules fail.
pub fn parse_fixture(raw: &Value) -> RunnerResult<Fixture> {
    let obj = as_object(raw, "fixture")?;

    let suite = require_nonempty_string(obj, "suite")?;
    let case = require_nonempty_string(obj, "case")?;
    let input = parse_input(require_object(obj, "input")?)?;
    let wire = match obj.get("wire") {
        None => None,
        Some(Value::Null) => {
            return Err(RunnerError::Parse(
                "wire must be an object when present".to_owned(),
            ));
        }
        Some(value) => Some(parse_wire(as_object(value, "wire")?)?),
    };
    let expect = parse_expect(require_object(obj, "expect")?)?;

    Ok(Fixture {
        suite,
        case,
        input,
        wire,
        expect,
    })
}

/// Parses the `input` object into a [`FixtureInput`].
///
/// Reads `fn`, `args`, and optional `clock` / `rngSeed` keys.
///
/// # Arguments
///
/// * `obj` - JSON object backing the fixture `input` block.
///
/// # Returns
///
/// A [`FixtureInput`] with defaulted empty `args` when the key is absent, or [`RunnerError::Parse`] on type violations.
fn parse_input(obj: &Map<String, Value>) -> RunnerResult<FixtureInput> {
    let fn_name = require_nonempty_string(obj, "fn")?;
    let args = match obj.get("args") {
        None => BTreeMap::new(),
        Some(Value::Object(map)) => map.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
        Some(_) => {
            return Err(RunnerError::Parse(
                "input.args must be an object".to_owned(),
            ));
        }
    };

    Ok(FixtureInput {
        fn_name,
        args,
        clock: optional_nonempty_string(obj, "clock")?,
        rng_seed: optional_i64(obj, "rngSeed")?,
    })
}

/// Parses the `expect` object into a [`FixtureExpect`].
///
/// Honors Zod-style key presence for `result: null` (the key counts as present even when the value is JSON `null`).
///
/// # Arguments
///
/// * `obj` - JSON object backing the fixture `expect` block.
///
/// # Returns
///
/// A [`FixtureExpect`] via [`FixtureExpect::try_new`], or [`RunnerError::Parse`] when nested fields are invalid.
fn parse_expect(obj: &Map<String, Value>) -> RunnerResult<FixtureExpect> {
    // Key presence (including `result: null`) matches Zod `hasOwnProperty` semantics.
    let result = obj.get("result").cloned();
    let error = match obj.get("error") {
        None => None,
        Some(err_val) => Some(parse_fixture_error(as_object(err_val, "expect.error")?)?),
    };
    FixtureExpect::try_new(result, error)
}

/// Parses the nested `expect.error` object into a [`FixtureErrorExpect`].
///
/// # Arguments
///
/// * `obj` - JSON object backing `expect.error`.
///
/// # Returns
///
/// A [`FixtureErrorExpect`] with required `message` and optional `name`, `status`, `kind`, and `code`, or [`RunnerError::Parse`] on type violations.
fn parse_fixture_error(obj: &Map<String, Value>) -> RunnerResult<FixtureErrorExpect> {
    Ok(FixtureErrorExpect {
        name: optional_nonempty_string(obj, "name")?,
        message: require_string(obj, "message")?,
        status: optional_i64(obj, "status")?,
        kind: optional_nonempty_string(obj, "kind")?,
        code: optional_nonempty_string(obj, "code")?,
    })
}

/// Parses a `wire` block with required `request` and `response` sub-objects.
///
/// # Arguments
///
/// * `obj` - JSON object backing the fixture `wire` block.
///
/// # Returns
///
/// A [`Wire`] pairing parsed request and response, or [`RunnerError::Parse`] when sub-objects are missing or invalid.
fn parse_wire(obj: &Map<String, Value>) -> RunnerResult<Wire> {
    Ok(Wire {
        request: parse_wire_request(require_object(obj, "request")?)?,
        response: parse_wire_response(require_object(obj, "response")?)?,
    })
}

/// Parses `wire.request` fields into a [`WireRequest`].
///
/// # Arguments
///
/// * `obj` - JSON object backing `wire.request`.
///
/// # Returns
///
/// A [`WireRequest`] with required `method` and `path`, or [`RunnerError::Parse`] when required fields are missing or invalid.
fn parse_wire_request(obj: &Map<String, Value>) -> RunnerResult<WireRequest> {
    Ok(WireRequest {
        method: HttpMethod::parse(&require_nonempty_string(obj, "method")?)?,
        path: require_nonempty_string(obj, "path")?,
        query: optional_string_map(obj, "query")?,
        headers: optional_string_map(obj, "headers")?,
        body: obj.get("body").cloned(),
    })
}

/// Parses `wire.response` into a [`WireResponse`].
///
/// `body` is required whenever a `wire` block is present.
///
/// # Arguments
///
/// * `obj` - JSON object backing `wire.response`.
///
/// # Returns
///
/// A [`WireResponse`] with required `status` and `body`, or [`RunnerError::Parse`] when either field is missing or invalid.
fn parse_wire_response(obj: &Map<String, Value>) -> RunnerResult<WireResponse> {
    let body = match obj.get("body") {
        Some(value) => value.clone(),
        None => {
            return Err(RunnerError::Parse(
                "wire.response.body is required".to_owned(),
            ));
        }
    };
    Ok(WireResponse {
        status: require_i64(obj, "status")?,
        body,
    })
}

/// Requires `value` to be a JSON object.
///
/// # Arguments
///
/// * `value` - JSON value to narrow to an object map.
/// * `label` - Field name included in parse error messages (e.g. `"wire"`).
///
/// # Returns
///
/// A reference to the underlying object map, or [`RunnerError::Parse`] when `value` is not a JSON object.
fn as_object<'a>(value: &'a Value, label: &str) -> RunnerResult<&'a Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(RunnerError::Parse(format!("{label} must be an object"))),
    }
}

/// Reads a required object field from a JSON map.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the required nested object.
///
/// # Returns
///
/// A reference to the nested object map, or [`RunnerError::Parse`] when the field is missing or not an object.
fn require_object<'a>(
    obj: &'a Map<String, Value>,
    field: &str,
) -> RunnerResult<&'a Map<String, Value>> {
    match obj.get(field) {
        Some(value) => as_object(value, field),
        None => Err(RunnerError::Parse(format!(
            "missing required field: {field}"
        ))),
    }
}

/// Reads a required string field from a JSON map.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the required string field.
///
/// # Returns
///
/// The cloned string value, or [`RunnerError::Parse`] when the field is missing or not a JSON string.
fn require_string(obj: &Map<String, Value>, field: &str) -> RunnerResult<String> {
    match obj.get(field) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(RunnerError::Parse(format!("{field} must be a string"))),
        None => Err(RunnerError::Parse(format!(
            "missing required field: {field}"
        ))),
    }
}

/// Reads a required non-empty string field from a JSON map.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the required string field.
///
/// # Returns
///
/// The cloned non-empty string, or [`RunnerError::Parse`] when the field is missing, not a string, or empty.
fn require_nonempty_string(obj: &Map<String, Value>, field: &str) -> RunnerResult<String> {
    let value = require_string(obj, field)?;
    if value.is_empty() {
        return Err(RunnerError::Parse(format!(
            "{field} must be a non-empty string"
        )));
    }
    Ok(value)
}

/// Reads an optional non-empty string field from a JSON map.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the optional string field.
///
/// # Returns
///
/// `None` when the key is absent or JSON `null`; `Some(non-empty string)` when present, or [`RunnerError::Parse`] on wrong type or empty string.
fn optional_nonempty_string(obj: &Map<String, Value>, field: &str) -> RunnerResult<Option<String>> {
    match obj.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) if s.is_empty() => Err(RunnerError::Parse(format!(
            "{field} must be a non-empty string when present"
        ))),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(RunnerError::Parse(format!("{field} must be a string"))),
    }
}

/// Reads a required integer field from a JSON map.
///
/// Coerces JSON numbers to `i64`.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the required integer field.
///
/// # Returns
///
/// The integer value, or [`RunnerError::Parse`] when the field is missing, not a number, or not representable as `i64`.
fn require_i64(obj: &Map<String, Value>, field: &str) -> RunnerResult<i64> {
    match obj.get(field) {
        Some(Value::Number(n)) => n
            .as_i64()
            .ok_or_else(|| RunnerError::Parse(format!("{field} must be an integer"))),
        Some(_) => Err(RunnerError::Parse(format!("{field} must be an integer"))),
        None => Err(RunnerError::Parse(format!(
            "missing required field: {field}"
        ))),
    }
}

/// Reads an optional integer field from a JSON map.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the optional integer field.
///
/// # Returns
///
/// `None` when the key is absent or JSON `null`; `Some(i64)` when present, or [`RunnerError::Parse`] on wrong type or non-integer number.
fn optional_i64(obj: &Map<String, Value>, field: &str) -> RunnerResult<Option<i64>> {
    match obj.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Number(n)) => match n.as_i64() {
            Some(v) => Ok(Some(v)),
            None => Err(RunnerError::Parse(format!("{field} must be an integer"))),
        },
        Some(_) => Err(RunnerError::Parse(format!("{field} must be an integer"))),
    }
}

/// Reads an optional string-to-string map from a JSON object field.
///
/// # Arguments
///
/// * `obj` - Parent JSON object map.
/// * `field` - Key name of the optional map field (e.g. `query` or `headers`).
///
/// # Returns
///
/// `None` when the key is absent or JSON `null`; `Some(BTreeMap)` when present, or [`RunnerError::Parse`] when the value is not an object or contains non-string values.
fn optional_string_map(
    obj: &Map<String, Value>,
    field: &str,
) -> RunnerResult<Option<BTreeMap<String, String>>> {
    match obj.get(field) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::Object(map)) => {
            let mut out = BTreeMap::new();
            for (key, value) in map {
                match value {
                    Value::String(s) => {
                        out.insert(key.clone(), s.clone());
                    }
                    _ => {
                        return Err(RunnerError::Parse(format!(
                            "{field}.{key} must be a string"
                        )));
                    }
                }
            }
            Ok(Some(out))
        }
        Some(_) => Err(RunnerError::Parse(format!("{field} must be an object"))),
    }
}
