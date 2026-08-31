use std::collections::BTreeMap;

use serde_json::{json, Value};
use solvapay::SdkError;

/// Incoming HTTP request for [`crate::McpHttpServer::handle`].
#[derive(Debug, Clone)]
pub struct McpHttpRequest {
    /// HTTP method (`GET`, `POST`, …).
    pub method: String,
    /// Path including optional query string.
    pub path: String,
    /// Headers keyed in lowercase.
    pub headers: BTreeMap<String, String>,
    /// Raw body.
    pub body: Vec<u8>,
}

/// Outgoing HTTP response from [`crate::McpHttpServer::handle`].
#[derive(Debug, Clone)]
pub struct McpHttpResponse {
    /// Status code.
    pub status: u16,
    /// Response headers.
    pub headers: BTreeMap<String, String>,
    /// Response body.
    pub body: Vec<u8>,
}

pub fn envelope_status(envelope: &Value, default: u16) -> u16 {
    envelope
        .get("status")
        .and_then(Value::as_u64)
        .unwrap_or(u64::from(default)) as u16
}

pub fn string_headers(value: Option<&Value>) -> BTreeMap<String, String> {
    let mut headers = BTreeMap::new();
    let Some(Value::Object(map)) = value else {
        return headers;
    };
    for (key, val) in map {
        if let Some(text) = val.as_str() {
            headers.insert(key.to_ascii_lowercase(), text.to_owned());
        }
    }
    headers
}

pub fn http_from_oauth_envelope(envelope: &Value) -> Result<McpHttpResponse, SdkError> {
    Ok(McpHttpResponse {
        status: envelope_status(envelope, 500),
        headers: string_headers(envelope.get("headers")),
        body: encode_json_body(envelope.get("body").cloned().unwrap_or(Value::Null))?,
    })
}

pub fn jsonrpc_error(
    id: Value,
    code: i32,
    message: &str,
    status: u16,
) -> Result<McpHttpResponse, SdkError> {
    json_response(
        status,
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": { "code": code, "message": message }
        }),
    )
}

pub fn json_response(status: u16, body: Value) -> Result<McpHttpResponse, SdkError> {
    let mut headers = BTreeMap::new();
    headers.insert("content-type".to_owned(), "application/json".to_owned());
    Ok(McpHttpResponse {
        status,
        headers,
        body: encode_json_body(body)?,
    })
}

pub fn encode_json_body(body: Value) -> Result<Vec<u8>, SdkError> {
    if body.is_null() {
        return Ok(Vec::new());
    }
    if let Some(text) = body.as_str() {
        return Ok(text.as_bytes().to_vec());
    }
    serde_json::to_vec(&body)
        .map_err(|err| SdkError::transport(format!("serialize response body: {err}"), false))
}
