//! Full dispatch → invokeHandler → mcpResume loop against a mock backend.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::sync::Arc;

use futures::future::BoxFuture;
use serde_json::{json, Value};
use solvapay::{Client, Config};
use solvapay_mcp::{
    McpHttpConfig, McpHttpRequest, McpHttpServer, PayableError, PayableHandler, PayableTool,
    ResponseContext,
};

use common::mock_transport::MockTransport;

#[tokio::test]
async fn engine_loop_invoke_handler_then_resume() {
    let backend = MockTransport::new(json!({
        "withinLimits": true,
        "remaining": 42,
        "plan": "pl_pro",
        "creditBalance": 5000
    }));
    let client = Client::with_transport(
        backend,
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let mut host = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            resource_uri: Some("ui://test/view.html".to_owned()),
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
        },
    );
    let handler: PayableHandler = Arc::new(|args, mut ctx: ResponseContext| {
        Box::pin(async move { ctx.respond(json!({ "echo": args }), None) })
            as BoxFuture<'static, Result<_, PayableError>>
    });
    host.register_payable(
        PayableTool {
            name: "echo_paid".to_owned(),
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

    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers: [(
                "authorization".to_owned(),
                "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9.".to_owned(),
            )]
            .into_iter()
            .collect(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": { "name": "echo_paid", "arguments": { "n": 1 } }
            }))
            .unwrap(),
        })
        .await
        .expect("handle");

    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(body["jsonrpc"], "2.0");
    assert_eq!(body["id"], 3);
    assert_eq!(body["result"]["structuredContent"]["echo"]["n"], 1);
    assert_eq!(
        body["result"]["structuredContent"]["echo"]["customer_ref"],
        "cus_1"
    );
    let text = body["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("\"n\":1"), "{text}");
}
