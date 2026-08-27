//! Stateless JSON-RPC engine (`mcpHandleRequest` / `mcpResume`).

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};

use serde::Deserialize;
use serde_json::{json, Value};
use solvapay_core::{paywall_tool_result, PaywallGate};
use uuid::Uuid;

use crate::auth_gate::{mcp_auth_gate, AuthGateInput, AuthGateResult, McpAuthMode};
use crate::descriptors::{mcp_descriptors, McpDescriptorsInput};
use crate::hide_tools::{mcp_hide_tools_by_audience, HideToolsInput};
use crate::oauth::mcp_resource_identifier;

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
    /// Payable tool names hosted by the merchant (not builtins).
    #[serde(default)]
    pub payable_tools: Vec<String>,
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
        "notifications/initialized" | "ping" => Ok(rpc_ok(id, json!({}))),
        "tools/list" => {
            let desc = descriptors_for(&input.config)?;
            let tools: Vec<Value> = desc
                .tools
                .iter()
                .map(|t| {
                    with_legacy_ui_meta(json!({
                        "name": t.name,
                        "title": t.title,
                        "description": t.description,
                        "inputSchema": t.input_schema,
                        "annotations": t.annotations,
                        "_meta": t.meta,
                    }))
                })
                .collect();
            let filtered = mcp_hide_tools_by_audience(&HideToolsInput {
                tools,
                audiences: input.config.hide_audiences.clone().unwrap_or_default(),
                user_agent: input.config.user_agent.clone(),
            });
            Ok(rpc_ok(
                id,
                json!({ "tools": filtered.get("tools").cloned().unwrap_or(Value::Array(Vec::new())) }),
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
            if input.config.payable_tools.iter().any(|n| n == name) {
                let token = Uuid::new_v4().to_string();
                let customer_ref = customer_ref_from_header(input.auth_header.as_deref());
                match store().lock() {
                    Ok(mut map) => {
                        map.insert(token.clone(), Continuation { rpc_id: id.clone() });
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
            Ok(rpc_ok(
                id,
                json!({
                    "resources": [desc.docs, desc.bootstrap, ui]
                }),
            ))
        }
        "prompts/list" => {
            let desc = descriptors_for(&input.config)?;
            Ok(rpc_ok(id, json!({ "prompts": desc.prompts })))
        }
        "resources/read" => {
            let uri = input
                .rpc
                .pointer("/params/uri")
                .and_then(Value::as_str)
                .unwrap_or("");
            if uri == "docs://solvapay/overview.md" {
                let overview = crate::overview::mcp_overview_resource();
                return Ok(rpc_ok(
                    id,
                    json!({
                        "contents": [{
                            "uri": overview.uri,
                            "mimeType": overview.mime_type,
                            "text": overview.body
                        }]
                    }),
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
            Ok(rpc_ok(
                id,
                json!({
                    "messages": prompt
                }),
            ))
        }
        other => Err(format!("unsupported method: {other}")),
    }
}

/// Resume after the host ran a payable handler.
pub fn mcp_resume(input: &ResumeInput) -> Result<Value, String> {
    let id = match store().lock() {
        Ok(mut map) => map
            .remove(&input.token)
            .map(|c| c.rpc_id)
            .unwrap_or(Value::Null),
        Err(_) => Value::Null,
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
        return Ok(rpc_ok(id, result_json));
    }
    Ok(rpc_ok(id, input.handler_envelope.clone()))
}
