//! Typed Group B client fixtures (step 23) through [`SolvaPayClient`].

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

mod support;

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, HttpMethod};
use serde_json::Value;
use solvapay_transport::{
    mulberry32, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use support::{
    assert_expect, clock_ms_from_iso, dispatch_group_b, is_group_b_fixture, GROUP_B_FIXTURE_COUNT,
    GROUP_B_FNS,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const PROCESS_PAYMENT_BRANCH_CASES: &[&str] = &[
    "process-payment-intent-succeeded-one-time",
    "process-payment-intent-succeeded-recurring",
    "process-payment-intent-succeeded-bare",
    "process-payment-intent-processing",
    "process-payment-intent-timeout",
    "process-payment-intent-failed",
    "process-payment-intent-cancelled",
];

#[tokio::test]
async fn group_b_inventory_is_nineteen_fixtures() {
    let root = client_fixtures_root();
    let fixtures = load_group_b_fixtures(&root);
    assert_eq!(
        fixtures.len(),
        GROUP_B_FIXTURE_COUNT,
        "expected {GROUP_B_FIXTURE_COUNT} Group B fixtures under {}, found {}",
        root.display(),
        fixtures.len()
    );

    let mut per_fn: BTreeMap<&str, usize> = BTreeMap::new();
    for (_, fixture) in &fixtures {
        *per_fn.entry(fixture.input.fn_name.as_str()).or_default() += 1;
    }

    let expected_counts: BTreeMap<&str, usize> = [
        ("createPaymentIntent", 4),
        ("createTopupPaymentIntent", 3),
        ("processPaymentIntent", 8),
        ("attachBusinessDetails", 2),
        ("activatePlan", 2),
    ]
    .into_iter()
    .collect();

    assert_eq!(per_fn, expected_counts, "Group B per-fn fixture counts");

    let process_cases: Vec<_> = fixtures
        .iter()
        .filter(|(_, f)| f.input.fn_name == "processPaymentIntent")
        .map(|(_, f)| f.case.as_str())
        .collect();

    for branch in PROCESS_PAYMENT_BRANCH_CASES {
        assert!(
            process_cases.contains(branch),
            "missing ProcessPaymentResult branch fixture: {branch}"
        );
    }

    assert!(
        fixtures.iter().all(|(_, f)| f.wire.is_some()),
        "all Group B fixtures must have wire"
    );
}

#[tokio::test]
async fn group_b_create_payment_intent_fixtures() {
    run_group_b_subset(&["createPaymentIntent"]).await;
}

#[tokio::test]
async fn group_b_create_topup_payment_intent_fixtures() {
    run_group_b_subset(&["createTopupPaymentIntent"]).await;
}

#[tokio::test]
async fn group_b_process_payment_intent_fixtures() {
    run_group_b_subset(&["processPaymentIntent"]).await;
}

#[tokio::test]
async fn group_b_attach_business_details_fixtures() {
    run_group_b_subset(&["attachBusinessDetails"]).await;
}

#[tokio::test]
async fn group_b_activate_plan_fixtures() {
    run_group_b_subset(&["activatePlan"]).await;
}

#[tokio::test]
async fn group_b_all_typed_methods_round_trip() {
    run_group_b_subset(GROUP_B_FNS).await;
}

async fn run_group_b_subset(fns: &[&str]) {
    let root = client_fixtures_root();
    let fixtures = load_group_b_fixtures(&root)
        .into_iter()
        .filter(|(_, f)| fns.contains(&f.input.fn_name.as_str()))
        .collect::<Vec<_>>();
    assert!(
        !fixtures.is_empty(),
        "no Group B fixtures for fns {fns:?} under {}",
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
        "Group B fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    let server = MockServer::start().await;
    let wire = fixture
        .wire
        .as_ref()
        .ok_or_else(|| format!("Group B fixture {} missing wire", fixture.case))?;

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
    let outcome = dispatch_group_b(&client, fixture).await;
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

fn load_group_b_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        if is_group_b_fixture(&fixture) {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
