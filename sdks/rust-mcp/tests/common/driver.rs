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
use solvapay::{Client, Config};
use solvapay_mcp::{
    register_payable_tool, GetCustomerRef, PayableError, PayableHandler, PayableTool,
    ResponseContext,
};

use super::mock_transport::MockTransport;
use super::scenario::{HandlerSpec, Scenario};

struct FixtureServer {
    router: ToolRouter<()>,
}

impl ServerHandler for FixtureServer {
    fn get_info(&self) -> ServerInfo {
        ServerInfo::new(ServerCapabilities::builder().enable_tools().build())
            .with_server_info(Implementation::new("mcp-authoring-fixtures", "0.0.1"))
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

fn compile_handler(spec: HandlerSpec) -> PayableHandler {
    Arc::new(move |_, mut ctx: ResponseContext| {
        let spec = spec.clone();
        Box::pin(async move {
            match spec {
                HandlerSpec::Throw { message } => Err(PayableError::Handler(message)),
                HandlerSpec::Gate { reason } => Err(ctx.gate(reason.as_deref())),
                HandlerSpec::Respond {
                    data,
                    options,
                    emit,
                } => {
                    if let Some(blocks) = emit {
                        for block in blocks {
                            ctx.emit(block);
                        }
                    }
                    ctx.respond(data, options)
                }
            }
        }) as BoxFuture<'static, Result<_, _>>
    })
}

pub async fn call_registered_payable(
    backend: Arc<MockTransport>,
    scenario: &Scenario,
) -> Result<Value, rmcp::ServiceError> {
    let client = Client::with_transport(
        backend,
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let mut router = ToolRouter::new();
    let get_customer_ref: Option<GetCustomerRef> = if scenario.customer_ref_source == "hook" {
        let r = scenario.customer_ref.clone();
        Some(Arc::new(move |_| Ok(r.clone())))
    } else {
        None
    };
    register_payable_tool(
        &mut router,
        client,
        PayableTool {
            name: scenario.tool.name.clone(),
            product: scenario.product.clone(),
            title: scenario.tool.title.clone(),
            description: scenario.tool.description.clone(),
            input_schema: scenario.tool.input_schema.clone(),
            usage_type: None,
        },
        compile_handler(scenario.handler.clone()),
        get_customer_ref,
    )
    .expect("register");

    let server = FixtureServer { router };
    let (server_io, client_io) = tokio::io::duplex(64 * 1024);
    tokio::spawn(async move {
        let running = server.serve(server_io).await.expect("serve server");
        running.waiting().await.expect("server wait");
    });
    let running_client = ().serve(client_io).await.expect("serve client");
    let mut args = Map::new();
    for (k, v) in &scenario.tool.args {
        args.insert(k.clone(), v.clone());
    }
    let result = running_client
        .call_tool(CallToolRequestParams::new(scenario.tool.name.clone()).with_arguments(args))
        .await?;
    running_client.cancel().await.ok();
    Ok(project_tool_result(&result))
}

pub fn project_tool_result(result: &rmcp::model::CallToolResult) -> Value {
    let mut dumped = serde_json::to_value(result).expect("serialize CallToolResult");
    if let Some(obj) = dumped.as_object_mut() {
        obj.remove("resultType");
        obj.remove("_meta");
        let is_error = obj.get("isError").and_then(Value::as_bool);
        let kind = obj
            .get("structuredContent")
            .and_then(Value::as_object)
            .and_then(|s| s.get("kind"))
            .and_then(Value::as_str);
        match is_error {
            Some(true) => {}
            Some(false)
                if matches!(kind, Some("payment_required") | Some("activation_required")) => {}
            _ => {
                obj.remove("isError");
            }
        }
    }
    dumped
}

pub fn tool_results_equal(actual: &Value, expected: &Value) -> bool {
    let mut a = actual.clone();
    let mut e = expected.clone();
    drop_is_error_unless_true(&mut a);
    drop_is_error_unless_true(&mut e);
    a == e
}

fn drop_is_error_unless_true(value: &mut Value) {
    let Some(obj) = value.as_object_mut() else {
        return;
    };
    if obj.get("isError") != Some(&json!(true)) {
        obj.remove("isError");
    }
}
