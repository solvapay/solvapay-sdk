//! Stateless JSON-RPC engine (`mcpHandleRequest` / `mcpResume`).

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use solvapay_core::{paywall_tool_result, PaywallGate};
use uuid::Uuid;

use crate::auth_gate::{mcp_auth_gate, AuthGateInput, AuthGateResult, McpAuthMode};
use crate::descriptors::{mcp_descriptors, McpDescriptorsInput};
use crate::hide_tools::{mcp_hide_tools_by_audience, HideToolsInput};
use crate::oauth::mcp_resource_identifier;

/// Catalog TTL matching `defaultCatalogTTLMs` in `sdks/go/mcp/server.go`.
pub const CATALOG_TTL_MS: u64 = 60_000;

/// Dual-era versions the engine implements. `2025-06-18` is pinned by
/// `contract/mcp-fixtures/engine/initialize.json` — do not advertise `2025-11-25`.
pub const SUPPORTED_VERSIONS: [&str; 2] = ["2026-07-28", "2025-06-18"];

const PROTOCOL_VERSION_PTR: &str = "/params/_meta/io.modelcontextprotocol~1protocolVersion";
const CLIENT_CAPABILITIES_PTR: &str = "/params/_meta/io.modelcontextprotocol~1clientCapabilities";

/// `None` = legacy era (no envelope claim); `Some(v)` = modern claim.
#[must_use]
pub fn envelope_version(rpc: &Value) -> Option<&str> {
    rpc.pointer(PROTOCOL_VERSION_PTR).and_then(Value::as_str)
}

/// True when the request carries a per-request `_meta` protocol version.
#[must_use]
pub fn is_modern_era(rpc: &Value) -> bool {
    envelope_version(rpc).is_some()
}

fn server_info() -> Value {
    json!({
        "name": "solvapay-mcp",
        "version": env!("CARGO_PKG_VERSION"),
    })
}

/// Stamp `resultType` + `io.modelcontextprotocol/serverInfo` on a modern result.
pub fn stamp_complete_result(result: &mut Value) {
    if let Value::Object(map) = result {
        map.insert("resultType".to_owned(), json!("complete"));
        let meta = map.entry("_meta").or_insert_with(|| json!({}));
        if let Value::Object(meta_map) = meta {
            meta_map.insert(
                "io.modelcontextprotocol/serverInfo".to_owned(),
                server_info(),
            );
        }
    }
}

/// Stamp the SEP-2549 catalog cache fields plus the complete envelope.
pub fn stamp_catalog_result(result: &mut Value) {
    stamp_complete_result(result);
    if let Value::Object(map) = result {
        map.insert("ttlMs".to_owned(), json!(CATALOG_TTL_MS));
        map.insert("cacheScope".to_owned(), json!("public"));
    }
}

/// Merchant payable entry in [`EngineConfig::payable_tools`].
///
/// A bare string is dispatch-only (`tools/call` routing); the host owns
/// `tools/list`. An object is routed **and** advertised in `tools/list`.
#[derive(Debug, Clone, Deserialize)]
#[serde(untagged)]
pub enum PayableToolConfig {
    /// Name-only: route `tools/call`, do not advertise.
    Name(String),
    /// Full descriptor: route and advertise.
    Spec(Box<PayableToolSpec>),
}

impl PayableToolConfig {
    /// Tool name used for `tools/call` routing.
    #[must_use]
    pub fn name(&self) -> &str {
        match self {
            Self::Name(name) => name.as_str(),
            Self::Spec(spec) => spec.name.as_str(),
        }
    }
}

/// Descriptor advertised when a host sends an object-form payable tool.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PayableToolSpec {
    /// MCP tool name.
    pub name: String,
    /// Optional title (defaults to `name` when advertised).
    #[serde(default)]
    pub title: Option<String>,
    /// Optional description.
    #[serde(default)]
    pub description: Option<String>,
    /// Optional JSON Schema (defaults to an empty object schema).
    #[serde(default)]
    pub input_schema: Option<Value>,
    /// Optional MCP annotations. Omitted from `tools/list` when absent.
    #[serde(default)]
    pub annotations: Option<Value>,
    /// Optional `_meta`. Omitted from `tools/list` when absent.
    #[serde(default, rename = "_meta")]
    pub meta: Option<Value>,
}

