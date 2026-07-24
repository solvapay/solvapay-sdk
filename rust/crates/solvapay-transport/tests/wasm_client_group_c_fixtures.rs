//! Typed Group C client fixtures through [`FetchTransport`] under wasm32.

#![cfg(target_arch = "wasm32")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

mod support;

use std::sync::Arc;

use fixture_runner::{parse_fixture, Fixture};
use js_sys::JsString;
use serde_json::Value;
use solvapay_transport::{
    mulberry32, ClientShell, FetchTransport, SharedTransport, SolvaPayClient,
};
use support::{
    assert_expect, clock_ms_from_iso, dispatch_group_c, is_group_c_fixture, GROUP_C_FIXTURE_COUNT,
};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::wasm_bindgen_test;
use web_sys::{Request, RequestInit, Response};

#[wasm_bindgen_test]
async fn group_c_typed_methods_round_trip_through_fetch() {
    let base = fixture_server_base();
    let all = load_all_fixtures_from_server(&base).await;

    let mut wire_cases = Vec::new();
    for (index, (path, fixture)) in all.iter().enumerate() {
        if is_group_c_fixture(fixture) && fixture.wire.is_some() {
            wire_cases.push((index, path.clone(), fixture.clone()));
        }
    }

    assert_eq!(
        wire_cases.len(),
        GROUP_C_FIXTURE_COUNT,
        "expected {GROUP_C_FIXTURE_COUNT} Group C wire fixtures from {base}/__fixtures, found {}",
        wire_cases.len()
    );

    let transport: SharedTransport = Arc::new(FetchTransport::new());
    let mut failures: Vec<String> = Vec::new();

    for (index, path, fixture) in &wire_cases {
        let case_base = format!("{base}/__case/{index}");
        if let Err(err) = run_one(Arc::clone(&transport), &case_base, fixture).await {
            failures.push(format!("{path} ({}): {err}", fixture.case));
        }
    }

    assert!(
        failures.is_empty(),
        "Group C WASM fixture failures ({}):\n{}",
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

    let client = SolvaPayClient::new(shell);
    let outcome = dispatch_group_c(&client, fixture).await;
    assert_expect(outcome, &fixture.expect)
}

async fn load_all_fixtures_from_server(base: &str) -> Vec<(String, Fixture)> {
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
        out.push((path, fixture));
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
