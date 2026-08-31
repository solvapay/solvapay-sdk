//! Paywalled disposable-inbox MCP over the Guerrilla Mail JSON API.

use std::sync::Arc;

use serde_json::{json, Value};
use solvapay::transport::transport::{BoxFuture as TransportFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::{Client, Config, SdkError};
use solvapay_mcp::{McpHttpConfig, McpHttpRequest, McpHttpServer, PayableError};

use crate::clock::{fixed_now, UnixNow};
use crate::session::SessionStore;
use crate::sources::SharedSource;
use crate::tools::{register_tools, TOOL_INBOX_OPEN};

pub mod clock;
pub mod error;
pub mod format;
pub mod http;
pub mod session;
pub mod sources;
pub mod tools;

/// Unsigned JWT used by demo mode and tests (`sub` = `cus_1`).
pub const TEST_BEARER: &str = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9.";

/// Mock SolvaPay HTTP transport (limits + usages).
pub struct MockTransport {
    /// When false, limits return a paywall (`checkoutUrl` still present).
    within_limits: bool,
}

impl MockTransport {
    /// Allow or gate every limits check. Usages always succeed.
    #[must_use]
    pub fn new(within_limits: bool) -> Arc<Self> {
        Arc::new(Self { within_limits })
    }
}

impl Transport for MockTransport {
    fn send(&self, req: HttpRequest) -> TransportFuture<'_, Result<HttpResponse, SdkError>> {
        let within = self.within_limits;
        Box::pin(async move {
            let body = match (req.method, req.url.as_str()) {
                (Method::Post, url) if url.contains("/v1/sdk/limits") => {
                    let remaining = if within { 5 } else { 0 };
                    (
                        200,
                        serde_json::to_vec(&json!({
                            "withinLimits": within,
                            "remaining": remaining,
                            "meterName": "requests",
                            "checkoutUrl": "https://pay.example/x",
                        }))
                        .map_err(|e| {
                            SdkError::transport(format!("serialize limits: {e}"), false)
                        })?,
                    )
                }
                (Method::Post, url) if url.contains("/v1/sdk/usages") => (
                    200,
                    br#"{"reference":"usg_demo","outcome":"success"}"#.to_vec(),
                ),
                (Method::Post, url) if url.contains("/v1/customer/auth/register") => (
                    201,
                    serde_json::to_vec(&json!({
                        "client_id": "cid_demo",
                        "client_secret": "cs_demo",
                        "client_id_issued_at": 1_700_000_100,
                    }))
                    .map_err(|e| SdkError::transport(format!("serialize dcr: {e}"), false))?,
                ),
                (method, url) => {
                    return Err(SdkError::transport(
                        format!("unexpected request {method:?} {url}"),
                        false,
                    ));
                }
            };
            Ok(HttpResponse {
                status: body.0,
                body: body.1,
            })
        })
    }
}

/// Build an engine-backed HTTP host with the five inbox tools.
///
/// # Errors
///
/// When tool registration fails.
pub fn build_host(
    client: Client,
    product: &str,
    public_base_url: &str,
    source: SharedSource,
    store: Arc<SessionStore>,
    now: UnixNow,
) -> Result<McpHttpServer, PayableError> {
    let mut host = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: product.to_owned(),
            public_base_url: public_base_url.to_owned(),
            resource_uri: None,
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
        },
    );
    register_tools(&mut host, product, source, store, now)?;
    Ok(host)
}

/// Offline demo: one `inbox_open` tools/call against [`MockTransport`].
///
/// # Errors
///
/// Transport, registration, or dispatch failures.
pub async fn run_demo(
    within_limits: bool,
    source: SharedSource,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let store = Arc::new(SessionStore::new());
    let client = Client::with_transport(
        MockTransport::new(within_limits),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let host = build_host(
        client,
        "prd_demo",
        "https://app.example.com",
        source,
        store,
        fixed_now(1_700_000_100),
    )?;
    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers: [("authorization".to_owned(), TEST_BEARER.to_owned())]
                .into_iter()
                .collect(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": TOOL_INBOX_OPEN, "arguments": {} }
            }))?,
        })
        .await
        .map_err(|e| e.message().to_owned())?;
    let body: Value = serde_json::from_slice(&response.body)?;
    Ok(body)
}
