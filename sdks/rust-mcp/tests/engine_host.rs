//! Full dispatch → invokeHandler → mcpResume loop against a mock backend.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::collections::BTreeMap;
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
            hs256_secret: Some("solvapay-mcp-fixture-hs256-secret-32b!!".to_owned()),
            jwks_json: None,
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
                "Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJjdXNfMSIsImlzcyI6Imh0dHBzOi8vYXBwLmV4YW1wbGUuY29tIiwiYXVkIjoiaHR0cHM6Ly9hcHAuZXhhbXBsZS5jb20vbWNwIiwiZXhwIjo0MTAyNDQ0ODAwfQ.eb4F_ZV0NAHvVw_MNTAOzvEpZj_0P0rutht4rFEw2aA".to_owned(),
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

#[tokio::test]
async fn tools_list_includes_registered_payable_descriptor() {
    let client = Client::with_transport(
        MockTransport::new(json!({})),
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
            hs256_secret: Some("solvapay-mcp-fixture-hs256-secret-32b!!".to_owned()),
            jwks_json: None,
        },
    );
    let handler: PayableHandler = Arc::new(|_args, mut ctx: ResponseContext| {
        Box::pin(async move { ctx.respond(json!({}), None) })
            as BoxFuture<'static, Result<_, PayableError>>
    });
    host.register_payable(
        PayableTool {
            name: "echo_paid".to_owned(),
            product: "prd_demo".to_owned(),
            title: Some("Echo paid".to_owned()),
            description: Some("Echo arguments after a paid gate".to_owned()),
            input_schema: Some(
                json!({ "n": { "type": "string" } })
                    .as_object()
                    .cloned()
                    .unwrap(),
            ),
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
            headers: BTreeMap::new(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/list",
                "params": {}
            }))
            .unwrap(),
        })
        .await
        .expect("handle");

    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    let tools = body["result"]["tools"].as_array().unwrap();
    let echo = tools
        .iter()
        .find(|t| t["name"] == "echo_paid")
        .expect("payable advertised");
    assert_eq!(echo["title"], "Echo paid");
    assert_eq!(echo["description"], "Echo arguments after a paid gate");
    assert_eq!(
        echo["inputSchema"],
        json!({ "type": "object", "properties": { "n": { "type": "string" } } })
    );
}

#[tokio::test]
async fn resources_read_returns_widget_html() {
    let client = Client::with_transport(
        MockTransport::new(json!({})),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let host = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            resource_uri: Some("ui://widget.html".to_owned()),
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
            hs256_secret: Some("solvapay-mcp-fixture-hs256-secret-32b!!".to_owned()),
            jwks_json: None,
        },
    );
    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers: BTreeMap::new(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": { "uri": "ui://widget.html" }
            }))
            .unwrap(),
        })
        .await
        .expect("handle");
    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    let text = body["result"]["contents"][0]["text"].as_str().unwrap();
    assert!(
        text.trim_start().starts_with('<'),
        "{}",
        &text[..text.len().min(80)]
    );
    assert_eq!(text, solvapay_mcp::default_mcp_app_html());
    assert!(body["result"]["contents"][0]["_meta"]["ui"]["csp"]["resourceDomains"].is_array());
}

#[tokio::test]
async fn resources_read_stamps_modern_catalog_envelope() {
    let client = Client::with_transport(
        MockTransport::new(json!({})),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let host = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            resource_uri: Some("ui://widget.html".to_owned()),
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
            hs256_secret: Some("solvapay-mcp-fixture-hs256-secret-32b!!".to_owned()),
            jwks_json: None,
        },
    );
    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers: BTreeMap::new(),
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": {
                    "uri": "ui://widget.html",
                    "_meta": {
                        "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                        "io.modelcontextprotocol/clientCapabilities": {}
                    }
                }
            }))
            .unwrap(),
        })
        .await
        .expect("handle");
    assert_eq!(response.status, 200);
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    assert_eq!(body["result"]["resultType"], "complete");
    assert_eq!(body["result"]["ttlMs"], 60_000);
    assert_eq!(body["result"]["cacheScope"], "public");
    assert_eq!(
        body["result"]["contents"][0]["text"],
        solvapay_mcp::default_mcp_app_html()
    );
}

#[tokio::test]
async fn handle_mcp_unparseable_json_is_jsonrpc_not_sdk_error() {
    let client = Client::with_transport(
        MockTransport::new(json!({})),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    let host = McpHttpServer::new(
        client,
        McpHttpConfig {
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            resource_uri: Some("ui://test/view.html".to_owned()),
            mcp_path: Some("/mcp".to_owned()),
            views: None,
            oauth_paths: None,
            hs256_secret: Some("solvapay-mcp-fixture-hs256-secret-32b!!".to_owned()),
            jwks_json: None,
        },
    );
    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers: BTreeMap::new(),
            body: b"{not-json".to_vec(),
        })
        .await
        .expect("handle returns a body, not SdkError");
    assert_eq!(response.status, 400);
    assert_eq!(
        response.headers.get("content-type").map(String::as_str),
        Some("application/json")
    );
    let text = String::from_utf8(response.body).unwrap();
    let body: Value = serde_json::from_str(&text).unwrap();
    assert_eq!(body["error"]["code"], -32700);
    assert!(!text.contains("/Users/"));
}
