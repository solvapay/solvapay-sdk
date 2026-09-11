//! JSON-RPC tools/call and tools/list against McpHttpServer.
#![allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]

use std::collections::BTreeMap;
use std::sync::Arc;

use serde_json::{json, Value};
use solvapay::{Client, Config};
use solvapay_example_guerrillamail_mcp::clock::fixed_now;
use solvapay_example_guerrillamail_mcp::session::Session;
use solvapay_example_guerrillamail_mcp::session::SessionStore;
use solvapay_example_guerrillamail_mcp::sources::{default_fixture_dir, FixtureSource};
use solvapay_example_guerrillamail_mcp::tools::{
    TOOL_INBOX_EXTEND, TOOL_INBOX_LIST, TOOL_INBOX_OPEN, TOOL_MESSAGE_DELETE, TOOL_MESSAGE_READ,
};
use solvapay_example_guerrillamail_mcp::{build_host, MockTransport, TEST_BEARER};
use solvapay_mcp::{McpHttpRequest, McpHttpServer};

const PRODUCT: &str = "prd_demo";
const PUBLIC: &str = "https://app.example.com";

fn allow_client() -> Client {
    Client::with_transport(
        MockTransport::new(true),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    )
}

fn gate_client() -> Client {
    Client::with_transport(
        MockTransport::new(false),
        Config {
            api_key: "sk_test".to_owned(),
            ..Config::default()
        },
    )
}

fn fixture_source() -> Arc<FixtureSource> {
    Arc::new(FixtureSource::from_dir(default_fixture_dir()))
}

fn host_with(
    client: Client,
    source: Arc<FixtureSource>,
    store: Arc<SessionStore>,
) -> McpHttpServer {
    build_host(
        client,
        PRODUCT,
        PUBLIC,
        source,
        store,
        fixed_now(1_700_000_100),
    )
    .expect("register")
}

async fn call(host: &McpHttpServer, tool: &str, arguments: Value, auth: bool) -> (u16, Value) {
    let mut headers = BTreeMap::new();
    if auth {
        headers.insert("authorization".to_owned(), TEST_BEARER.to_owned());
    }
    let response = host
        .handle(McpHttpRequest {
            method: "POST".to_owned(),
            path: "/mcp".to_owned(),
            headers,
            body: serde_json::to_vec(&json!({
                "jsonrpc": "2.0",
                "id": 1,
                "method": "tools/call",
                "params": { "name": tool, "arguments": arguments }
            }))
            .unwrap(),
        })
        .await
        .expect("handle");
    let body: Value = serde_json::from_slice(&response.body).unwrap();
    (response.status, body)
}

fn seed_session(store: &SessionStore) {
    store
        .put(
            "cus_1",
            Session {
                sid_token: Some("sid_alpha".to_owned()),
                email_addr: Some("solvatestinbox@guerrillamailblock.com".to_owned()),
                email_timestamp: Some(1_700_000_000),
            },
        )
        .unwrap();
}

#[tokio::test]
async fn inbox_open_returns_address_and_expiry() {
    let source = fixture_source();
    let store = Arc::new(SessionStore::new());
    let host = host_with(allow_client(), source, store);
    let (status, body) = call(&host, TOOL_INBOX_OPEN, json!({}), true).await;
    assert_eq!(status, 200, "{body}");
    let sc = &body["result"]["structuredContent"];
    assert_eq!(sc["address"], "solvatestinbox@guerrillamailblock.com");
    assert_eq!(sc["expiresInSeconds"], 3500);
}

#[tokio::test]
async fn tools_call_without_auth_returns_401_challenge() {
    let host = host_with(
        allow_client(),
        fixture_source(),
        Arc::new(SessionStore::new()),
    );
    let (status, body) = call(&host, TOOL_INBOX_OPEN, json!({}), false).await;
    assert_eq!(status, 401, "{body}");
}

#[tokio::test]
async fn paywall_returns_payment_required_and_does_not_call_upstream() {
    let source = fixture_source();
    let store = Arc::new(SessionStore::new());
    let host = host_with(gate_client(), source.clone(), store);
    let (status, body) = call(&host, TOOL_INBOX_OPEN, json!({}), true).await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["result"]["structuredContent"]["kind"],
        "payment_required"
    );
    assert_eq!(source.recorded_requests().unwrap().len(), 0);
}