/// Engine server config.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EngineConfig {
    /// Product ref.
    pub product_ref: String,
    /// Public origin.
    pub public_base_url: String,
    /// UI resource URI.
    pub resource_uri: String,
    /// Views.
    #[serde(default)]
    pub views: Option<Vec<String>>,
    /// Merchant payables: bare names route only; objects also appear in `tools/list`.
    #[serde(default)]
    pub payable_tools: Vec<PayableToolConfig>,
    /// Auth mode.
    #[serde(default)]
    pub auth_mode: Option<McpAuthMode>,
    /// Optional MCP mount path for OAuth resource identifiers.
    #[serde(default)]
    pub mcp_path: Option<String>,
    /// Audiences to hide from `tools/list` (e.g. `["ui"]`).
    #[serde(default)]
    pub hide_audiences: Option<Vec<String>>,
    /// User-Agent used by audience filtering (ChatGPT bypass).
    #[serde(default)]
    pub user_agent: Option<String>,
    /// Optional CSP overrides forwarded to [`mcp_descriptors`].
    #[serde(default)]
    pub csp: Option<crate::csp::SolvaPayMcpCsp>,
    /// Optional API origin for CSP auto-include.
    #[serde(default)]
    pub api_base_url: Option<String>,
    /// Optional branding forwarded to [`mcp_descriptors`].
    #[serde(default)]
    pub branding: Option<crate::descriptors::BrandingIn>,
}

/// Input for [`mcp_handle_request`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HandleRequestInput {
    /// JSON-RPC request object.
    pub rpc: Value,
    /// Engine config.
    pub config: EngineConfig,
    /// Optional Authorization header.
    #[serde(default)]
    pub auth_header: Option<String>,
    /// Optional `MCP-Protocol-Version` HTTP header (hosts forward this).
    #[serde(default)]
    pub mcp_protocol_version_header: Option<String>,
}

/// Input for [`mcp_resume`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResumeInput {
    /// Continuation token from `invokeHandler`.
    pub token: String,
    /// Host handler outcome.
    pub handler_envelope: Value,
}

struct Continuation {
    rpc_id: Value,
    modern: bool,
}

fn store() -> &'static Mutex<HashMap<String, Continuation>> {
    static STORE: OnceLock<Mutex<HashMap<String, Continuation>>> = OnceLock::new();
    STORE.get_or_init(|| Mutex::new(HashMap::new()))
}

fn customer_ref_from_header(auth_header: Option<&str>) -> Option<String> {
    let header = auth_header?;
    let token = header
        .strip_prefix("Bearer ")
        .or_else(|| header.strip_prefix("bearer "))?;
    let mut parts = token.split('.');
    let _h = parts.next()?;
    let payload_b64 = parts.next()?;
    let json = base64url_decode(payload_b64)?;
    let payload: Value = serde_json::from_str(&json).ok()?;
    for claim in ["customerRef", "customer_ref", "sub"] {
        if let Some(s) = payload.get(claim).and_then(Value::as_str) {
            let trimmed = s.trim();
            if !trimmed.is_empty() {
                return Some(trimmed.to_owned());
            }
        }
    }
    None
}

fn base64url_decode(input: &str) -> Option<String> {
    let mut s = input.replace('-', "+").replace('_', "/");
    while !s.len().is_multiple_of(4) {
        s.push('=');
    }
    let bytes = base64_decode(&s)?;
    String::from_utf8(bytes).ok()
}

