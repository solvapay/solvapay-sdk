//! Typed Group C client fixtures (step 24) through [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

mod support;

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, HttpMethod};
use serde_json::Value;
use solvapay_dto::error_templates::OPERATION_NAMES;
use solvapay_transport::{
    mulberry32, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use support::{
    assert_expect, clock_ms_from_iso, dispatch_group_c, is_group_c_fixture, GROUP_A_FNS,
    GROUP_B_FNS, GROUP_C_FIXTURE_COUNT, GROUP_C_FNS,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn group_c_inventory_is_fifty_six_fixtures() {
    let root = client_fixtures_root();
    let fixtures = load_group_c_fixtures(&root);
    assert_eq!(
        fixtures.len(),
        GROUP_C_FIXTURE_COUNT,
        "expected {GROUP_C_FIXTURE_COUNT} Group C fixtures under {}, found {}",
        root.display(),
        fixtures.len()
    );

    let mut per_fn: BTreeMap<&str, usize> = BTreeMap::new();
    for (_, fixture) in &fixtures {
        *per_fn.entry(fixture.input.fn_name.as_str()).or_default() += 1;
    }

    let expected_counts: BTreeMap<&str, usize> = [
        ("checkLimits", 2),
        ("trackUsage", 2),
        ("trackUsageBulk", 2),
        ("getProduct", 2),
        ("listProducts", 4),
        ("createProduct", 2),
        ("updateProduct", 2),
        ("deleteProduct", 3),
        ("cloneProduct", 2),
        ("bootstrapMcpProduct", 2),
        ("configureMcpPlans", 2),
        ("listPlans", 4),
        ("createPlan", 2),
        ("updatePlan", 2),
        ("deletePlan", 3),
        ("cancelPurchase", 6),
        ("reactivatePurchase", 6),
        ("getPaymentMethod", 2),
        ("getAutoRecharge", 2),
        ("saveAutoRecharge", 2),
        ("disableAutoRecharge", 2),
    ]
    .into_iter()
    .collect();

    assert_eq!(per_fn, expected_counts, "Group C per-fn fixture counts");

    assert!(
        fixtures.iter().all(|(_, f)| f.wire.is_some()),
        "all Group C fixtures must have wire"
    );
}

#[tokio::test]
async fn all_thirty_six_operations_are_dispatchable() {
    let mut covered: BTreeSet<&str> = BTreeSet::new();
    covered.extend(GROUP_A_FNS.iter().copied());
    covered.extend(GROUP_B_FNS.iter().copied());
    covered.extend(GROUP_C_FNS.iter().copied());

    let expected: BTreeSet<&str> = OPERATION_NAMES.iter().copied().collect();
    assert_eq!(
        covered, expected,
        "GROUP_A ∪ GROUP_B ∪ GROUP_C must equal OPERATION_NAMES"
    );
    assert_eq!(covered.len(), 36, "expected 36 client methods");

    let root = client_fixtures_root();
    let mut missing = Vec::new();
    for entry in WalkDir::new(&root).into_iter().filter_map(Result::ok) {
        let path = entry.path();
        if !path.is_file() || path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        let text = std::fs::read_to_string(path).expect("read fixture");
        let value: Value = serde_json::from_str(&text).expect("parse JSON");
        let fixture = parse_fixture(&value).expect("parse fixture");
        if !covered.contains(fixture.input.fn_name.as_str()) {
            missing.push(format!("{} -> {}", path.display(), fixture.input.fn_name));
        }
    }
    assert!(
        missing.is_empty(),
        "client fixtures without dispatchable method:\n{}",
        missing.join("\n")
    );
}

#[tokio::test]
async fn group_c_usage_and_limits_fixtures() {
    run_group_c_subset(&["checkLimits", "trackUsage", "trackUsageBulk"]).await;
}

#[tokio::test]
async fn group_c_product_fixtures() {
    run_group_c_subset(&[
        "getProduct",
        "listProducts",
        "createProduct",
        "updateProduct",
        "deleteProduct",
        "cloneProduct",
        "bootstrapMcpProduct",
        "configureMcpPlans",
    ])
    .await;
}

#[tokio::test]
async fn group_c_plan_fixtures() {
    run_group_c_subset(&["listPlans", "createPlan", "updatePlan", "deletePlan"]).await;
}

#[tokio::test]
async fn group_c_purchase_fixtures() {
    run_group_c_subset(&["cancelPurchase", "reactivatePurchase"]).await;
}

#[tokio::test]
async fn group_c_payment_method_and_auto_recharge_fixtures() {
    run_group_c_subset(&[
        "getPaymentMethod",
        "getAutoRecharge",
        "saveAutoRecharge",
        "disableAutoRecharge",
    ])
    .await;
}

#[tokio::test]
async fn group_c_all_typed_methods_round_trip() {
    run_group_c_subset(GROUP_C_FNS).await;
}

async fn run_group_c_subset(fns: &[&str]) {
    let root = client_fixtures_root();
    let fixtures = load_group_c_fixtures(&root)
        .into_iter()
        .filter(|(_, f)| fns.contains(&f.input.fn_name.as_str()))
        .collect::<Vec<_>>();
    assert!(
        !fixtures.is_empty(),
        "no Group C fixtures for fns {fns:?} under {}",
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
        "Group C fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    let server = MockServer::start().await;
    let wire = fixture
        .wire
        .as_ref()
        .ok_or_else(|| format!("Group C fixture {} missing wire", fixture.case))?;

    mount_wire(&server, wire).await?;

    let mut shell = ClientShell::new(transport, "sk_test_fixture").with_base_url(server.uri());

    if let Some(clock) = &fixture.input.clock {
        let ms = clock_ms_from_iso(clock)?;
        shell = shell.with_clock(Arc::new(move || ms));
    }
    if let Some(seed) = fixture.input.rng_seed {
        let seed = u32::try_from(seed).map_err(|_| format!("rngSeed out of u32 range: {seed}"))?;
        shell = shell.with_rng(Arc::new(mulberry32(seed)));
    }

    let client = SolvaPayClient::new(shell);
    let outcome = dispatch_group_c(&client, fixture).await;
    assert_expect(outcome, &fixture.expect)
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

fn load_group_c_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        if is_group_c_fixture(&fixture) {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
