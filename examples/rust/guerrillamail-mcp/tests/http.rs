//! axum adapter: CORS, method, and env checks.
#![allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]

use std::net::SocketAddr;
use std::sync::Arc;

use serde_json::json;
use solvapay::{Client, Config};
use solvapay_example_guerrillamail_mcp::clock::fixed_now;
use solvapay_example_guerrillamail_mcp::http::{
    listen_addr, require_public_base_url, router, CORS_ALLOW_METHODS, CORS_EXPOSE,
};
use solvapay_example_guerrillamail_mcp::session::SessionStore;
use solvapay_example_guerrillamail_mcp::sources::{default_fixture_dir, FixtureSource};
use solvapay_example_guerrillamail_mcp::{build_host, MockTransport, TEST_BEARER};

fn test_host() -> Arc<solvapay_mcp::McpHttpServer> {
    let client = Client::with_transport(
        MockTransport::new(true),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    );
    Arc::new(
        build_host(
            client,
            "prd_demo",
            "https://app.example.com",
            Arc::new(FixtureSource::from_dir(default_fixture_dir())),
            Arc::new(SessionStore::new()),
            fixed_now(1_700_000_100),
        )
        .unwrap(),
    )
}

async fn spawn_app() -> (SocketAddr, reqwest::Client) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let app = router(test_host());
    tokio::spawn(async move {
        axum::serve(listener, app).await.unwrap();
    });
    (
        addr,
        reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .unwrap(),
    )
}

#[tokio::test]
async fn options_mcp_returns_204_with_ruby_cors() {
    let (addr, client) = spawn_app().await;
    let response = client
        .request(reqwest::Method::OPTIONS, format!("http://{addr}/mcp"))
        .header("Origin", "http://localhost:6274")
        .header(
            "Access-Control-Request-Headers",
            "authorization, content-type",
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 204);
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-origin")
            .unwrap(),
        "http://localhost:6274"
    );
    assert_eq!(
        response
            .headers()
            .get("access-control-allow-methods")
            .unwrap(),
        CORS_ALLOW_METHODS
    );
    assert_eq!(
        response
            .headers()
            .get("access-control-expose-headers")
            .unwrap(),
        CORS_EXPOSE
    );
}

#[tokio::test]
async fn get_mcp_returns_405() {
    let (addr, client) = spawn_app().await;
    let response = client
        .get(format!("http://{addr}/mcp"))
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 405);
}

