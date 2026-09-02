//! Phase 0 client fixture conformance through the facade [`solvapay::Client`] (Step 47).

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

mod support;

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, HttpMethod};
use serde_json::{json, Value};
use solvapay::transport::{mulberry32, ClientShell, ReqwestTransport, SharedTransport};
use solvapay::{Allow, Client, Config, GateOpts, GateOutcome, TrackOpts};
use solvapay_core::{PaywallGate, PaywallGateKind, SdkError};
use support::{
    assert_expect, clock_ms_from_iso, dispatch_group_a, dispatch_group_b, dispatch_group_c,
    is_group_a_fixture, is_group_b_fixture, is_group_c_fixture, GROUP_A_FNS, GROUP_B_FNS,
    GROUP_C_FNS,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const ALL_OPS: &[&str] = &[
    "activatePlan",
    "assignCredits",
    "attachBusinessDetails",
    "bootstrapMcpProduct",
    "cancelPurchase",
    "checkLimits",
    "cloneProduct",
    "configureMcpPlans",
    "createCheckoutSession",
    "createCustomer",
    "createCustomerSession",
    "createPaymentIntent",
    "createPlan",
    "createProduct",
    "createTopupPaymentIntent",
    "deletePlan",
    "deleteProduct",
    "disableAutoRecharge",
    "getAutoRecharge",
    "getCustomer",
    "getCustomerBalance",
    "getMerchant",
    "getPaymentMethod",
    "getPlatformConfig",
    "getProduct",
    "getUserInfo",
    "listPlans",
    "listProducts",
    "processPaymentIntent",
    "reactivatePurchase",
    "saveAutoRecharge",
    "trackUsage",
    "trackUsageBulk",
    "updateCustomer",
    "updatePlan",
    "updateProduct",
];

#[tokio::test]
async fn facade_inventory_has_success_and_error_per_operation() {
    let fixtures = load_all_client_fixtures(&client_fixtures_root());
    assert_eq!(ALL_OPS.len(), 36);
    assert_eq!(
        GROUP_A_FNS.len() + GROUP_B_FNS.len() + GROUP_C_FNS.len(),
        36
    );

    let mut success: BTreeSet<&str> = BTreeSet::new();
    let mut error: BTreeSet<&str> = BTreeSet::new();
    for (_, fixture) in &fixtures {
        let name = fixture.input.fn_name.as_str();
        match &fixture.expect {
            fixture_runner::FixtureExpect::Result(_) => {
                success.insert(name);
            }
            fixture_runner::FixtureExpect::Error(_) => {
                error.insert(name);
            }
        }
    }
    for op in ALL_OPS {
        assert!(success.contains(op), "missing success fixture for {op}");
        assert!(error.contains(op), "missing error fixture for {op}");
    }
}

#[tokio::test]
async fn facade_replays_all_phase0_client_fixtures() {
    let fixtures = load_all_client_fixtures(&client_fixtures_root());
    assert!(
        !fixtures.is_empty(),
        "no client fixtures under {}",
        client_fixtures_root().display()
    );

    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
    let shared: SharedTransport = Arc::new(transport);
    let mut failures: Vec<String> = Vec::new();

    for (path, fixture) in &fixtures {
        if let Err(err) = run_one(Arc::clone(&shared), fixture).await {
            failures.push(format!("{} ({}): {err}", path.display(), fixture.case));
        }
    }

    assert!(
        failures.is_empty(),
        "facade fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    let server = if fixture.wire.is_some() {
        Some(MockServer::start().await)
    } else {
        None
    };

    let mut shell = ClientShell::new(transport, "sk_test_fixture");
    if let (Some(server), Some(wire)) = (server.as_ref(), fixture.wire.as_ref()) {
        mount_wire(server, wire).await?;
        shell = shell.with_base_url(server.uri());
    } else {
        shell = shell.with_base_url("http://127.0.0.1:1");
    }

    if let Some(clock) = &fixture.input.clock {
        let ms = clock_ms_from_iso(clock)?;
        shell = shell.with_clock(Arc::new(move || ms));
    }
    if let Some(seed) = fixture.input.rng_seed {
        let seed = u32::try_from(seed).map_err(|_| format!("rngSeed out of u32 range: {seed}"))?;
        shell = shell.with_rng(Arc::new(mulberry32(seed)));
    }

    let client = Client::with_shell(
        shell,
        Config {
            api_key: "sk_test_fixture".to_owned(),
            ..Config::default()
        },
    );

    let outcome = if is_group_a_fixture(fixture) {
        dispatch_group_a(&client, fixture).await
    } else if is_group_b_fixture(fixture) {
        dispatch_group_b(&client, fixture).await
    } else if is_group_c_fixture(fixture) {
        dispatch_group_c(&client, fixture).await
    } else {
        return Err(format!("unsupported fixture fn {}", fixture.input.fn_name));
    };

    let result = assert_expect(outcome, &fixture.expect);
    drop(server);
    result
}

async fn mount_wire(server: &MockServer, wire: &fixture_runner::Wire) -> Result<(), String> {
    let mut mock =
        Mock::given(method(fixture_method_str(&wire.request.method))).and(path(&wire.request.path));

    if let Some(query) = &wire.request.query {
        for (key, value) in query {
            mock = mock.and(query_param(key.as_str(), value.as_str()));
        }
    }

    if let Some(headers) = &wire.request.headers {
        for (name, value) in headers {
            mock = mock.and(header(name.as_str(), value.as_str()));
        }
    }

    if let Some(body) = &wire.request.body {
        mock = mock.and(body_json(body));
    }

    let status = u16::try_from(wire.response.status)
        .map_err(|_| format!("status out of u16 range: {}", wire.response.status))?;
    let body_bytes = response_body_bytes(&wire.response.body)?;
    mock.respond_with(ResponseTemplate::new(status).set_body_bytes(body_bytes))
        .mount(server)
        .await;
    Ok(())
}

fn response_body_bytes(body: &Value) -> Result<Vec<u8>, String> {
    match body {
        Value::String(s) => Ok(s.as_bytes().to_vec()),
        other => serde_json::to_vec(other).map_err(|err| format!("serialize response body: {err}")),
    }
}

fn fixture_method_str(method: &HttpMethod) -> &'static str {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Delete => "DELETE",
    }
}

