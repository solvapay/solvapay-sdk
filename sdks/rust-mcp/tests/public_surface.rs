//! Public adapter surface exists and is callable.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::sync::Arc;

use futures::future::BoxFuture;
use rmcp::handler::server::router::tool::ToolRouter;
use serde_json::json;
use solvapay::transport::transport::{BoxFuture as TransportFuture, Transport};
use solvapay::transport::{HttpRequest, HttpResponse};
use solvapay::SdkError;
use solvapay::{Client, Config};
use solvapay_mcp::{
    register_payable_tool, PayableError, PayableHandler, PayableTool, ResponseContext,
};

struct Exhausted;

impl Transport for Exhausted {
    fn send(&self, _req: HttpRequest) -> TransportFuture<'_, Result<HttpResponse, SdkError>> {
        Box::pin(async { Err(SdkError::transport("unused", false)) })
    }
}

#[test]
fn register_payable_tool_and_response_context_surface() {
    let client = Client::with_transport(
        Arc::new(Exhausted),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let mut router = ToolRouter::<()>::new();
    let handler: PayableHandler = Arc::new(|_, mut ctx: ResponseContext| {
        Box::pin(async move { ctx.respond(json!({ "ok": true }), None) })
            as BoxFuture<'static, Result<_, PayableError>>
    });
    register_payable_tool(
        &mut router,
        client,
        PayableTool {
            name: "echo_paid".to_owned(),
            product: "prd_demo".to_owned(),
            title: Some("Echo paid".to_owned()),
            description: Some("echo".to_owned()),
            input_schema: Some(serde_json::Map::from_iter([(
                "customer_ref".to_owned(),
                json!({ "type": "string" }),
            )])),
            usage_type: None,
        },
        handler,
        None,
    )
    .expect("register");
    assert!(router.has_route("echo_paid"));
    let tool = router.get("echo_paid").expect("tool");
    let props = tool
        .input_schema
        .get("properties")
        .and_then(|v| v.as_object())
        .expect("properties");
    assert!(props.contains_key("customer_ref"));
}

#[test]
fn response_context_public_members_exist() {
    fn check(_: fn(&ResponseContext) -> &solvapay_mcp::CustomerView) {}
    fn check_product(_: fn(&ResponseContext) -> &solvapay_mcp::ProductView) {}
    check(ResponseContext::customer);
    check_product(ResponseContext::product);
    let _ = ResponseContext::emit;
    let _ = ResponseContext::respond;
    let _ = ResponseContext::gate;
}
