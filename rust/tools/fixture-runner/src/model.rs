//! §5.3 golden-fixture model (mirrors scripts/lib/fixture-schema.ts).

use serde_json::{Map, Value};
use std::collections::BTreeMap;

use crate::error::{RunnerError, RunnerResult};

/// HTTP methods accepted on `wire.request.method`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
}

impl HttpMethod {
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

#[derive(Debug, Clone, PartialEq)]
pub struct FixtureErrorExpect {
    pub name: Option<String>,
    pub message: String,
    pub status: Option<i64>,
    pub kind: Option<String>,
    pub code: Option<String>,
}

/// Exactly one of `result` or `error` — enforced by [`FixtureExpect::try_new`].
#[derive(Debug, Clone, PartialEq)]
pub enum FixtureExpect {
    Result(Value),
    Error(FixtureErrorExpect),
}

#[derive(Debug, Clone, PartialEq)]
pub struct WireRequest {
    pub method: HttpMethod,
    pub path: String,
    pub query: Option<BTreeMap<String, String>>,
    pub headers: Option<BTreeMap<String, String>>,
    pub body: Option<Value>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct WireResponse {
    pub status: i64,
    pub body: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Wire {
    pub request: WireRequest,
    pub response: WireResponse,
}

#[derive(Debug, Clone, PartialEq)]
pub struct FixtureInput {
    pub fn_name: String,
    pub args: BTreeMap<String, Value>,
    /// ISO-8601 clock string — kept as `String` (no chrono; §7.2).
    pub clock: Option<String>,
    pub rng_seed: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Fixture {
    pub suite: String,
    pub case: String,
    pub input: FixtureInput,
    pub wire: Option<Wire>,
    pub expect: FixtureExpect,
}

impl FixtureExpect {
    /// Exactly one of `result` / `error` (TS `superRefine` rule).
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

/// Parse and validate a §5.3 fixture from a JSON value.
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

fn parse_expect(obj: &Map<String, Value>) -> RunnerResult<FixtureExpect> {
    // Key presence (including `result: null`) matches Zod `hasOwnProperty` semantics.
    let result = obj.get("result").cloned();
    let error = match obj.get("error") {
        None => None,
        Some(err_val) => Some(parse_fixture_error(as_object(err_val, "expect.error")?)?),
    };
    FixtureExpect::try_new(result, error)
}

fn parse_fixture_error(obj: &Map<String, Value>) -> RunnerResult<FixtureErrorExpect> {
    Ok(FixtureErrorExpect {
        name: optional_nonempty_string(obj, "name")?,
        message: require_string(obj, "message")?,
        status: optional_i64(obj, "status")?,
        kind: optional_nonempty_string(obj, "kind")?,
        code: optional_nonempty_string(obj, "code")?,
    })
}

fn parse_wire(obj: &Map<String, Value>) -> RunnerResult<Wire> {
    Ok(Wire {
        request: parse_wire_request(require_object(obj, "request")?)?,
        response: parse_wire_response(require_object(obj, "response")?)?,
    })
}

fn parse_wire_request(obj: &Map<String, Value>) -> RunnerResult<WireRequest> {
    Ok(WireRequest {
        method: HttpMethod::parse(&require_nonempty_string(obj, "method")?)?,
        path: require_nonempty_string(obj, "path")?,
        query: optional_string_map(obj, "query")?,
        headers: optional_string_map(obj, "headers")?,
        body: obj.get("body").cloned(),
    })
}

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

fn as_object<'a>(value: &'a Value, label: &str) -> RunnerResult<&'a Map<String, Value>> {
    match value {
        Value::Object(map) => Ok(map),
        _ => Err(RunnerError::Parse(format!("{label} must be an object"))),
    }
}

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

fn require_string(obj: &Map<String, Value>, field: &str) -> RunnerResult<String> {
    match obj.get(field) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(RunnerError::Parse(format!("{field} must be a string"))),
        None => Err(RunnerError::Parse(format!(
            "missing required field: {field}"
        ))),
    }
}

fn require_nonempty_string(obj: &Map<String, Value>, field: &str) -> RunnerResult<String> {
    let value = require_string(obj, field)?;
    if value.is_empty() {
        return Err(RunnerError::Parse(format!(
            "{field} must be a non-empty string"
        )));
    }
    Ok(value)
}

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