fn base64_decode(input: &str) -> Option<Vec<u8>> {
    const TABLE: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = Vec::new();
    let mut buf = 0u32;
    let mut n = 0u32;
    for &c in input.as_bytes() {
        if c == b'=' {
            break;
        }
        let pos = TABLE.iter().position(|&x| x == c)?;
        buf = (buf << 6) | pos as u32;
        n += 6;
        if n >= 8 {
            n -= 8;
            out.push((buf >> n) as u8);
        }
    }
    Some(out)
}

fn rpc_ok(id: Value, result: Value) -> Value {
    json!({ "kind": "rpc", "rpc": { "jsonrpc": "2.0", "id": id, "result": result } })
}

fn rpc_err(id: Value, code: i32, message: &str, data: Option<Value>, status: u16) -> Value {
    let mut err = json!({ "code": code, "message": message });
    if let Some(data) = data {
        err["data"] = data;
    }
    let mut out = json!({ "kind": "rpc", "rpc": { "jsonrpc": "2.0", "id": id, "error": err } });
    if status != 200 {
        out["status"] = json!(status);
    }
    out
}

fn rpc_result(id: Value, mut result: Value, modern: bool, catalog: bool) -> Value {
    if modern {
        if catalog {
            stamp_catalog_result(&mut result);
        } else {
            stamp_complete_result(&mut result);
        }
    }
    rpc_ok(id, result)
}

fn classify_era(rpc: &Value, header: Option<&str>) -> Result<bool, Value> {
    let Some(requested) = envelope_version(rpc) else {
        return Ok(false);
    };
    let id = rpc.get("id").cloned().unwrap_or(Value::Null);
    if let Some(header) = header {
        let trimmed = header.trim();
        if !trimmed.is_empty() && trimmed != requested {
            return Err(rpc_err(
                id,
                -32020,
                "Header mismatch",
                Some(json!({ "header": trimmed, "requested": requested })),
                400,
            ));
        }
    }
    if !SUPPORTED_VERSIONS.contains(&requested) {
        return Err(rpc_err(
            id,
            -32022,
            "Unsupported protocol version",
            Some(json!({
                "supported": SUPPORTED_VERSIONS,
                "requested": requested,
            })),
            400,
        ));
    }
    if rpc.pointer(CLIENT_CAPABILITIES_PTR).is_none() {
        return Err(rpc_err(id, -32602, "Invalid params", None, 400));
    }
    Ok(true)
}

fn method_not_found(rpc: &Value, method: &str, modern: bool) -> Value {
    match rpc.get("id") {
        None => json!({ "kind": "rpc" }),
        Some(id) => rpc_err(
            id.clone(),
            -32601,
            &format!("Method not found: {method}"),
            None,
            if modern { 404 } else { 200 },
        ),
    }
}

fn descriptors_for(config: &EngineConfig) -> Result<crate::descriptors::McpDescriptors, String> {
    mcp_descriptors(&McpDescriptorsInput {
        resource_uri: config.resource_uri.clone(),
        public_base_url: config.public_base_url.clone(),
        product_ref: config.product_ref.clone(),
        views: config.views.clone(),
        csp: config.csp.clone(),
        api_base_url: config.api_base_url.clone(),
        branding: config.branding.clone(),
    })
}

fn payable_list_item(spec: &PayableToolSpec) -> Value {
    let title = spec
        .title
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(spec.name.as_str());
    let input_schema = spec
        .input_schema
        .clone()
        .unwrap_or_else(|| json!({ "type": "object", "properties": {} }));
    let mut item = json!({
        "name": spec.name,
        "title": title,
        "inputSchema": input_schema,
    });
    if let Some(description) = &spec.description {
        item["description"] = json!(description);
    }
    if let Some(annotations) = &spec.annotations {
        item["annotations"] = annotations.clone();
    }
    if let Some(meta) = &spec.meta {
        item["_meta"] = meta.clone();
    }
    with_legacy_ui_meta(item)
}

