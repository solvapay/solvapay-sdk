//! Wiremock-backed MCP composite ops on [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::sync::Arc;

use serde_json::{json, Value};
use solvapay_transport::{
    ClientShell, McpBootstrapParams, McpOauthConfig, McpOauthRequestParams, McpReadResourceParams,
    McpToolConfig, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> SolvaPayClient {
    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("reqwest"));
    SolvaPayClient::new(
        ClientShell::new(transport, "sk_test_fixture").with_base_url(server.uri()),
    )
}

#[tokio::test]
async fn mcp_bootstrap_unauthenticated_matches_widget_placeholders() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/platform-config"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "stripePublishableKey": "pk_test"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/merchant"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "displayName": "Acme"
        })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/products/prd_demo"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({ "name": "Demo" })))
        .mount(&server)
        .await;
    Mock::given(method("GET"))
        .and(path("/v1/sdk/products/prd_demo/plans"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "plans": [{ "name": "Pro" }]
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .mcp_bootstrap(McpBootstrapParams {
            view: "account".to_owned(),
            product_ref: "prd_demo".to_owned(),
            public_base_url: "https://app.example.com".to_owned(),
            customer_ref: None,
        })
        .await
        .expect("bootstrap");

    assert_eq!(got["view"], "account");
    assert_eq!(got["productRef"], "prd_demo");
    assert_eq!(got["stripePublishableKey"], "pk_test");
    assert_eq!(got["returnUrl"], "https://app.example.com");
    assert_eq!(got["merchant"]["displayName"], "Acme");
    assert_eq!(got["product"]["name"], "Demo");
    assert_eq!(got["plans"][0]["name"], "Pro");
    assert_eq!(got["customer"], Value::Null);
}

#[tokio::test]
async fn mcp_read_resource_overview() {
    let server = MockServer::start().await;
    let got = client(&server)
        .mcp_read_resource(McpReadResourceParams {
            uri: "docs://solvapay/overview.md".to_owned(),
            config: McpToolConfig {
                product_ref: "prd_demo".to_owned(),
                public_base_url: "https://app.example.com".to_owned(),
                resource_uri: None,
                views: None,
                mcp_path: None,
            },
            customer_ref: None,
        })
        .await
        .expect("overview");
    assert_eq!(got["uri"], "docs://solvapay/overview.md");
    assert_eq!(got["mimeType"], "text/markdown");
    assert!(got["body"].as_str().unwrap().contains("SolvaPay"));
}

#[tokio::test]
async fn mcp_oauth_protected_resource_discovery() {
    let server = MockServer::start().await;
    let got = client(&server)
        .mcp_oauth_request(McpOauthRequestParams {
            method: "GET".to_owned(),
            path: "/.well-known/oauth-protected-resource".to_owned(),
            headers: Default::default(),
            body: String::new(),
            config: McpOauthConfig {
                public_base_url: "https://app.example.com".to_owned(),
                mcp_path: Some("/mcp".to_owned()),
                product_ref: "prd_demo".to_owned(),
                oauth_paths: None,
            },
        })
        .await
        .expect("oauth");
    assert_eq!(got["status"], 200);
    assert_eq!(got["body"]["bearer_methods_supported"], json!(["header"]));
    // Matches live host bridges, which omit `mcpPath` from this document.
    assert_eq!(got["body"]["resource"], "https://app.example.com");
}

#[tokio::test]
async fn mcp_oauth_token_normalizes_upstream_error() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/customer/auth/token"))
        .respond_with(ResponseTemplate::new(401).set_body_json(json!({
            "statusCode": 401,
            "message": "Unauthorized"
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .mcp_oauth_request(McpOauthRequestParams {
            method: "POST".to_owned(),
            path: "/oauth/token".to_owned(),
            headers: Default::default(),
            body: "grant_type=authorization_code".to_owned(),
            config: McpOauthConfig {
                public_base_url: "https://app.example.com".to_owned(),
                mcp_path: None,
                product_ref: "prd_demo".to_owned(),
                oauth_paths: None,
            },
        })
        .await
        .expect("token");
    assert_eq!(got["status"], 401);
    assert_eq!(got["body"]["error"], "invalid_client");
}
