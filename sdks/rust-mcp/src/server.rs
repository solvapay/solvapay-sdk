//! Engine-driven HTTP adapter: `mcpDispatch` / `mcpOauthRequest` / `mcpResume`.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::{BTreeMap, HashMap};

use rmcp::model::JsonObject;
use serde_json::{json, Map, Value};
use solvapay::transport::{McpDispatchParams, McpOauthConfig, McpOauthRequestParams};
use solvapay::{Client, SdkError};
use solvapay_mcp_core::EngineConfig;

use crate::register::{
    invoke_payable, GetCustomerRef, PayableError, PayableHandler, PayableTool,
};
use crate::call_sync;

/// Incoming HTTP request for [`McpHttpServer::handle`].
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

/// Outgoing HTTP response from [`McpHttpServer::handle`].
#[derive(Debug, Clone)]
pub struct McpHttpResponse {
    /// Status code.
    pub status: u16,
    /// Response headers.
    pub headers: BTreeMap<String, String>,
    /// Response body.
    pub body: Vec<u8>,
}

/// Public origin / product settings for the engine.
#[derive(Debug, Clone)]
pub struct McpHttpConfig {
    /// Product ref served by this MCP.
    pub product_ref: String,
    /// Public origin used in OAuth metadata.
    pub public_base_url: String,
    /// UI resource URI (defaults to `ui://widget.html`).
    pub resource_uri: Option<String>,
    /// MCP mount path (defaults to `/mcp`).
    pub mcp_path: Option<String>,
    /// Descriptor views.
    pub views: Option<Vec<String>>,
    /// Optional OAuth path overrides forwarded to `mcpOauthRequest`.
    pub oauth_paths: Option<solvapay_mcp_core::OauthPaths>,
}

struct RegisteredPayable {
    product: String,
    usage_type: String,
    handler: PayableHandler,
    get_customer_ref: Option<GetCustomerRef>,
}

/// Thin host: OAuth via `mcpOauthRequest`, `/mcp` via `mcpDispatch`.
pub struct McpHttpServer {
    client: Client,
    product_ref: String,
    public_base_url: String,
    resource_uri: String,
    mcp_path: String,
    views: Option<Vec<String>>,
    oauth_paths: Option<solvapay_mcp_core::OauthPaths>,
    payables: HashMap<String, RegisteredPayable>,
}

