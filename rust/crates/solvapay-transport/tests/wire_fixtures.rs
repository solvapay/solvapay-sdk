//! Recorded-fixture mock-server round-trips through [`ReqwestTransport`].
//!
//! Walks `contract/fixtures/client/**`, mounts each `wire` block on wiremock,
//! and asserts status + body through the real native transport.

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::path::{Path, PathBuf};

use fixture_runner::{parse_fixture, Fixture, HttpMethod, Wire};
use serde_json::Value;
use solvapay_core::SdkError;
use solvapay_transport::{
    encode_query_component, HeaderName, HttpRequest, Method, ReqwestTransport, Transport,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

#[tokio::test]
async fn recorded_wire_fixtures_round_trip_through_reqwest_transport() {
    let root = client_fixtures_root();
    let fixtures = load_wire_fixtures(&root);
    assert!(
        !fixtures.is_empty(),
        "expected wire fixtures under {}, found none (path drift?)",
        root.display()
    );
    // Corpus size guard — client suite currently has ~100 wire cases.
    assert!(
        fixtures.len() >= 50,
        "expected dozens of wire fixtures, found {} under {}",
        fixtures.len(),
        root.display()
    );

    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
    let mut failures: Vec<String> = Vec::new();

    for (path, fixture) in &fixtures {
        let wire = fixture.wire.as_ref().expect("filtered to wire fixtures");
        if let Err(err) = round_trip_one(&transport, wire).await {
            failures.push(format!("{}: {err}", path.display()));
        }
    }

    assert!(
        failures.is_empty(),
        "wire fixture transport round-trips failed ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn round_trip_one(transport: &ReqwestTransport, wire: &Wire) -> Result<(), String> {
    let server = MockServer::start().await;
    mount_wire(&server, wire).await?;

    let request = http_request_from_wire(&server.uri(), &wire.request)?;
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

    assert_body_matches(&response.body, &wire.response.body)?;
    Ok(())
}

async fn mount_wire(server: &MockServer, wire: &Wire) -> Result<(), String> {
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
        // Stable order for determinism (BTreeMap iter is already sorted).
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

fn fixture_method_str(method: &HttpMethod) -> &'static str {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Delete => "DELETE",
    }
}

/// Mirrors TS `wireResponseBody`: plain strings stay verbatim; other JSON is stringified.
fn response_body_bytes(body: &Value) -> Result<Vec<u8>, String> {
    match body {
        Value::String(s) => Ok(s.as_bytes().to_vec()),
        other => serde_json::to_vec(other).map_err(|err| format!("serialize response body: {err}")),
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

fn client_fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contract/fixtures/client")
}

fn load_wire_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        if fixture.wire.is_some() {
            out.push((path.to_path_buf(), fixture));
        }
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}

#[tokio::test]
async fn connection_refused_is_retryable_transport_error() {
    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
    // Bind then drop so the port is closed → immediate connection refused.
    let listener = std::net::TcpListener::bind("127.0.0.1:0").expect("bind ephemeral port");
    let addr = listener.local_addr().expect("local_addr");
    drop(listener);

    let err = transport
        .send(HttpRequest {
            method: Method::Get,
            url: format!("http://{addr}/v1/sdk/health"),
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

#[tokio::test]
async fn invalid_url_is_non_retryable_transport_error() {
    let transport = ReqwestTransport::new().expect("build ReqwestTransport");
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