fn client_fixtures_root() -> PathBuf {
    repo_paths::load()
        .expect("repo-paths")
        .client_fixtures()
        .expect("client fixtures")
}

#[tokio::test]
async fn facade_replays_driver_loop_fixtures() {
    let fixtures = load_driver_loop_fixtures();
    assert_eq!(fixtures.len(), 5, "expected five driver-loop fixtures");
    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
    let shared: SharedTransport = Arc::new(transport);
    let mut failures: Vec<String> = Vec::new();
    for (path, fixture) in &fixtures {
        if let Err(err) = run_driver_loop(Arc::clone(&shared), fixture).await {
            failures.push(format!("{} ({}): {err}", path.display(), fixture.case));
        }
    }
    assert!(
        failures.is_empty(),
        "driver-loop fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_driver_loop(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    let wire = fixture
        .wire
        .as_ref()
        .ok_or("driver-loop fixture needs wire")?;
    let server = MockServer::start().await;
    for exchange in wire.routes() {
        mount_exchange(&server, exchange).await?;
    }
    let mut shell = ClientShell::new(transport, "sk_test_fixture").with_base_url(server.uri());
    if let Some(clock) = &fixture.input.clock {
        let ms = clock_ms_from_iso(clock)?;
        shell = shell.with_clock(Arc::new(move || ms));
    }
    let client = Client::with_shell(
        shell,
        Config {
            api_key: "sk_test_fixture".to_owned(),
            ..Config::default()
        },
    );
    let args = &fixture.input.args;
    let customer_ref = args
        .get("customerRef")
        .and_then(Value::as_str)
        .ok_or("customerRef")?;
    let product = args
        .get("product")
        .and_then(Value::as_str)
        .ok_or("product")?;
    let usage_type = args
        .get("usageType")
        .and_then(Value::as_str)
        .unwrap_or("requests");
    let handler = args
        .get("handler")
        .and_then(Value::as_str)
        .unwrap_or("success");
    let prime = args
        .get("primeCache")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    let opts = GateOpts {
        product: product.to_owned(),
        usage_type: usage_type.to_owned(),
    };

    let outcome = match fixture.input.fn_name.as_str() {
        "driveGate" if prime => {
            client
                .gate(customer_ref, opts.clone())
                .await
                .map_err(|e| format!("{e:?}"))?;
            let primed = server.received_requests().await.unwrap_or_default().len();
            let gate = client
                .gate(customer_ref, opts)
                .await
                .map_err(|e| format!("{e:?}"))?;
            let kind = match gate {
                GateOutcome::Allow(_) => "allow",
                GateOutcome::Paywall(_) => "gate",
            };
            let received = server.received_requests().await.unwrap_or_default();
            json!({
                "requests": request_trace(&received[primed..]),
                "outcome": { "type": "resolved", "kind": kind }
            })
        }
        "driveGate" => {
            let gate = client
                .gate(customer_ref, opts)
                .await
                .map_err(|e| format!("{e:?}"))?;
            let GateOutcome::Allow(allow) = gate else {
                return Err("expected allow".to_owned());
            };
            apply_handler(&allow, handler).await?;
            let received = server.received_requests().await.unwrap_or_default();
            handler_observation(handler, request_trace(&received))
        }
        "drivePayable" => {
            let payable = client.payable(product, usage_type);
            let gate = payable
                .gate(customer_ref)
                .await
                .map_err(|e| format!("{e:?}"))?;
            let GateOutcome::Allow(allow) = gate else {
                return Err("expected allow".to_owned());
            };
            allow
                .track_success(TrackOpts::default())
                .await
                .map_err(|e| format!("{e:?}"))?;
            let received = server.received_requests().await.unwrap_or_default();
            json!({
                "requests": request_trace(&received),
                "outcome": { "type": "resolved", "kind": "done" }
            })
        }
        other => return Err(format!("unsupported driver fn {other}")),
    };

    match &fixture.expect {
        fixture_runner::FixtureExpect::Result(expected) => {
            if outcome != *expected {
                return Err(format!(
                    "result mismatch:\n  got: {outcome}\n  expected: {expected}"
                ));
            }
            Ok(())
        }
        fixture_runner::FixtureExpect::Error(_) => {
            Err("driver-loop fixtures use expect.result".to_owned())
        }
    }
}

async fn apply_handler(allow: &Allow, handler: &str) -> Result<(), String> {
    match handler {
        "throwPaywall" => allow
            .track_fail(scripted_paywall(), TrackOpts::default())
            .await
            .map_err(|e| format!("{e:?}")),
        "throwGeneric" => allow
            .track_fail("boom", TrackOpts::default())
            .await
            .map_err(|e| format!("{e:?}")),
        _ => allow
            .track_success(TrackOpts::default())
            .await
            .map_err(|e| format!("{e:?}")),
    }
}

fn scripted_paywall() -> SdkError {
    SdkError::paywall(
        "Payment required",
        PaywallGate {
            kind: PaywallGateKind::PaymentRequired,
            product: "prd_demo".to_owned(),
            checkout_url: String::new(),
            message: "Payment required".to_owned(),
            short_message: "Payment required".to_owned(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
        },
    )
}

fn handler_observation(handler: &str, requests: Value) -> Value {
    match handler {
        "throwPaywall" => json!({
            "requests": requests,
            "outcome": { "type": "rejected", "name": "PaywallError" }
        }),
        "throwGeneric" => json!({
            "requests": requests,
            "outcome": { "type": "rejected", "name": "Error", "message": "boom" }
        }),
        _ => json!({
            "requests": requests,
            "outcome": { "type": "resolved", "kind": "allow" }
        }),
    }
}

fn request_trace(received: &[wiremock::Request]) -> Value {
    Value::Array(
        received
            .iter()
            .map(|req| {
                json!({
                    "method": req.method.to_string(),
                    "path": req.url.path()
                })
            })
            .collect(),
    )
}

async fn mount_exchange(
    server: &MockServer,
    exchange: &fixture_runner::WireExchange,
) -> Result<(), String> {
    let status = u16::try_from(exchange.response.status)
        .map_err(|_| format!("status out of u16 range: {}", exchange.response.status))?;
    let body_bytes = response_body_bytes(&exchange.response.body)?;
    Mock::given(method(fixture_method_str(&exchange.request.method)))
        .and(path(&exchange.request.path))
        .respond_with(ResponseTemplate::new(status).set_body_bytes(body_bytes))
        .mount(server)
        .await;
    Ok(())
}

fn driver_loop_root() -> PathBuf {
    repo_paths::load()
        .expect("repo-paths")
        .contract_fixtures()
        .expect("fixtures")
        .join("driver-loop")
}

fn load_driver_loop_fixtures() -> Vec<(PathBuf, Fixture)> {
    let root = driver_loop_root();
    let mut out = Vec::new();
    for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(path).unwrap_or_else(|err| {
            panic!("read {}: {err}", path.display());
        });
        let value: Value = serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!("parse JSON {}: {err}", path.display());
        });
        let fixture = parse_fixture(&value).unwrap_or_else(|err| {
            panic!("parse fixture {}: {err}", path.display());
        });
        if fixture.wire.is_none() {
            continue;
        }
        out.push((path.to_path_buf(), fixture));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

fn load_all_client_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(path).unwrap_or_else(|err| {
            panic!("read {}: {err}", path.display());
        });
        let value: Value = serde_json::from_str(&text).unwrap_or_else(|err| {
            panic!("parse JSON {}: {err}", path.display());
        });
        let fixture = parse_fixture(&value).unwrap_or_else(|err| {
            panic!("parse fixture {}: {err}", path.display());
        });
        if is_group_a_fixture(&fixture)
            || is_group_b_fixture(&fixture)
            || is_group_c_fixture(&fixture)
        {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
