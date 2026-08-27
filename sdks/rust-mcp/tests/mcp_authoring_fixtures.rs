//! Replay `contract/mcp-fixtures/` against a real rmcp server.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::path::Path;

use common::driver::{call_registered_payable, tool_results_equal};
use common::mock_transport::{project_usage, MockTransport};
use common::repo_paths::lookup_mcp_fixtures;
use common::scenario::{parse_observation, parse_scenario, UsageProjection};
use serde_json::{json, Value};
use solvapay::transport::{
    McpBootstrapParams, McpCallBuiltinToolParams, McpDispatchParams, McpOauthRequestParams,
};
use solvapay::{Client, Config};
use solvapay_mcp::{
    call_sync, McpHttpConfig, McpHttpRequest, McpHttpServer, PayableHandler, PayableTool,
    ResponseContext,
};
use std::collections::BTreeMap;
use std::sync::Arc;
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

const MCP_AUTHORING_FIXTURES: &[&str] = &[
    "allow/respond-emitted-blocks.json",
    "allow/respond-key-order.json",
    "allow/respond-minimal.json",
    "allow/respond-nudge.json",
    "allow/respond-text-option.json",
    "auth-gate/allow-initialize.json",
    "auth-gate/allow-tools-call-with-bearer.json",
    "auth-gate/challenge-tools-call.json",
    "bootstrap/unauthenticated.json",
    "builtin-tools/activate-plan-no-ref.json",
    "builtin-tools/activate-plan.json",
    "builtin-tools/attach-business-details-unauth.json",
    "builtin-tools/attach-business-details.json",
    "builtin-tools/cancel-renewal-unauth.json",
    "builtin-tools/cancel-renewal.json",
    "builtin-tools/create-checkout-session-unauth.json",
    "builtin-tools/create-checkout-session.json",
    "builtin-tools/create-customer-session-unauth.json",
    "builtin-tools/create-customer-session.json",
    "builtin-tools/create-payment-intent-unauth.json",
    "builtin-tools/create-payment-intent.json",
    "builtin-tools/create-topup-payment-intent-unauth.json",
    "builtin-tools/create-topup-payment-intent.json",
    "builtin-tools/manage-account.json",
    "builtin-tools/process-payment-unauth.json",
    "builtin-tools/process-payment.json",
    "builtin-tools/reactivate-renewal-unauth.json",
    "builtin-tools/reactivate-renewal.json",
    "builtin-tools/topup.json",
    "builtin-tools/upgrade.json",
    "config-log/once.json",
    "csp/default.json",
    "csp/with-api-origin.json",
    "customer-ref/from-hook.json",
    "customer-ref/from-tool-args.json",
    "dcr/generic-reject.json",
    "dcr/unresolved-product.json",
    "descriptors/default-all-views.json",
    "descriptors/views-checkout-only.json",
    "dispatch/challenge.json",
    "dispatch/invoke-handler.json",
    "dispatch/rpc.json",
    "engine/gate-denied.json",
    "engine/initialize.json",
    "engine/invoke-handler.json",
    "engine/tools-list.json",
    "error/handler-throws.json",
    "gate/activation-required.json",
    "gate/handler-invoked.json",
    "gate/payment-required.json",
    "hide-tools/bypass-chatgpt.json",
    "hide-tools/filter-ui-audience.json",
    "narrate/activate-plan.json",
    "narrate/manage-account-active.json",
    "narrate/manage-account.json",
    "narrate/mode-auto.json",
    "narrate/mode-text.json",
    "narrate/mode-ui.json",
    "narrate/placeholder.json",
    "narrate/topup.json",
    "narrate/upgrade.json",
    "oauth-proxy/authorize.json",
    "oauth-proxy/discovery-authorization-server.json",
    "oauth-proxy/discovery-post-405.json",
    "oauth-proxy/discovery-protected-resource.json",
    "oauth-proxy/openid-404.json",
    "oauth-proxy/paths-override.json",
    "oauth-proxy/register-502.json",
    "oauth-proxy/token-502.json",
    "oauth/discovery-authorization-server.json",
    "oauth/discovery-protected-resource-mcp-path.json",
    "oauth/discovery-protected-resource.json",
    "oauth/normalize-nestjs-401.json",
    "oauth/normalize-rfc-passthrough.json",
    "overview/resource.json",
];

fn register_payable_fixtures() -> impl Iterator<Item = &'static str> {
    MCP_AUTHORING_FIXTURES.iter().copied().filter(|rel| {
        rel.starts_with("allow/")
            || rel.starts_with("customer-ref/")
            || rel.starts_with("error/")
            || rel.starts_with("gate/")
    })
}

