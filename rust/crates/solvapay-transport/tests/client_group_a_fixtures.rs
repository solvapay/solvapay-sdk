//! Typed Group A client fixtures (step 22) through [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

mod support;

use std::path::{Path, PathBuf};
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, HttpMethod};
use serde_json::Value;
use solvapay_transport::{
    mulberry32, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use support::{
    assert_expect, clock_ms_from_iso, dispatch_group_a, is_group_a_fixture, GROUP_A_FIXTURE_COUNT,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn group_a_inventory_is_twenty_nine_fixtures() {
    let root = client_fixtures_root();
    let fixtures = load_group_a_fixtures(&root);
    assert_eq!(
        fixtures.len(),
        GROUP_A_FIXTURE_COUNT,
        "expected {GROUP_A_FIXTURE_COUNT} Group A fixtures under {}, found {}",
        root.display(),
        fixtures.len()
    );
    assert!(
        fixtures
            .iter()
            .any(|(_, f)| f.case == "get-customer-missing-params" && f.wire.is_none()),
        "missing-params validation fixture must be present without wire"
    );
    let wire_count = fixtures.iter().filter(|(_, f)| f.wire.is_some()).count();
    assert_eq!(
        wire_count, 28,
        "expected 28 wire fixtures, found {wire_count}"
    );
}

#[tokio::test]
async fn group_a_direct_methods_fixtures() {
    run_group_a_subset(&[
        "getMerchant",
        "getPlatformConfig",
        "getCustomerBalance",
        "getUserInfo",
        "createCheckoutSession",
        "createCustomerSession",
    ])
    .await;
}

#[tokio::test]
async fn group_a_create_update_customer_fixtures() {
    run_group_a_subset(&["createCustomer", "updateCustomer"]).await;
}

#[tokio::test]
async fn group_a_assign_credits_fixtures() {
    run_group_a_subset(&["assignCredits"]).await;
}

#[tokio::test]
async fn group_a_get_customer_fixtures() {
    run_group_a_subset(&["getCustomer"]).await;
}

#[tokio::test]
async fn group_a_all_typed_methods_round_trip() {
    run_group_a_subset(&[
        "createCustomer",
        "updateCustomer",
        "getCustomer",
        "assignCredits",
        "getCustomerBalance",
        "getUserInfo",
        "createCheckoutSession",
        "createCustomerSession",
        "getMerchant",
        "getPlatformConfig",
    ])
    .await;
}

async fn run_group_a_subset(fns: &[&str]) {
    let root = client_fixtures_root();
    let fixtures = load_group_a_fixtures(&root)
        .into_iter()
        .filter(|(_, f)| fns.contains(&f.input.fn_name.as_str()))
        .collect::<Vec<_>>();
    assert!(
        !fixtures.is_empty(),
        "no Group A fixtures for fns {fns:?} under {}",
        root.display()
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
        "Group A fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    // Keep the mock server alive for the whole request (drop after assert).
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
        // Validation-only fixtures must fail before transport is called.
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

    let client = SolvaPayClient::new(shell);
    let outcome = dispatch_group_a(&client, fixture).await;
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
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contract/fixtures/client")
}

fn load_group_a_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        if is_group_a_fixture(&fixture) {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
