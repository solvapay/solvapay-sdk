//! Recorded-fixture round-trips through [`FetchTransport`] under wasm32.
//!
//! The Node harness (`rust/scripts/wasm-fixture-server.mjs`) serves the wire
//! corpus at `GET /__fixtures` and mounts each expectation. Base URL comes from
//! `process.env.SOLVAPAY_FIXTURE_SERVER`.

#![cfg(target_arch = "wasm32")]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use fixture_runner::{parse_fixture, Fixture, HttpMethod, Wire};
use js_sys::JsString;
use serde_json::Value;
use solvapay_core::SdkError;
use solvapay_transport::{
    encode_query_component, FetchTransport, HeaderName, HttpRequest, Method, Transport,
};
use wasm_bindgen::JsCast;
use wasm_bindgen::JsValue;
use wasm_bindgen_futures::JsFuture;
use wasm_bindgen_test::wasm_bindgen_test;
use web_sys::{Request, RequestInit, Response};

#[wasm_bindgen_test]
async fn recorded_wire_fixtures_round_trip_through_fetch_transport() {
    let base = fixture_server_base();
    let fixtures = load_wire_fixtures(&base).await;
    assert!(
        !fixtures.is_empty(),
        "expected wire fixtures from {base}/__fixtures, found none"
    );
    assert!(
        fixtures.len() >= 50,
        "expected dozens of wire fixtures, found {} from {base}/__fixtures",
        fixtures.len()
    );

    let transport = FetchTransport::new();
    let mut failures: Vec<String> = Vec::new();

    for (index, (path, fixture)) in fixtures.iter().enumerate() {
        let wire = fixture.wire.as_ref().expect("filtered to wire fixtures");
        // Per-fixture base isolates cases that share identical wire.request.
        let case_base = format!("{base}/__case/{index}");
        if let Err(err) = round_trip_one(&transport, &case_base, wire).await {
            failures.push(format!("{path}: {err}"));
        }
    }

    assert!(
        failures.is_empty(),
        "wire fixture transport round-trips failed ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

#[wasm_bindgen_test]
async fn connection_refused_is_retryable_transport_error() {
    let transport = FetchTransport::new();
    // Port with no listener — Node fetch rejects (connection refused / fetch failed).
    let err = transport
        .send(HttpRequest {
            method: Method::Get,
            url: "http://127.0.0.1:1/v1/sdk/health".to_owned(),
            headers: Vec::new(),
            body: None,
        })
        .await
        .expect_err("expected connection failure");

    match err {
        SdkError::Transport { retryable, .. } => {
            assert!(retryable, "connection refused must be retryable")
        }
        other => panic!("transport must only produce SdkError::Transport, got {other:?}"),
    }
}

#[wasm_bindgen_test]
async fn invalid_url_is_non_retryable_transport_error() {
    let transport = FetchTransport::new();
    let err = transport
        .send(HttpRequest {
            method: Method::Get,
            url: "not a url".to_owned(),
            headers: Vec::new(),
            body: None,
        })
        .await
        .expect_err("expected invalid-URL failure");

    match err {
        SdkError::Transport { retryable, .. } => {
            assert!(!retryable, "invalid URL must not be retryable")
        }
        other => panic!("transport must only produce SdkError::Transport, got {other:?}"),
    }
}

async fn round_trip_one(transport: &FetchTransport, base: &str, wire: &Wire) -> Result<(), String> {
    let request = http_request_from_wire(base, &wire.request)?;
    let response = transport
        .send(request)
        .await
        .map_err(|err| format!("transport send failed: {err:?}"))?;

    let expected_status = u16::try_from(wire.response.status)
        .map_err(|_| format!("status out of u16 range: {}", wire.response.status))?;
    if response.status != expected_status {
        return Err(format!(
            "status mismatch: got {}, expected {expected_status}",
            response.status
        ));
    }

    assert_body_matches(&response.body, &wire.response.body)
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
    // Preserve server order — array index is the `/__case/<index>` mount key.
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

fn http_request_from_wire(
    base_uri: &str,
    request: &fixture_runner::WireRequest,
) -> Result<HttpRequest, String> {
    let method = method_from_fixture(&request.method);
    let mut url = format!("{base_uri}{}", request.path);
    if let Some(query) = &request.query {
        let mut pairs = query
            .iter()
            .map(|(k, v)| {
                format!(
                    "{}={}",
                    encode_query_component(k),
                    encode_query_component(v)
                )
            })
            .collect::<Vec<_>>();
        pairs.sort();
        if !pairs.is_empty() {
            url.push('?');
            url.push_str(&pairs.join("&"));
        }
    }

    let mut headers = Vec::new();
    if let Some(map) = &request.headers {
        for (name, value) in map {
            let header_name = HeaderName::new(name)
                .map_err(|err| format!("invalid recorded header {name:?}: {err:?}"))?;
            headers.push((header_name, value.clone()));
        }
    }

    let body = match &request.body {
        None => None,
        Some(value) => Some(
            serde_json::to_vec(value).map_err(|err| format!("serialize request body: {err}"))?,
        ),
    };

    Ok(HttpRequest {
        method,
        url,
        headers,
        body,
    })
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

fn assert_body_matches(actual: &[u8], expected: &Value) -> Result<(), String> {
    match expected {
        Value::String(s) => {
            if actual == s.as_bytes() {
                Ok(())
            } else {
                Err(format!(
                    "string body mismatch: got {:?}, expected {:?}",
                    String::from_utf8_lossy(actual),
                    s
                ))
            }
        }
        expected => {
            let parsed: Value = serde_json::from_slice(actual)
                .map_err(|err| format!("response body is not JSON: {err}"))?;
            if &parsed == expected {
                Ok(())
            } else {
                Err(format!(
                    "JSON body mismatch:\n  got:      {parsed}\n  expected: {expected}"
                ))
            }
        }
    }
}
