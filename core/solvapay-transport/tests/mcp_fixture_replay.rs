//! Replay `contract/mcp-fixtures/` async MCP ops against [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::fs;
use std::path::Path;
use std::sync::Arc;

use serde_json::{json, Value};
use solvapay_transport::{
    ClientShell, McpCallBuiltinToolParams, McpDispatchParams, McpOauthRequestParams,
    McpResolveAuthParams, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

fn discover(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).unwrap() {
            let path = entry.unwrap().path();
            if path.is_dir() {
                walk(&path, root, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                out.push(
                    path.strip_prefix(root)
                        .unwrap()
                        .to_string_lossy()
                        .replace('\\', "/"),
                );
            }
        }
    }
    let mut rels = Vec::new();
    walk(root, root, &mut rels);
    rels.sort();
    rels
}

fn load(root: &Path, rel: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(root.join(rel)).unwrap()).unwrap()
}

fn client_at(base_url: &str) -> SolvaPayClient {
    let transport: SharedTransport = Arc::new(ReqwestTransport::new().expect("reqwest"));
    SolvaPayClient::new(ClientShell::new(transport, "sk_test_fixture").with_base_url(base_url))
}

fn client(server: &MockServer) -> SolvaPayClient {
    client_at(&server.uri())
}

async fn mount_http(server: &MockServer, fixture: &Value) {
    let Some(stubs) = fixture.get("http").and_then(Value::as_array) else {
        return;
    };
    for stub in stubs {
        let m = stub.get("method").and_then(Value::as_str).unwrap_or("GET");
        let p = stub.get("path").and_then(Value::as_str).unwrap();
        let status = stub.get("status").and_then(Value::as_u64).unwrap_or(200) as u16;
        let body = stub.get("body").cloned().unwrap_or(json!({}));
        Mock::given(method(m))
            .and(path(p))
            .respond_with(ResponseTemplate::new(status).set_body_json(body))
            .mount(server)
            .await;
    }
}

fn assert_oauth(rel: &str, got: &Value, expect: &Value, server: &MockServer) {
    assert_eq!(got["status"], expect["status"], "{rel} status");
    assert_eq!(got["body"], expect["body"], "{rel} body");
    if rel.contains("authorize") {
        let got_loc = got["headers"]["location"].as_str().unwrap_or("");
        assert!(
            got_loc.ends_with("/v1/customer/auth/authorize?client_id=abc"),
            "{rel} location {got_loc} (base {})",
            server.uri()
        );
        return;
    }
    let expect_headers = expect["headers"].as_object();
    if let Some(want) = expect_headers {
        for (k, v) in want {
            assert_eq!(got["headers"][k], *v, "{rel} header {k}");
        }
    }
}

fn strip_token(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.remove("token");
    }
    value
}

#[tokio::test]
async fn replays_async_mcp_fixtures() {
    let root = repo_paths::load().unwrap().lookup("mcpFixtures").unwrap();
    let mut ran = 0u32;
    for rel in discover(&root) {
        let fixture = load(&root, &rel);
        let fn_name = fixture["input"]["fn"].as_str().unwrap();
        if !matches!(
            fn_name,
            "mcpCallBuiltinTool" | "mcpOauthRequest" | "mcpDispatch" | "mcpResolveAuth"
        ) {
            continue;
        }
        let server = MockServer::start().await;
        mount_http(&server, &fixture).await;
        let args = fixture["input"]["args"].clone();
        let expect = fixture["expect"]["result"].clone();
        let unreachable = expect.get("status") == Some(&json!(502))
            && expect.get("body").and_then(|b| b.get("error"))
                == Some(&json!("upstream_unreachable"));
        let sp = if unreachable {
            client_at("http://127.0.0.1:1")
        } else {
            client(&server)
        };
        let got = match fn_name {
            "mcpCallBuiltinTool" => {
                let params: McpCallBuiltinToolParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                sp.mcp_call_builtin_tool(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpOauthRequest" => {
                let params: McpOauthRequestParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                sp.mcp_oauth_request(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpDispatch" => {
                let params: McpDispatchParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                sp.mcp_dispatch(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpResolveAuth" => {
                let params: McpResolveAuthParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                sp.mcp_resolve_auth(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            _ => unreachable!(),
        };
        if fn_name == "mcpOauthRequest" {
            assert_oauth(&rel, &got, &expect, &server);
        } else if fn_name == "mcpDispatch" && rel.ends_with("invoke-handler.json") {
            assert_eq!(strip_token(got.clone())["kind"], expect["kind"], "{rel}");
            assert_eq!(got["tool"], expect["tool"], "{rel}");
            assert_eq!(got["args"], expect["args"], "{rel}");
            assert_eq!(got["customerRef"], expect["customerRef"], "{rel}");
            assert!(got["token"].as_str().unwrap().len() > 8, "{rel}");
        } else {
            assert_eq!(got, expect, "{rel}");
        }
        ran += 1;
    }
    assert!(ran > 0, "no async MCP fixtures ran");
}