impl McpHttpServer {
    /// Bind a SolvaPay client to one MCP origin.
    #[must_use]
    pub fn new(client: Client, config: McpHttpConfig) -> Self {
        let mcp_path = config
            .mcp_path
            .filter(|p| !p.is_empty())
            .unwrap_or_else(|| "/mcp".to_owned());
        Self {
            client,
            product_ref: config.product_ref,
            public_base_url: config.public_base_url,
            resource_uri: config
                .resource_uri
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| "ui://widget.html".to_owned()),
            mcp_path,
            views: config.views,
            oauth_paths: config.oauth_paths,
            payables: HashMap::new(),
        }
    }

    /// Register a merchant payable tool. Names feed `EngineConfig.payableTools`.
    ///
    /// # Errors
    ///
    /// [`PayableError::Handler`] when name or product is empty.
    pub fn register_payable(
        &mut self,
        tool: PayableTool,
        handler: PayableHandler,
        get_customer_ref: Option<GetCustomerRef>,
    ) -> Result<(), PayableError> {
        if tool.name.is_empty() {
            return Err(PayableError::Handler("tool name is required".to_owned()));
        }
        if tool.product.is_empty() {
            return Err(PayableError::Handler("product is required".to_owned()));
        }
        let usage_type = tool
            .usage_type
            .clone()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "requests".to_owned());
        self.payables.insert(
            tool.name,
            RegisteredPayable {
                product: tool.product,
                usage_type,
                handler,
                get_customer_ref,
            },
        );
        Ok(())
    }

    /// Route one HTTP request.
    ///
    /// # Errors
    ///
    /// Transport / SDK failures from dispatch, OAuth, or the payable gate.
    pub async fn handle(&self, req: McpHttpRequest) -> Result<McpHttpResponse, SdkError> {
        let path_only = req.path.split('?').next().unwrap_or(req.path.as_str());
        if path_only != self.mcp_path {
            return self.handle_oauth(&req).await;
        }
        if !req.method.eq_ignore_ascii_case("POST") {
            let mut headers = BTreeMap::new();
            headers.insert("allow".to_owned(), "POST".to_owned());
            return Ok(McpHttpResponse {
                status: 405,
                headers,
                body: Vec::new(),
            });
        }
        self.handle_mcp(&req).await
    }

    async fn handle_oauth(&self, req: &McpHttpRequest) -> Result<McpHttpResponse, SdkError> {
        let body = String::from_utf8_lossy(&req.body).into_owned();
        let envelope = self
            .client
            .mcp_oauth_request(McpOauthRequestParams {
                method: req.method.clone(),
                path: req.path.clone(),
                headers: req.headers.clone(),
                body,
                config: McpOauthConfig {
                    public_base_url: self.public_base_url.clone(),
                    mcp_path: Some(self.mcp_path.clone()),
                    product_ref: self.product_ref.clone(),
                    oauth_paths: self.oauth_paths.clone(),
                },
            })
            .await?;
        http_from_oauth_envelope(&envelope)
    }

    async fn handle_mcp(&self, req: &McpHttpRequest) -> Result<McpHttpResponse, SdkError> {
        let rpc: Value = serde_json::from_slice(&req.body)
            .map_err(|err| SdkError::transport(format!("invalid JSON-RPC body: {err}"), false))?;
        let mut payable_tools: Vec<String> = self.payables.keys().cloned().collect();
        payable_tools.sort();
        let envelope = self
            .client
            .mcp_dispatch(McpDispatchParams {
                rpc,
                config: EngineConfig {
                    product_ref: self.product_ref.clone(),
                    public_base_url: self.public_base_url.clone(),
                    resource_uri: self.resource_uri.clone(),
                    views: self.views.clone(),
                    payable_tools,
                    auth_mode: None,
                    mcp_path: Some(self.mcp_path.clone()),
                    hide_audiences: None,
                    user_agent: req.headers.get("user-agent").cloned(),
                    csp: None,
                    api_base_url: None,
                    branding: None,
                },
                auth_header: req.headers.get("authorization").cloned(),
            })
            .await?;
        match envelope.get("kind").and_then(Value::as_str) {
            Some("rpc") => json_response(200, envelope.get("rpc").cloned().unwrap_or(Value::Null)),
            Some("challenge") => {
                let status = envelope.get("status").and_then(Value::as_u64).unwrap_or(401) as u16;
                Ok(McpHttpResponse {
                    status,
                    headers: string_headers(envelope.get("headers")),
                    body: encode_json_body(envelope.get("body").cloned().unwrap_or(Value::Null))?,
                })
            }
            Some("invokeHandler") => self.resume_payable(&envelope).await,
            other => Err(SdkError::transport(
                format!("unexpected mcpDispatch kind: {other:?}"),
                false,
            )),
        }
    }

    async fn resume_payable(&self, envelope: &Value) -> Result<McpHttpResponse, SdkError> {
        let tool = envelope
            .get("tool")
            .and_then(Value::as_str)
            .unwrap_or("")
            .to_owned();
        let token = envelope
            .get("token")
            .and_then(Value::as_str)
            .ok_or_else(|| SdkError::transport("invokeHandler missing token", false))?
            .to_owned();
        let spec = self.payables.get(&tool).ok_or_else(|| {
            SdkError::transport(format!("unknown payable tool: {tool}"), false)
        })?;
        let mut args: JsonObject = match envelope.get("args") {
            Some(Value::Object(map)) => map.clone(),
            _ => Map::new(),
        };
        if let Some(customer_ref) = envelope.get("customerRef").and_then(Value::as_str) {
            if !args.contains_key("customer_ref") {
                args.insert("customer_ref".to_owned(), json!(customer_ref));
            }
        }
        let result = invoke_payable(
            self.client.clone(),
            spec.product.clone(),
            spec.usage_type.clone(),
            spec.handler.clone(),
            spec.get_customer_ref.clone(),
            args,
        )
        .await
        .map_err(payable_to_sdk)?;
        let handler_envelope = serde_json::to_value(&result)
            .map_err(|err| SdkError::transport(format!("serialize handler result: {err}"), false))?;
        let resumed = call_sync(
            "mcpResume",
            &json!({ "token": token, "handlerEnvelope": handler_envelope }),
        )
        .map_err(|err| SdkError::transport(err, false))?;
        json_response(200, resumed.get("rpc").cloned().unwrap_or(resumed))
    }
}

fn payable_to_sdk(err: PayableError) -> SdkError {
    match err {
        PayableError::Sdk(err) => *err,
        other => SdkError::transport(other.to_string(), false),
    }
}

fn http_from_oauth_envelope(envelope: &Value) -> Result<McpHttpResponse, SdkError> {
    let status = envelope.get("status").and_then(Value::as_u64).unwrap_or(500) as u16;
    Ok(McpHttpResponse {
        status,
        headers: string_headers(envelope.get("headers")),
        body: encode_json_body(envelope.get("body").cloned().unwrap_or(Value::Null))?,
    })
}

fn string_headers(value: Option<&Value>) -> BTreeMap<String, String> {
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

fn json_response(status: u16, body: Value) -> Result<McpHttpResponse, SdkError> {
    let mut headers = BTreeMap::new();
    headers.insert("content-type".to_owned(), "application/json".to_owned());
    Ok(McpHttpResponse {
        status,
        headers,
        body: encode_json_body(body)?,
    })
}

fn encode_json_body(body: Value) -> Result<Vec<u8>, SdkError> {
    if body.is_null() {
        return Ok(Vec::new());
    }
    if let Some(text) = body.as_str() {
        return Ok(text.as_bytes().to_vec());
    }
    serde_json::to_vec(&body)
        .map_err(|err| SdkError::transport(format!("serialize response body: {err}"), false))
}
