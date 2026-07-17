//! Shell-level fixture suite: wiremock asserts shell-built auth/idempotency headers.
//!
//! Representative subset of `contract/fixtures/client/**` driven through
//! [`ClientShell::execute`] (not raw [`Transport::send`]). Method-specific
//! normalization stays for steps 22–24 — bodies/paths come from the recorded
//! wire request.

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, FixtureExpect, HttpMethod};
use serde_json::Value;
use solvapay_core::SdkError;
use solvapay_transport::{
    mulberry32, ClientShell, Idempotency, Method, ReqwestTransport, SharedTransport, ShellRequest,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

/// Cases the shell suite covers (plan step 21 RED 2 subset).
const SHELL_CASES: &[&str] = &[
    "check-limits-success",
    "check-limits-error",
    "create-payment-intent-success",
    "create-payment-intent-success-caller-key",
    "create-topup-payment-intent-success",
    "assign-credits-success-with-idempotency-key",
];

#[tokio::test]
async fn shell_level_fixtures_round_trip_through_reqwest() {
    let root = client_fixtures_root();
    let fixtures = load_shell_fixtures(&root);
    assert_eq!(
        fixtures.len(),
        SHELL_CASES.len(),
        "expected {} shell fixtures under {}, found {}",
        SHELL_CASES.len(),
        root.display(),
        fixtures.len()
    );

    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
    let shared: SharedTransport = Arc::new(transport);
    let mut failures: Vec<String> = Vec::new();

    for (path, fixture) in &fixtures {
        if let Err(err) = run_one(Arc::clone(&shared), fixture).await {
            failures.push(format!("{}: {err}", path.display()));
        }
    }

    assert!(
        failures.is_empty(),
        "shell fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(transport: SharedTransport, fixture: &Fixture) -> Result<(), String> {
    let wire = fixture
        .wire
        .as_ref()
        .ok_or_else(|| "fixture missing wire".to_owned())?;

    let server = MockServer::start().await;
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

    let request = shell_request_for_fixture(fixture)?;
    let outcome = shell.execute(request).await;
    assert_expect(outcome, &fixture.expect)
}

fn shell_request_for_fixture(fixture: &Fixture) -> Result<ShellRequest, String> {
    let wire = fixture
        .wire
        .as_ref()
        .ok_or_else(|| "fixture missing wire".to_owned())?;
    let method = method_from_fixture(&wire.request.method);
    let path = wire.request.path.clone();
    let query = wire.request.query.clone().unwrap_or_default();
    let body = wire.request.body.clone();
    let idempotency = idempotency_for_fixture(fixture)?;
    let error_template = error_template_for_fn(&fixture.input.fn_name)?;

    Ok(ShellRequest {
        method,
        path,
        query,
        body,
        idempotency,
        error_template,
    })
}

fn idempotency_for_fixture(fixture: &Fixture) -> Result<Idempotency, String> {
    let args = &fixture.input.args;
    match fixture.input.fn_name.as_str() {
        "checkLimits" => Ok(Idempotency::None),
        "createPaymentIntent" => match args.get("idempotencyKey") {
            Some(Value::String(key)) => Ok(Idempotency::CallerKey(key.clone())),
            _ => {
                let plan_ref = args
                    .get("planRef")
                    .and_then(Value::as_str)
                    .ok_or_else(|| "createPaymentIntent missing planRef".to_owned())?;
                let mut vars = BTreeMap::new();
                vars.insert("planRef", plan_ref.to_owned());
                Ok(Idempotency::Auto {
                    format: "payment-{planRef}-{epochMs}-{random9}",
                    vars,
                })
            }
        },
        "createTopupPaymentIntent" => match args.get("idempotencyKey") {
            Some(Value::String(key)) => Ok(Idempotency::CallerKey(key.clone())),
            _ => Ok(Idempotency::Auto {
                format: "topup-{epochMs}-{random9}",
                vars: BTreeMap::new(),
            }),
        },
        "assignCredits" => match args.get("idempotencyKey") {
            Some(Value::String(key)) => Ok(Idempotency::CallerKey(key.clone())),
            _ => Ok(Idempotency::None),
        },
        other => Err(format!("unsupported shell fixture fn: {other}")),
    }
}

fn error_template_for_fn(fn_name: &str) -> Result<&'static str, String> {
    Ok(match fn_name {
        "checkLimits" => "Check limits failed ({status}): {body}",
        "createPaymentIntent" => "Create payment intent failed ({status}): {body}",
        "createTopupPaymentIntent" => "Create topup payment intent failed ({status}): {body}",
        "assignCredits" => "Assign credits failed ({status}): {body}",
        other => return Err(format!("no error template for {other}")),
    })
}

fn assert_expect(outcome: Result<Value, SdkError>, expect: &FixtureExpect) -> Result<(), String> {
    match (outcome, expect) {
        (Ok(actual), FixtureExpect::Result(expected)) => {
            if &actual == expected {
                Ok(())
            } else {
                Err(format!(
                    "result mismatch:\n  got:      {actual}\n  expected: {expected}"
                ))
            }
        }
        (
            Err(SdkError::Api {
                message, status, ..
            }),
            FixtureExpect::Error(err),
        ) => {
            if message != err.message {
                return Err(format!(
                    "error message mismatch: got {message:?}, expected {:?}",
                    err.message
                ));
            }
            let expected_status = err.status.and_then(|s| u16::try_from(s).ok());
            if status != expected_status {
                return Err(format!(
                    "error status mismatch: got {status:?}, expected {expected_status:?}"
                ));
            }
            Ok(())
        }
        (Ok(v), FixtureExpect::Error(err)) => {
            Err(format!("expected error {:?}, got success {v}", err.message))
        }
        (Err(e), FixtureExpect::Result(v)) => Err(format!("expected result {v}, got error {e:?}")),
        (Err(e), FixtureExpect::Error(err)) => {
            Err(format!("expected Api error {:?}, got {e:?}", err.message))
        }
    }
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

fn method_from_fixture(method: &HttpMethod) -> Method {
    match method {
        HttpMethod::Get => Method::Get,
        HttpMethod::Post => Method::Post,
        HttpMethod::Put => Method::Put,
        HttpMethod::Patch => Method::Patch,
        HttpMethod::Delete => Method::Delete,
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

/// Frozen fixture clock used across the client corpus.
fn clock_ms_from_iso(iso: &str) -> Result<u64, String> {
    if iso == "2026-07-01T00:00:00Z" {
        return Ok(1_782_864_000_000);
    }
    Err(format!("unsupported fixture clock (extend parser): {iso}"))
}

fn client_fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contract/fixtures/client")
}

fn load_shell_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        if fixture.wire.is_some() && SHELL_CASES.contains(&fixture.case.as_str()) {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
