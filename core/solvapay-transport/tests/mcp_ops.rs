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
use solvapay_mcp_core::EngineConfig;
use solvapay_transport::{
    ClientShell, McpBootstrapParams, McpDispatchParams, McpOauthConfig, McpOauthRequestParams,
    McpReadResourceParams, McpToolConfig, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn client(server: &MockServer) -> SolvaPayClient {
    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("reqwest"));
    SolvaPayClient::new(ClientShell::new(transport, "sk_test_fixture").with_base_url(server.uri()))
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
    assert!(got["merchant"].get("identityDisplay").is_some());
    assert!(got["taxIdFields"]["DE"]["label"].is_string());
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
async fn mcp_dispatch_errors_on_widget_resource_read() {
    let server = MockServer::start().await;
    let err = client(&server)
        .mcp_dispatch(McpDispatchParams {
            rpc: json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "resources/read",
                "params": { "uri": "ui://widget.html" }
            }),
            config: EngineConfig {
                product_ref: "prd_demo".to_owned(),
                public_base_url: "https://app.example.com".to_owned(),
                resource_uri: "ui://widget.html".to_owned(),
                views: None,
                payable_tools: Vec::new(),
                auth_mode: None,
                mcp_path: None,
                hide_audiences: None,
                user_agent: None,
                csp: None,
                api_base_url: None,
                branding: None,
                jwks_json: None,
                hs256_secret: None,
                expected_issuer: None,
                expected_audience: None,
                now_unix_secs: None,
            },
            auth_header: None,
            mcp_protocol_version_header: None,
        })
        .await
        .expect_err("widget URI must fail in mcpDispatch");
    let message = err.message();
    assert!(
        message.contains("ui://widget.html") && message.contains("host"),
        "{message}"
    );
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
    // Matches the oauth-proxy/discovery-protected-resource fixture: mcpPath
    // is part of the RFC 9728 resource identifier.
    assert_eq!(got["body"]["resource"], "https://app.example.com/mcp");
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

#[tokio::test]
async fn fetch_jwks_is_unauthenticated_get_and_requires_keys() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/.well-known/jwks.json"))
        .respond_with(ResponseTemplate::new(200).set_body_json(json!({
            "keys": [{ "kty": "RSA", "kid": "1" }]
        })))
        .mount(&server)
        .await;

    let got = client(&server)
        .fetch_jwks(solvapay_transport::FetchJwksParams {
            jwks_url: format!("{}/.well-known/jwks.json", server.uri()),
        })
        .await
        .expect("jwks");
    assert_eq!(got["keys"][0]["kid"], "1");

    let missing = client(&server)
        .fetch_jwks(solvapay_transport::FetchJwksParams {
            jwks_url: format!("{}/missing", server.uri()),
        })
        .await
        .expect_err("missing JWKS must fail");
    assert!(
        missing.message().contains("JWKS fetch failed"),
        "{}",
        missing.message()
    );
}
