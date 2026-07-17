//! Shell-level fixture suite through [`FetchTransport`] under wasm32.
//!
//! Same representative subset as `shell_fixtures.rs`, served by
//! `rust/scripts/wasm-fixture-server.mjs`.

#![cfg(target_arch = "wasm32")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::collections::BTreeMap;
use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture, FixtureExpect, HttpMethod};
use js_sys::JsString;
use serde_json::Value;
use solvapay_core::SdkError;
use solvapay_transport::{
    mulberry32, ClientShell, FetchTransport, Idempotency, Method, SharedTransport, ShellRequest,
};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::wasm_bindgen_test;
use web_sys::{Request, RequestInit, Response};

const SHELL_CASES: &[&str] = &[
    "check-limits-success",
    "check-limits-error",
    "create-payment-intent-success",
    "create-payment-intent-success-caller-key",
    "create-topup-payment-intent-success",
    "assign-credits-success-with-idempotency-key",
];

#[wasm_bindgen_test]
async fn shell_level_fixtures_round_trip_through_fetch() {
    let base = fixture_server_base();
    let all = load_wire_fixtures(&base).await;
    let mut selected = Vec::new();
    for (index, (path, fixture)) in all.iter().enumerate() {
        if SHELL_CASES.contains(&fixture.case.as_str()) {
            selected.push((index, path.clone(), fixture.clone()));
        }
    }
    assert_eq!(
        selected.len(),
        SHELL_CASES.len(),
        "expected {} shell fixtures from {base}/__fixtures, found {}",
        SHELL_CASES.len(),
        selected.len()
    );

    let transport: SharedTransport = Arc::new(FetchTransport::new());
    let mut failures: Vec<String> = Vec::new();

    for (index, path, fixture) in &selected {
        let case_base = format!("{base}/__case/{index}");
        if let Err(err) = run_one(Arc::clone(&transport), &case_base, fixture).await {
            failures.push(format!("{path}: {err}"));
        }
    }

    assert!(
        failures.is_empty(),
        "shell fixture failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn run_one(
    transport: SharedTransport,
    case_base: &str,
    fixture: &Fixture,
) -> Result<(), String> {
    let mut shell = ClientShell::new(transport, "sk_test_fixture").with_base_url(case_base);

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

async fn load_wire_fixtures(base: &str) -> Vec<(String, Fixture)> {
    let url = format!("{base}/__fixtures");
    let body = fetch_json(&url).await.expect("GET /__fixtures");
    let items = body
        .as_array()
        .expect("/__fixtures must return a JSON array");

    let mut out = Vec::new();
    for item in items {
        let path = item
            .get("path")
            .and_then(Value::as_str)
            .expect("corpus entry.path")
            .to_owned();
        let fixture_value = item.get("fixture").cloned().expect("corpus entry.fixture");
        let fixture = parse_fixture(&fixture_value).unwrap_or_else(|err| {
            panic!("parse fixture {path}: {err}");
        });
        if fixture.wire.is_some() {
            out.push((path, fixture));
        }
    }
    out
}

async fn fetch_json(url: &str) -> Result<Value, String> {
    let opts = RequestInit::new();
    opts.set_method("GET");
    let request = Request::new_with_str_and_init(url, &opts)
        .map_err(|err| format!("build Request for {url}: {err:?}"))?;

    let global = js_sys::global();
    let fetch = js_sys::Reflect::get(&global, &JsValue::from_str("fetch"))
        .map_err(|err| format!("global.fetch missing: {err:?}"))?;
    let fetch_fn = fetch
        .dyn_into::<js_sys::Function>()
        .map_err(|err| format!("global.fetch is not a function: {err:?}"))?;
    let promise = fetch_fn
        .call1(&global, &request)
        .map_err(|err| format!("fetch call failed: {err:?}"))?;
    let promise = promise
        .dyn_into::<js_sys::Promise>()
        .map_err(|err| format!("fetch did not return a Promise: {err:?}"))?;

    let resp_value = JsFuture::from(promise)
        .await
        .map_err(|err| format!("fetch rejected for {url}: {err:?}"))?;
    let response: Response = resp_value
        .dyn_into()
        .map_err(|err| format!("fetch result is not Response: {err:?}"))?;
    if !response.ok() {
        return Err(format!("GET {url} returned HTTP {}", response.status()));
    }

    let text_promise = response
        .text()
        .map_err(|err| format!("response.text() failed: {err:?}"))?;
    let text_value = JsFuture::from(text_promise)
        .await
        .map_err(|err| format!("response.text() rejected: {err:?}"))?;
    let text = text_value
        .dyn_into::<JsString>()
        .map_err(|err| format!("response text is not a string: {err:?}"))?;
    let text: String = text.into();
    serde_json::from_str(&text).map_err(|err| format!("parse JSON from {url}: {err}"))
}

fn fixture_server_base() -> String {
    let global = js_sys::global();
    let process = js_sys::Reflect::get(&global, &JsValue::from_str("process"))
        .expect("process must exist under Node wasm-bindgen-test");
    let env =
        js_sys::Reflect::get(&process, &JsValue::from_str("env")).expect("process.env must exist");
    let value = js_sys::Reflect::get(&env, &JsValue::from_str("SOLVAPAY_FIXTURE_SERVER"))
        .expect("SOLVAPAY_FIXTURE_SERVER lookup");
    let base = value.as_string().expect(
        "SOLVAPAY_FIXTURE_SERVER must be set (run via rust/scripts/test-wasm-transport.sh)",
    );
    base.trim_end_matches('/').to_owned()
}

fn clock_ms_from_iso(iso: &str) -> Result<u64, String> {
    if iso == "2026-07-01T00:00:00Z" {
        return Ok(1_782_864_000_000);
    }
    Err(format!("unsupported fixture clock (extend parser): {iso}"))
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
