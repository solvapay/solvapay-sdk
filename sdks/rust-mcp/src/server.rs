//! Engine-driven HTTP adapter: `mcpDispatch` / `mcpOauthRequest` / `mcpResume`.

#![allow(clippy::missing_docs_in_private_items)]

use std::collections::{BTreeMap, HashMap};

use serde_json::{json, Map, Value};
use solvapay::transport::{McpDispatchParams, McpOauthConfig, McpOauthRequestParams};
use solvapay::{Client, SdkError};
use solvapay_mcp_core::{EngineConfig, PayableToolConfig, PayableToolSpec};

use crate::http_util::{
    encode_json_body, envelope_status, http_from_oauth_envelope, json_response, jsonrpc_error,
    merge_native_cors, string_headers,
};
use crate::register::{GetCustomerRef, PayableError, PayableHandler, PayableTool};
use crate::resume::{resume_envelope, PayableSpec};

pub use crate::http_util::{McpHttpRequest, McpHttpResponse};

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
    /// Explicit HS256 secret for local / stub bearer verification.
    pub hs256_secret: Option<String>,
    /// Preloaded JWKS document.
    pub jwks_json: Option<serde_json::Value>,
}

struct RegisteredPayable {
    product: String,
    usage_type: String,
    title: Option<String>,
    description: Option<String>,
    input_schema: Option<Map<String, Value>>,
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
    hs256_secret: Option<String>,
    jwks_json: Option<Value>,
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
            public_base_url: config.public_base_url.clone(),
            resource_uri: config
                .resource_uri
                .filter(|u| !u.is_empty())
                .unwrap_or_else(|| "ui://widget.html".to_owned()),
            mcp_path,
            views: config.views,
            oauth_paths: config.oauth_paths,
            hs256_secret: config.hs256_secret.clone(),
            jwks_json: config.jwks_json,
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
                title: tool.title,
                description: tool.description,
                input_schema: tool.input_schema,
                handler,
                get_customer_ref,
            },
        );
        Ok(())
    }

    /// Route one HTTP request.
    ///
    /// JSON-RPC parse and dispatch failures become JSON-RPC error bodies
    /// (`-32700` / `-32603`) rather than [`SdkError`]. `Err` is reserved for
    /// request-construction failures the embedder cannot map (OAuth transport
    /// errors, body serialization).
    ///
    /// # Errors
    ///
    /// Transport / SDK failures from OAuth or payable resume serialization.
    pub async fn handle(&self, req: McpHttpRequest) -> Result<McpHttpResponse, SdkError> {
        let path_only = req.path.split('?').next().unwrap_or(req.path.as_str());
        if path_only != self.mcp_path {
            return self.handle_oauth(&req).await;
        }
        if !req.method.eq_ignore_ascii_case("POST") {
            let mut headers = BTreeMap::new();
            headers.insert("allow".to_owned(), "POST, OPTIONS".to_owned());
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
        let rpc: Value = match serde_json::from_slice(&req.body) {
            Ok(value) => value,
            Err(_) => {
                return jsonrpc_error(Value::Null, -32700, "Parse error", 400);
            }
        };
        if let Some(html) = crate::widget::widget_html_rpc(
            &rpc,
            &self.resource_uri,
            &self.public_base_url,
            &self.product_ref,
        )
        .map_err(|err| SdkError::transport(err, false))?
        {
            return json_response(200, html);
        }
        let mut payable_tools: Vec<PayableToolConfig> = self
            .payables
            .iter()
            .map(|(name, spec)| {
                PayableToolConfig::Spec(Box::new(PayableToolSpec {
                    name: name.clone(),
                    title: spec.title.clone(),
                    description: spec.description.clone(),
                    input_schema: Some(json!({
                        "type": "object",
                        "properties": spec.input_schema.clone().unwrap_or_default(),
                    })),
                    annotations: None,
                    meta: None,
                }))
            })
            .collect();
        payable_tools.sort_by(|a, b| a.name().cmp(b.name()));
        let envelope = match self
            .client
            .mcp_dispatch(McpDispatchParams {
                rpc: rpc.clone(),
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
                    jwks_json: self.jwks_json.clone(),
                    hs256_secret: self.hs256_secret.clone(),
                    expected_issuer: None,
                    expected_audience: None,
                    now_unix_secs: None,
                    pre_verified_customer_ref: None,
                },
                auth_header: req.headers.get("authorization").cloned(),
                mcp_protocol_version_header: req.headers.get("mcp-protocol-version").cloned(),
            })
            .await
        {
            Ok(envelope) => envelope,
            Err(err) => {
                eprintln!("mcp_dispatch: {err:?}");
                return jsonrpc_error(
                    rpc.get("id").cloned().unwrap_or(Value::Null),
                    -32603,
                    err.message(),
                    200,
                );
            }
        };
        match envelope.get("kind").and_then(Value::as_str) {
            Some("rpc") => json_response(
                envelope_status(&envelope, 200),
                envelope.get("rpc").cloned().unwrap_or(Value::Null),
            ),
            Some("challenge") => {
                let mut headers = string_headers(envelope.get("headers"));
                merge_native_cors(&req.headers, &mut headers);
                Ok(McpHttpResponse {
                    status: envelope_status(&envelope, 401),
                    headers,
                    body: encode_json_body(envelope.get("body").cloned().unwrap_or(Value::Null))?,
                })
            }
            Some("invokeHandler") => {
                resume_envelope(
                    self.client.clone(),
                    |tool| {
                        self.payables.get(tool).map(|spec| PayableSpec {
                            product: spec.product.clone(),
                            usage_type: spec.usage_type.clone(),
                            handler: spec.handler.clone(),
                            get_customer_ref: spec.get_customer_ref.clone(),
                        })
                    },
                    &envelope,
                )
                .await
            }
            other => {
                eprintln!("unexpected mcpDispatch kind: {other:?}");
                jsonrpc_error(
                    rpc.get("id").cloned().unwrap_or(Value::Null),
                    -32603,
                    &format!("unexpected mcpDispatch kind: {other:?}"),
                    200,
                )
            }
        }
    }
}
