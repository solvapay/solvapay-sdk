//! Offline paid-MCP example over a mock SolvaPay transport and in-process rmcp.

use std::sync::Arc;

use futures::future::BoxFuture;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, Implementation, ListToolsResult, ServerCapabilities,
    ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, ServiceExt};
use serde_json::{json, Map, Value};
use solvapay::transport::transport::{BoxFuture as TransportFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse, Method};
use solvapay::{Client, Config, SdkError};
use solvapay_mcp::{
    register_payable_tool, PayableError, PayableHandler, PayableTool, ResponseContext,
};

/// Mock SolvaPay HTTP transport for the example.
struct MockTransport {
    /// Whether the mock limits check allows the call.
    within_limits: bool,
}

/// In-process MCP server holding a payable tool router.
struct ExampleServer {
    /// Registered payable tools.
    router: ToolRouter<()>,
}

impl Transport for MockTransport {
    fn send(&self, req: HttpRequest) -> TransportFuture<'_, Result<HttpResponse, SdkError>> {
        let within = self.within_limits;
        Box::pin(async move {
            if req.method == Method::Post && req.url.contains("/v1/sdk/limits") {
                let remaining = if within { 5 } else { 0 };
                let body = json!({
                    "withinLimits": within,
                    "remaining": remaining,
                    "meterName": "requests",
                    "checkoutUrl": "https://pay.example/x",
                });
                return Ok(HttpResponse {
                    status: 200,
                    body: serde_json::to_vec(&body).map_err(|e| {
                        SdkError::transport(format!("serialize limits: {e}"), false)
                    })?,
                });
            }
            if req.method == Method::Post && req.url.contains("/v1/sdk/usages") {
                return Ok(HttpResponse {
                    status: 200,
                    body: br#"{"reference":"usg_demo"}"#.to_vec(),
                });
            }
            Err(SdkError::transport("unexpected request", false))
        })
    }
}

impl ServerHandler for ExampleServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("paid-mcp-example", "0.0.1"))
    }

    fn get_tool(&self, name: &str) -> Option<Tool> {
        self.router.get(name).cloned()
    }

    async fn list_tools(
        &self,
        _request: Option<rmcp::model::PaginatedRequestParams>,
        _context: RequestContext<RoleServer>,
    ) -> Result<ListToolsResult, ErrorData> {
        Ok(ListToolsResult::with_all_items(self.router.list_all()))
    }

    async fn call_tool(
        &self,
        request: CallToolRequestParams,
        context: RequestContext<RoleServer>,
    ) -> Result<CallToolResponse, ErrorData> {
        let ctx = ToolCallContext::new(&(), request, context);
        self.router.call(ctx).await
    }
}

/// Drive an in-process allow or gate round-trip.
///
/// # Errors
///
/// Returns a transport or MCP service error.
pub async fn run(
    within_limits: bool,
    message: &str,
) -> Result<Value, Box<dyn std::error::Error + Send + Sync>> {
    let client = Client::with_transport(
        Arc::new(MockTransport { within_limits }),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let mut router = ToolRouter::new();
    let echo = message.to_owned();
    let handler: PayableHandler = Arc::new(move |args, mut ctx: ResponseContext| {
        let fallback = echo.clone();
        Box::pin(async move {
            let text = args
                .get("text")
                .and_then(Value::as_str)
                .unwrap_or(fallback.as_str())
                .to_owned();
            ctx.respond(json!({ "echo": text }), None)
        }) as BoxFuture<'static, Result<_, PayableError>>
    });
    register_payable_tool(
        &mut router,
        client,
        PayableTool {
            name: "echo_paid".to_owned(),
            product: "prd_demo".to_owned(),
            title: Some("Echo paid".to_owned()),
            description: None,
            input_schema: None,
            usage_type: None,
        },
        handler,
        Some(Arc::new(|_| Ok("cus_demo".to_owned()))),
    )?;

    let server = ExampleServer { router };
    let (server_io, client_io) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        if let Ok(running) = server.serve(server_io).await {
            let _ = running.waiting().await;
        }
    });
    let running_client = ().serve(client_io).await?;
    let mut args = Map::new();
    args.insert("text".to_owned(), json!(message));
    let result = running_client
        .call_tool(CallToolRequestParams::new("echo_paid").with_arguments(args))
        .await?;
    running_client.cancel().await.ok();
    let mut dumped = serde_json::to_value(&result)?;
    if let Some(obj) = dumped.as_object_mut() {
        obj.remove("resultType");
        obj.remove("_meta");
    }
    Ok(dumped)
}
