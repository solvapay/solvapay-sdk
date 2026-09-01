//! Paths not covered by the frozen MCP-authoring fixtures.
#![allow(dead_code)]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::sync::Arc;

use common::driver::call_registered_payable;
use common::mock_transport::{project_usage, MockTransport};
use common::scenario::{HandlerSpec, Scenario, ToolScenario};
use futures::future::BoxFuture;
use rmcp::handler::server::router::tool::ToolRouter;
use rmcp::handler::server::tool::ToolCallContext;
use rmcp::model::{
    CallToolRequestParams, CallToolResponse, Implementation, ListToolsResult, ServerCapabilities,
    ServerInfo, Tool,
};
use rmcp::service::{RequestContext, RoleServer};
use rmcp::{ErrorData, ServerHandler, ServiceExt};
use serde_json::{json, Map};
use solvapay::{Client, Config};
use solvapay_mcp::{
    register_payable_tool, PayableError, PayableHandler, PayableTool, ResponseContext,
};

struct FailingLimits;

impl solvapay::transport::transport::Transport for FailingLimits {
    fn send(
        &self,
        _req: solvapay::transport::HttpRequest,
    ) -> solvapay::transport::transport::BoxFuture<
        '_,
        Result<solvapay::transport::HttpResponse, solvapay::SdkError>,
    > {
        Box::pin(async { Err(solvapay::SdkError::transport("limits down", false)) })
    }
}

struct ErrServer {
    router: ToolRouter<()>,
}

impl ServerHandler for ErrServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("uncovered", "0.0.1"))
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

#[tokio::test]
async fn unresolvable_customer_ref_falls_back_to_anonymous() {
    let scenario = Scenario {
        tool: ToolScenario {
            name: "echo".to_owned(),
            title: None,
            description: None,
            input_schema: None,
            args: Map::new(),
        },
        product: "prd_demo".to_owned(),
        customer_ref: "unused".to_owned(),
        customer_ref_source: "toolArgs".to_owned(),
        usage_type: None,
        limits: json!({ "withinLimits": true, "remaining": 5, "meterName": "requests" }),
        handler: HandlerSpec::Respond {
            data: json!({ "ok": true }),
            options: None,
            emit: None,
        },
    };
    let backend = MockTransport::new(scenario.limits.clone());
    let tool_result = call_registered_payable(backend.clone(), &scenario)
        .await
        .expect("call");
    assert_eq!(tool_result["structuredContent"], json!({ "ok": true }));
    let usage = project_usage(&backend.usages());
    assert_eq!(usage[0]["customerRef"], "anonymous");
}

#[tokio::test]
async fn sdk_error_propagates_as_rmcp_error() {
    let client = Client::with_transport(
        Arc::new(FailingLimits),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let mut router = ToolRouter::new();
    let handler: PayableHandler = Arc::new(|_, mut ctx: ResponseContext| {
        Box::pin(async move { ctx.respond(json!({ "ok": true }), None) })
            as BoxFuture<'static, Result<_, PayableError>>
    });
    register_payable_tool(
        &mut router,
        client,
        PayableTool {
            name: "echo".to_owned(),
            product: "prd_demo".to_owned(),
            title: None,
            description: None,
            input_schema: None,
            usage_type: None,
        },
        handler,
        None,
    )
    .expect("register");
    let server = ErrServer { router };
    let (server_io, client_io) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let running = server.serve(server_io).await.expect("serve");
        running.waiting().await.ok();
    });
    let running_client = ().serve(client_io).await.expect("client");
    let err = running_client
        .call_tool(CallToolRequestParams::new("echo"))
        .await
        .expect_err("sdk failure must be protocol error");
    running_client.cancel().await.ok();
    let msg = err.to_string();
    assert!(
        msg.contains("limits down") || msg.to_lowercase().contains("internal"),
        "{msg}"
    );
}