fn merge_payable_specs(tools: &mut Vec<Value>, payable_tools: &[PayableToolConfig]) {
    let existing: HashSet<String> = tools
        .iter()
        .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_owned))
        .collect();
    for entry in payable_tools {
        let PayableToolConfig::Spec(spec) = entry else {
            continue;
        };
        if spec.name.is_empty() || existing.contains(&spec.name) {
            continue;
        }
        tools.push(payable_list_item(spec));
    }
}

fn tool_list_item(tool: &crate::descriptors::McpToolDescriptor) -> Value {
    let title = tool
        .title
        .as_deref()
        .filter(|s| !s.is_empty())
        .unwrap_or(tool.name.as_str());
    with_legacy_ui_meta(json!({
        "name": tool.name,
        "title": title,
        "description": tool.description,
        "inputSchema": tool.input_schema,
        "annotations": tool.annotations,
        "_meta": tool.meta,
    }))
}

fn with_legacy_ui_meta(mut tool: Value) -> Value {
    if let Some(meta) = tool.get_mut("_meta") {
        let uri = meta
            .get("ui")
            .and_then(|ui| ui.get("resourceUri"))
            .and_then(Value::as_str)
            .map(str::to_owned);
        if let Some(uri) = uri {
            if meta.get("ui/resourceUri").is_none() {
                meta["ui/resourceUri"] = json!(uri);
            }
        }
    }
    tool
}