#[tokio::test]
async fn post_mcp_returns_200() {
    let (addr, client) = spawn_app().await;
    let response = client
        .post(format!("http://{addr}/mcp"))
        .header("Authorization", TEST_BEARER)
        .header("content-type", "application/json")
        .body(
            serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": "inbox_open", "arguments": {} }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(response.status(), 200);
}

#[test]
fn missing_mcp_public_base_url_fails_at_startup() {
    let err = require_public_base_url(None).unwrap_err();
    assert!(err.message().contains("MCP_PUBLIC_BASE_URL"));
}

#[test]
fn default_listen_addr_is_ipv4_loopback() {
    let addr = listen_addr(None, None).unwrap();
    assert_eq!(addr, "127.0.0.1:3030".parse().unwrap());
}

async fn get_json(
    client: &reqwest::Client,
    url: String,
) -> (reqwest::StatusCode, serde_json::Value) {
    let response = client.get(url).send().await.unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    let body: serde_json::Value = serde_json::from_str(&text).unwrap_or(serde_json::Value::Null);
    (status, body)
}

#[tokio::test]
async fn path_aware_protected_resource_discovery_is_200() {
    let (addr, client) = spawn_app().await;
    let (status, body) = get_json(
        &client,
        format!("http://{addr}/.well-known/oauth-protected-resource/mcp"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["resource"], "https://app.example.com/mcp");
    assert_eq!(body["authorization_servers"][0], "https://app.example.com");
}

#[tokio::test]
async fn root_protected_resource_discovery_is_200() {
    let (addr, client) = spawn_app().await;
    let (status, body) = get_json(
        &client,
        format!("http://{addr}/.well-known/oauth-protected-resource"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(body["resource"], "https://app.example.com/mcp");
    assert_eq!(body["authorization_servers"][0], "https://app.example.com");
}

#[tokio::test]
async fn authorization_server_discovery_includes_dcr() {
    let (addr, client) = spawn_app().await;
    let (status, body) = get_json(
        &client,
        format!("http://{addr}/.well-known/oauth-authorization-server"),
    )
    .await;
    assert_eq!(status, 200);
    assert_eq!(
        body["registration_endpoint"],
        "https://app.example.com/oauth/register"
    );
    assert_eq!(
        body["authorization_endpoint"],
        "https://app.example.com/oauth/authorize"
    );
    assert_eq!(
        body["token_endpoint"],
        "https://app.example.com/oauth/token"
    );
    assert!(body["code_challenge_methods_supported"]
        .as_array()
        .unwrap()
        .iter()
        .any(|m| m == "S256"));
}

#[tokio::test]
async fn openid_configuration_is_engine_404_not_axum_fallback() {
    let (addr, client) = spawn_app().await;
    let openid = client
        .get(format!("http://{addr}/.well-known/openid-configuration"))
        .send()
        .await
        .unwrap();
    assert_eq!(openid.status(), 404);
    assert!(openid.text().await.unwrap().is_empty());

    // Unknown POST paths return the engine JSON 404. Axum's fallback is empty
    // with no content-type — this is how we know the request reached the host.
    let unknown = client
        .post(format!("http://{addr}/not-an-oauth-route"))
        .send()
        .await
        .unwrap();
    assert_eq!(unknown.status(), 404);
    assert_eq!(
        unknown
            .headers()
            .get("content-type")
            .and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
    let body: serde_json::Value = serde_json::from_str(&unknown.text().await.unwrap()).unwrap();
    assert_eq!(body, serde_json::json!({ "error": "not_found" }));
}

#[tokio::test]
async fn unauthenticated_mcp_challenge_resource_metadata_is_reachable() {
    let (addr, client) = spawn_app().await;
    let challenge = client
        .post(format!("http://{addr}/mcp"))
        .header("content-type", "application/json")
        .body(
            serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": "inbox_open", "arguments": {} }
            }))
            .unwrap(),
        )
        .send()
        .await
        .unwrap();
    assert_eq!(challenge.status(), 401);
    let www = challenge
        .headers()
        .get("www-authenticate")
        .and_then(|v| v.to_str().ok())
        .expect("www-authenticate");
    let prefix = "resource_metadata=\"";
    let start = www.find(prefix).expect("resource_metadata") + prefix.len();
    let end = www[start..].find('"').expect("closing quote") + start;
    let metadata_url = &www[start..end];
    let path = metadata_url
        .strip_prefix("https://app.example.com")
        .expect("public_base_url prefix");
    let (status, body) = get_json(&client, format!("http://{addr}{path}")).await;
    assert_eq!(status, 200, "GET {path} from www-authenticate");
    assert_eq!(body["resource"], "https://app.example.com/mcp");
}

#[tokio::test]
async fn oauth_register_returns_201_with_client_id() {
    let (addr, client) = spawn_app().await;
    let response = client
        .post(format!("http://{addr}/oauth/register"))
        .header("content-type", "application/json")
        .body(serde_json::to_vec(&json!({ "client_name": "jam" })).unwrap())
        .send()
        .await
        .unwrap();
    let status = response.status();
    let text = response.text().await.unwrap();
    assert_eq!(status, 201, "body={text}");
    let body: serde_json::Value = serde_json::from_str(&text).unwrap();
    assert!(
        body["client_id"].as_str().is_some_and(|id| !id.is_empty()),
        "{body}"
    );
}