fn core_op_fixtures() -> impl Iterator<Item = &'static str> {
    MCP_AUTHORING_FIXTURES.iter().copied().filter(|rel| {
        !(rel.starts_with("allow/")
            || rel.starts_with("customer-ref/")
            || rel.starts_with("error/")
            || rel.starts_with("gate/")
            || rel.starts_with("bootstrap/")
            || rel.starts_with("builtin-tools/")
            || rel.starts_with("oauth-proxy/")
            || rel.starts_with("dispatch/"))
    })
}

fn async_op_fixtures() -> impl Iterator<Item = &'static str> {
    MCP_AUTHORING_FIXTURES.iter().copied().filter(|rel| {
        rel.starts_with("bootstrap/")
            || rel.starts_with("builtin-tools/")
            || rel.starts_with("oauth-proxy/")
            || rel.starts_with("dispatch/")
    })
}

fn usage_projection_json(item: &UsageProjection) -> Value {
    let units = if item.units.fract() == 0.0 {
        json!(item.units as i64)
    } else {
        json!(item.units)
    };
    json!({
        "outcome": item.outcome,
        "actionType": item.action_type,
        "units": units,
        "productRef": item.product_ref,
        "customerRef": item.customer_ref,
        "metadata": { "action": item.metadata.get("action") },
    })
}

fn discover(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).expect("read_dir") {
            let entry = entry.expect("dirent");
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let rel = path
                    .strip_prefix(root)
                    .expect("prefix")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(rel);
            }
        }
    }
    let mut rels = Vec::new();
    walk(root, root, &mut rels);
    rels.sort();
    rels
}

fn load_fixture(root: &Path, rel: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(root.join(rel)).expect("read fixture"))
        .expect("parse fixture")
}

#[test]
fn discovers_the_frozen_fixture_list() {
    let root = lookup_mcp_fixtures();
    assert_eq!(discover(&root), MCP_AUTHORING_FIXTURES);
}

#[test]
fn fixture_round_trips_strict_schema() {
    let root = lookup_mcp_fixtures();
    for rel in register_payable_fixtures() {
        let raw = load_fixture(&root, rel);
        assert_eq!(raw["input"]["fn"], "registerPayable");
        parse_scenario(raw["input"]["args"].clone());
        parse_observation(raw["expect"]["result"].clone());
    }
}

#[tokio::test]
async fn replays_fixtures() {
    let root = lookup_mcp_fixtures();
    for rel in register_payable_fixtures() {
        let raw = load_fixture(&root, rel);
        let scenario = parse_scenario(raw["input"]["args"].clone());
        let observation = parse_observation(raw["expect"]["result"].clone());
        let backend = MockTransport::new(scenario.limits.clone());
        let tool_result = call_registered_payable(backend.clone(), &scenario)
            .await
            .unwrap_or_else(|e| panic!("{rel}: call failed: {e}"));
        let usage = project_usage(&backend.usages());
        assert!(
            tool_results_equal(&tool_result, &observation.tool_result),
            "{rel} toolResult\ngot: {}\nwant: {}",
            serde_json::to_string_pretty(&tool_result).expect("json"),
            serde_json::to_string_pretty(&observation.tool_result).expect("json")
        );
        let want_usage: Vec<Value> = observation
            .usage
            .iter()
            .map(usage_projection_json)
            .collect();
        assert_eq!(usage, want_usage, "{rel} usage");
    }
}

#[test]
fn replays_core_ops() {
    let root = lookup_mcp_fixtures();
    for rel in core_op_fixtures() {
        let raw = load_fixture(&root, rel);
        let fn_name = raw["input"]["fn"].as_str().expect(rel);
        let args = raw["input"]["args"].clone();
        let expect = raw["expect"]["result"].clone();
        let got = call_sync(fn_name, &args).unwrap_or_else(|e| panic!("{rel}: {e}"));
        if fn_name == "mcpHandleRequest" && rel.ends_with("tools-list.json") {
            assert_eq!(got["kind"], "rpc", "{rel}");
            assert!(
                got["rpc"]["result"]["tools"].as_array().unwrap().len() >= 8,
                "{rel}"
            );
            continue;
        }
        if fn_name == "mcpHandleRequest" && rel.ends_with("invoke-handler.json") {
            assert_eq!(got["kind"], "invokeHandler", "{rel}");
            assert_eq!(got["tool"], expect["tool"], "{rel}");
            assert_eq!(got["args"], expect["args"], "{rel}");
            assert_eq!(got["customerRef"], expect["customerRef"], "{rel}");
            assert!(got["token"].as_str().unwrap().len() > 8, "{rel}");
            continue;
        }
        assert_eq!(got, expect, "{rel}");
    }
}