#[tokio::test]
async fn inbox_list_decodes_entities() {
    let store = Arc::new(SessionStore::new());
    seed_session(&store);
    let host = host_with(allow_client(), fixture_source(), store);
    let (status, body) = call(&host, TOOL_INBOX_LIST, json!({}), true).await;
    assert_eq!(status, 200, "{body}");
    let sc = &body["result"]["structuredContent"];
    assert_eq!(sc["messages"][0]["subject"], "Hello & Welcome");
    assert_eq!(sc["messages"][0]["excerpt"], "fighter's ally");
}

#[tokio::test]
async fn inbox_list_notes_truncation_when_count_exceeds_20() {
    let store = Arc::new(SessionStore::new());
    seed_session(&store);
    let host = host_with(allow_client(), fixture_source(), store);
    let (status, body) = call(&host, TOOL_INBOX_LIST, json!({ "offset": "0" }), true).await;
    assert_eq!(status, 200, "{body}");
    let notes = body["result"]["structuredContent"]["notes"][0]
        .as_str()
        .unwrap();
    assert!(notes.contains("truncated"), "{notes}");
    assert!(notes.contains("25"), "{notes}");
}

#[tokio::test]
async fn message_read_unwraps_res_php_urls() {
    let store = Arc::new(SessionStore::new());
    seed_session(&store);
    let host = host_with(allow_client(), fixture_source(), store);
    let (status, body) = call(&host, TOOL_MESSAGE_READ, json!({ "email_id": "42" }), true).await;
    assert_eq!(status, 200, "{body}");
    let mail_body = body["result"]["structuredContent"]["body"]
        .as_str()
        .unwrap();
    assert!(!mail_body.contains("res.php"), "{mail_body}");
    assert!(
        mail_body.contains("https://cdn.example.com/logo.png"),
        "{mail_body}"
    );
    assert_eq!(
        body["result"]["structuredContent"]["subject"],
        "Invoice & receipt"
    );
}

#[tokio::test]
async fn message_delete_encodes_array_params_and_returns_ids() {
    let source = fixture_source();
    let store = Arc::new(SessionStore::new());
    seed_session(&store);
    let host = host_with(allow_client(), source.clone(), store);
    let (status, body) = call(
        &host,
        TOOL_MESSAGE_DELETE,
        json!({ "email_ids": "425,426" }),
        true,
    )
    .await;
    assert_eq!(status, 200, "{body}");
    assert_eq!(
        body["result"]["structuredContent"]["deletedIds"],
        json!(["425", "426"])
    );
    let recorded = source.recorded_requests().unwrap();
    let del = recorded
        .iter()
        .find(|r| r.function == "del_email")
        .expect("del_email");
    let ids: Vec<&str> = del
        .params
        .iter()
        .filter(|(k, _)| k == "email_ids[]")
        .map(|(_, v)| v.as_str())
        .collect();
    assert_eq!(ids, ["425", "426"]);
}

#[tokio::test]
async fn inbox_extend_affected_zero_is_an_explicit_note() {
    let source = Arc::new(
        FixtureSource::from_dir(default_fixture_dir()).override_function(
            "extend",
            json!({
                "affected": 0,
                "sid_token": "sid_alpha"
            }),
        ),
    );
    let store = Arc::new(SessionStore::new());
    seed_session(&store);
    let host = host_with(allow_client(), source, store);
    let (status, body) = call(&host, TOOL_INBOX_EXTEND, json!({}), true).await;
    assert_eq!(status, 200, "{body}");
    let sc = &body["result"]["structuredContent"];
    assert_eq!(sc["affected"], 0);
    let note = sc["notes"][0].as_str().unwrap();
    assert!(note.contains("affected:0"), "{note}");
}

#[tokio::test]
async fn tools_list_advertises_five_string_tools_without_required() {
    let host = host_with(
        allow_client(),
        fixture_source(),
        Arc::new(SessionStore::new()),
    );
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
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    for expected in [
        TOOL_INBOX_OPEN,
        TOOL_INBOX_LIST,
        TOOL_MESSAGE_READ,
        TOOL_MESSAGE_DELETE,
        TOOL_INBOX_EXTEND,
    ] {
        let tool = tools
            .iter()
            .find(|t| t["name"] == expected)
            .unwrap_or_else(|| panic!("missing {expected} in {names:?}"));
        assert!(tool["title"].as_str().is_some(), "{expected} title");
        assert!(
            tool["description"].as_str().is_some(),
            "{expected} description"
        );
        let schema = &tool["inputSchema"];
        assert_eq!(schema["type"], "object");
        assert!(
            schema.get("required").is_none(),
            "{expected} must not add required"
        );
        if let Some(props) = schema["properties"].as_object() {
            for (name, spec) in props {
                assert_eq!(spec["type"], "string", "{expected}.{name}");
            }
        }
    }
}