/// Route one JSON-RPC request.
pub fn mcp_handle_request(input: &HandleRequestInput) -> Result<Value, String> {
    let method = input
        .rpc
        .get("method")
        .and_then(Value::as_str)
        .unwrap_or("");
    let id = input.rpc.get("id").cloned().unwrap_or(Value::Null);
    let gate = mcp_auth_gate(&AuthGateInput {
        rpc_method: Some(method.to_owned()),
        auth_header: input.auth_header.clone(),
        auth_mode: input.config.auth_mode,
        public_base_url: input.config.public_base_url.clone(),
        mcp_path: input.config.mcp_path.clone(),
        json_rpc_id: Some(id.clone()),
    });
    if let AuthGateResult::Challenge {
        status,
        headers,
        body,
    } = gate
    {
        return Ok(
            json!({ "kind": "challenge", "status": status, "headers": headers, "body": body }),
        );
    }

    let modern = match classify_era(&input.rpc, input.mcp_protocol_version_header.as_deref()) {
        Ok(modern) => modern,
        Err(err) => return Ok(err),
    };

    match method {
        "initialize" => {
            let proto = input
                .rpc
                .pointer("/params/protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or("2025-06-18");
            Ok(rpc_ok(
                id,
                json!({
                            "protocolVersion": proto,
                            "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
                "serverInfo": { "name": "solvapay-mcp", "version": env!("CARGO_PKG_VERSION") },
                        }),
            ))
        }
        "server/discover" => {
            let mut result = json!({
                "supportedVersions": SUPPORTED_VERSIONS,
                "capabilities": { "tools": {}, "resources": {}, "prompts": {} },
            });
            stamp_complete_result(&mut result);
            if let Value::Object(map) = &mut result {
                map.insert("ttlMs".to_owned(), json!(0));
                map.insert("cacheScope".to_owned(), json!("public"));
            }
            Ok(rpc_ok(id, result))
        }
        "subscriptions/listen" => Ok(rpc_ok(
            id.clone(),
            json!({
                "_meta": { "io.modelcontextprotocol/subscriptionId": id },
                "resultType": "complete",
            }),
        )),
        "notifications/initialized" => Ok(rpc_ok(id, json!({}))),
        "ping" if !modern => Ok(rpc_ok(id, json!({}))),
        "tools/list" => {
            let desc = descriptors_for(&input.config)?;
            let mut tools: Vec<Value> = desc.tools.iter().map(tool_list_item).collect();
            merge_payable_specs(&mut tools, &input.config.payable_tools);
            let filtered = mcp_hide_tools_by_audience(&HideToolsInput {
                tools,
                audiences: input.config.hide_audiences.clone().unwrap_or_default(),
                user_agent: input.config.user_agent.clone(),
            });
            Ok(rpc_result(
                id,
                json!({ "tools": filtered.get("tools").cloned().unwrap_or(Value::Array(Vec::new())) }),
                modern,
                true,
            ))
        }
        "tools/call" => {
            let name = input
                .rpc
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let args = input
                .rpc
                .pointer("/params/arguments")
                .cloned()
                .unwrap_or(json!({}));
            if input.config.payable_tools.iter().any(|t| t.name() == name) {
                let token = Uuid::new_v4().to_string();
                let customer_ref = customer_ref_from_header(input.auth_header.as_deref());
                match store().lock() {
                    Ok(mut map) => {
                        map.insert(
                            token.clone(),
                            Continuation {
                                rpc_id: id.clone(),
                                modern,
                            },
                        );
                    }
                    Err(_) => return Err("continuation store poisoned".to_owned()),
                }
                return Ok(json!({
                    "kind": "invokeHandler",
                    "token": token,
                    "tool": name,
                    "args": args,
                    "customerRef": customer_ref,
                }));
            }
            Ok(json!({
                "kind": "callBuiltin",
                "name": name,
                "args": args,
                "customerRef": customer_ref_from_header(input.auth_header.as_deref()),
                "rpcId": id,
            }))
        }
        "resources/list" => {
            let origin = mcp_resource_identifier(&input.config.public_base_url, None);
            let _ = origin;
            let desc = descriptors_for(&input.config)?;
            let mut ui = desc.resource.clone();
            if ui.get("name").is_none() {
                ui["name"] = json!("SolvaPay UI");
            }
            ui["_meta"] = json!({
                "ui": {
                    "csp": desc.csp,
                    "prefersBorder": false
                }
            });
            Ok(rpc_result(
                id,
                json!({
                    "resources": [desc.docs, desc.bootstrap, ui]
                }),
                modern,
                true,
            ))
        }
        "prompts/list" => {
            let desc = descriptors_for(&input.config)?;
            Ok(rpc_result(
                id,
                json!({ "prompts": desc.prompts }),
                modern,
                true,
            ))
        }
        "resources/read" => {
            let uri = input
                .rpc
                .pointer("/params/uri")
                .and_then(Value::as_str)
                .unwrap_or("");
            if uri == "docs://solvapay/overview.md" {
                let overview = crate::overview::mcp_overview_resource();
                return Ok(rpc_result(
                    id,
                    json!({
                        "contents": [{
                            "uri": overview.uri,
                            "mimeType": overview.mime_type,
                            "text": overview.body
                        }]
                    }),
                    modern,
                    true,
                ));
            }
            Ok(json!({
                "kind": "readResource",
                "uri": uri,
                "rpcId": id,
            }))
        }
        "prompts/get" => {
            let name = input
                .rpc
                .pointer("/params/name")
                .and_then(Value::as_str)
                .unwrap_or("");
            let desc = descriptors_for(&input.config)?;
            let prompt = desc.prompts.iter().find(|p| p.name == name);
            Ok(rpc_result(
                id,
                json!({
                    "messages": prompt
                }),
                modern,
                false,
            ))
        }
        other => Ok(method_not_found(&input.rpc, other, modern)),
    }
}

/// Resume after the host ran a payable handler.
pub fn mcp_resume(input: &ResumeInput) -> Result<Value, String> {
    let (id, modern) = match store().lock() {
        Ok(mut map) => map
            .remove(&input.token)
            .map(|c| (c.rpc_id, c.modern))
            .unwrap_or((Value::Null, false)),
        Err(_) => (Value::Null, false),
    };
    if input.handler_envelope.get("kind").and_then(Value::as_str) == Some("gate") {
        let gate_value = input
            .handler_envelope
            .get("gate")
            .cloned()
            .ok_or_else(|| "missing gate".to_owned())?;
        let gate: PaywallGate =
            serde_json::from_value(gate_value).map_err(|err| err.to_string())?;
        let result = paywall_tool_result(&gate.message, &gate);
        let result_json = serde_json::to_value(result).map_err(|err| err.to_string())?;
        return Ok(rpc_result(id, result_json, modern, false));
    }
    Ok(rpc_result(
        id,
        input.handler_envelope.clone(),
        modern,
        false,
    ))
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;

    fn config() -> EngineConfig {
        EngineConfig {
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            resource_uri: "ui://test/view.html".to_owned(),
            views: None,
            payable_tools: Vec::new(),
            auth_mode: None,
            mcp_path: None,
            hide_audiences: None,
            user_agent: None,
            csp: None,
            api_base_url: None,
            branding: None,
        }
    }

    fn handle_from_json(value: Value) -> Value {
        let input: HandleRequestInput = serde_json::from_value(value).expect("input");
        mcp_handle_request(&input).expect("handle")
    }

    fn list_rpc(payable_tools: Value) -> Vec<Value> {
        let got = handle_from_json(json!({
            "rpc": {
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            },
            "config": {
                "productRef": "prd_demo",
                "publicBaseUrl": "https://app.example.com",
                "resourceUri": "ui://test/view.html",
                "payableTools": payable_tools
            }
        }));
        got["rpc"]["result"]["tools"].as_array().unwrap().clone()
    }

    fn call_rpc(payable_tools: Value) -> Value {
        handle_from_json(json!({
            "rpc": {
                "jsonrpc": "2.0",
                "id": 2,
                "method": "tools/call",
                "params": { "name": "echo_paid", "arguments": { "n": 1 } }
            },
            "config": {
                "productRef": "prd_demo",
                "publicBaseUrl": "https://app.example.com",
                "resourceUri": "ui://test/view.html",
                "payableTools": payable_tools
            },
            "authHeader": "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9."
        }))
    }

    fn payable_spec_json() -> Value {
        json!({
            "name": "echo_paid",
            "title": "Echo paid",
            "description": "Echo arguments after a paid gate",
            "inputSchema": {
                "type": "object",
                "properties": { "n": { "type": "number" } }
            }
        })
    }

    #[test]
    fn tools_list_includes_payable_spec_title_and_schema() {
        let tools = list_rpc(json!([payable_spec_json()]));
        let echo = tools
            .iter()
            .find(|t| t["name"] == "echo_paid")
            .expect("payable advertised");
        assert_eq!(echo["title"], "Echo paid");
        assert_eq!(echo["description"], "Echo arguments after a paid gate");
        assert_eq!(
            echo["inputSchema"],
            json!({ "type": "object", "properties": { "n": { "type": "number" } } })
        );
        assert!(echo.get("annotations").is_none());
        assert!(echo.get("_meta").is_none());
    }

    #[test]
    fn tools_list_omits_bare_payable_name() {
        let tools = list_rpc(json!(["echo_paid"]));
        assert!(tools.iter().all(|t| t["name"] != "echo_paid"));
    }

    #[test]
    fn tools_call_routes_spec_and_bare_name() {
        let spec_call = call_rpc(json!([payable_spec_json()]));
        assert_eq!(spec_call["kind"], "invokeHandler");
        assert_eq!(spec_call["tool"], "echo_paid");

        let name_call = call_rpc(json!(["echo_paid"]));
        assert_eq!(name_call["kind"], "invokeHandler");
        assert_eq!(name_call["tool"], "echo_paid");
    }

    #[test]
    fn header_mismatch_returns_32020() {
        let input = HandleRequestInput {
            rpc: json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {}
                    }
                }
            }),
            config: config(),
            auth_header: None,
            mcp_protocol_version_header: Some("2025-06-18".to_owned()),
        };
        let got = mcp_handle_request(&input).expect("handle");
        assert_eq!(got["status"], 400);
        assert_eq!(got["rpc"]["error"]["code"], -32020);
    }
}