fn strip_token(mut value: Value) -> Value {
    if let Some(obj) = value.as_object_mut() {
        obj.remove("token");
    }
    value
}

fn client_at(base_url: &str) -> Client {
    Client::new(Config {
        api_key: "sk_test_fixture".to_owned(),
        api_base_url: Some(base_url.to_owned()),
        ..Config::default()
    })
    .expect("client")
}

async fn mount_http(server: &MockServer, fixture: &Value) {
    let stubs = fixture.get("http").and_then(Value::as_array);
    let default_bootstrap = fixture["input"]["fn"] == "mcpBootstrap" && stubs.is_none();
    let owned: Vec<Value> = if default_bootstrap {
        vec![
            json!({"method":"GET","path":"/v1/sdk/platform-config","status":200,"body":{"stripePublishableKey":"pk_test"}}),
            json!({"method":"GET","path":"/v1/sdk/merchant","status":200,"body":{"displayName":"Acme"}}),
            json!({"method":"GET","path":"/v1/sdk/products/prd_demo","status":200,"body":{"name":"Demo"}}),
            json!({"method":"GET","path":"/v1/sdk/products/prd_demo/plans","status":200,"body":{"plans":[{"name":"Pro"}]}}),
        ]
    } else {
        stubs.cloned().unwrap_or_default()
    };
    for stub in &owned {
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
    if let Some(want) = expect["headers"].as_object() {
        for (k, v) in want {
            assert_eq!(got["headers"][k], *v, "{rel} header {k}");
        }
    }
}

fn lowercase_headers(raw: &Value) -> BTreeMap<String, String> {
    let mut headers = BTreeMap::new();
    let Some(map) = raw.as_object() else {
        return headers;
    };
    for (key, value) in map {
        if let Some(text) = value.as_str() {
            headers.insert(key.to_ascii_lowercase(), text.to_owned());
        }
    }
    headers
}

#[tokio::test]
async fn replays_async_ops() {
    let root = lookup_mcp_fixtures();
    for rel in async_op_fixtures() {
        let fixture = load_fixture(&root, rel);
        let fn_name = fixture["input"]["fn"].as_str().expect(rel);
        let server = MockServer::start().await;
        mount_http(&server, &fixture).await;
        let args = fixture["input"]["args"].clone();
        let expect = fixture["expect"]["result"].clone();
        let unreachable = expect.get("status") == Some(&json!(502))
            && expect.get("body").and_then(|b| b.get("error"))
                == Some(&json!("upstream_unreachable"));
        let client = if unreachable {
            client_at("http://127.0.0.1:1")
        } else {
            client_at(&server.uri())
        };
        let got = match fn_name {
            "mcpCallBuiltinTool" => {
                let params: McpCallBuiltinToolParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                client
                    .mcp_call_builtin_tool(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpOauthRequest" => {
                let params: McpOauthRequestParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                client
                    .mcp_oauth_request(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpDispatch" => {
                let params: McpDispatchParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                client
                    .mcp_dispatch(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            "mcpBootstrap" => {
                let params: McpBootstrapParams =
                    serde_json::from_value(args).unwrap_or_else(|e| panic!("{rel}: {e:?}"));
                client
                    .mcp_bootstrap(params)
                    .await
                    .unwrap_or_else(|e| panic!("{rel}: {e:?}"))
            }
            other => panic!("{rel}: unexpected fn {other}"),
        };
        if fn_name == "mcpOauthRequest" {
            assert_oauth(rel, &got, &expect, &server);
        } else if (fn_name == "mcpDispatch" || fn_name == "mcpHandleRequest")
            && rel.ends_with("invoke-handler.json")
        {
            assert_eq!(strip_token(got.clone())["kind"], expect["kind"], "{rel}");
            assert_eq!(got["tool"], expect["tool"], "{rel}");
            assert_eq!(got["args"], expect["args"], "{rel}");
            assert_eq!(got["customerRef"], expect["customerRef"], "{rel}");
            assert!(got["token"].as_str().unwrap().len() > 8, "{rel}");
        } else {
            assert_eq!(got, expect, "{rel}");
        }
    }
}

#[tokio::test]
async fn replays_dispatch_and_oauth_through_http_server() {
    let root = lookup_mcp_fixtures();
    for rel in MCP_AUTHORING_FIXTURES
        .iter()
        .copied()
        .filter(|rel| rel.starts_with("dispatch/") || rel.starts_with("oauth-proxy/"))
    {
        if rel.ends_with("invoke-handler.json") {
            continue;
        }
        let fixture = load_fixture(&root, rel);
        let fn_name = fixture["input"]["fn"].as_str().expect(rel);
        let args = fixture["input"]["args"].clone();
        let expect = fixture["expect"]["result"].clone();
        let server = MockServer::start().await;
        mount_http(&server, &fixture).await;
        let unreachable = expect.get("status") == Some(&json!(502))
            && expect.get("body").and_then(|b| b.get("error"))
                == Some(&json!("upstream_unreachable"));
        let client = if unreachable {
            client_at("http://127.0.0.1:1")
        } else {
            client_at(&server.uri())
        };
        let mut host = McpHttpServer::new(
            client,
            McpHttpConfig {
                product_ref: args
                    .pointer("/config/productRef")
                    .and_then(Value::as_str)
                    .unwrap_or("prd_demo")
                    .to_owned(),
                public_base_url: args
                    .pointer("/config/publicBaseUrl")
                    .and_then(Value::as_str)
                    .unwrap_or("https://app.example.com")
                    .to_owned(),
                resource_uri: args
                    .pointer("/config/resourceUri")
                    .and_then(Value::as_str)
                    .map(str::to_owned),
                mcp_path: args
                    .pointer("/config/mcpPath")
                    .and_then(Value::as_str)
                    .map(str::to_owned)
                    .or_else(|| Some("/mcp".to_owned())),
                views: None,
                oauth_paths: args
                    .pointer("/config/oauthPaths")
                    .cloned()
                    .map(|value| serde_json::from_value(value).expect("oauthPaths")),
            },
        );
        if fn_name == "mcpDispatch" {
            if let Some(names) = args.pointer("/config/payableTools").and_then(Value::as_array)
            {
                for name in names {
                    let name = name.as_str().unwrap().to_owned();
                    let handler: PayableHandler = Arc::new(|_, mut ctx: ResponseContext| {
                        Box::pin(async move { ctx.respond(json!({ "ok": true }), None) })
                    });
                    host.register_payable(
                        PayableTool {
                            name,
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
                }
            }
        }
        let req = if fn_name == "mcpDispatch" {
            McpHttpRequest {
                method: "POST".to_owned(),
                path: "/mcp".to_owned(),
                headers: {
                    let mut headers = BTreeMap::new();
                    if let Some(auth) = args.get("authHeader").and_then(Value::as_str) {
                        headers.insert("authorization".to_owned(), auth.to_owned());
                    }
                    headers
                },
                body: serde_json::to_vec(&args["rpc"]).expect("rpc"),
            }
        } else {
            McpHttpRequest {
                method: args["method"].as_str().unwrap().to_owned(),
                path: args["path"].as_str().unwrap().to_owned(),
                headers: lowercase_headers(&args["headers"]),
                body: args["body"].as_str().unwrap_or("").as_bytes().to_vec(),
            }
        };
        let got = host.handle(req).await.unwrap_or_else(|e| panic!("{rel}: {e:?}"));
        if fn_name == "mcpOauthRequest" {
            let body: Value = if got.body.is_empty() {
                Value::Null
            } else {
                serde_json::from_slice(&got.body).unwrap_or_else(|_| {
                    Value::String(String::from_utf8_lossy(&got.body).into_owned())
                })
            };
            let envelope = json!({
                "status": got.status,
                "headers": got.headers,
                "body": body,
            });
            assert_oauth(rel, &envelope, &expect, &server);
        } else if expect["kind"] == "challenge" {
            assert_eq!(got.status, expect["status"], "{rel}");
            let body: Value = serde_json::from_slice(&got.body).expect(rel);
            assert_eq!(body, expect["body"], "{rel}");
            if let Some(want) = expect["headers"].as_object() {
                for (k, v) in want {
                    if k.eq_ignore_ascii_case("www-authenticate") {
                        let got_header = got
                            .headers
                            .get(&k.to_ascii_lowercase())
                            .cloned()
                            .unwrap_or_default();
                        assert!(
                            got_header.contains("Bearer resource_metadata="),
                            "{rel} WWW-Authenticate {got_header}"
                        );
                        continue;
                    }
                    assert_eq!(
                        got.headers.get(&k.to_ascii_lowercase()).map(String::as_str),
                        v.as_str(),
                        "{rel} header {k}"
                    );
                }
            }
        } else {
            assert_eq!(got.status, 200, "{rel}");
            let body: Value = serde_json::from_slice(&got.body).expect(rel);
            assert_eq!(body, expect["rpc"], "{rel}");
        }
    }
}
