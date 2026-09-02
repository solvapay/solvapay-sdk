//! Replay `contract/fixtures/client/**` through native [`SolvaPayClient`] + reqwest.

#![cfg(not(target_arch = "wasm32"))]
#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};
use std::sync::Arc;

use client_conformance::{
    dispatch, dispatch_operation_names, sdk_error_to_observation, RecordingTransport, WireExchange,
};
use fixture_runner::{assert_expect, parse_fixture, BindingError, Fixture, FixtureExpect, Wire};
use serde_json::Value;
use solvapay_transport::{
    mulberry32, ClientShell, ReqwestTransport, SharedTransport, SolvaPayClient,
};
use walkdir::WalkDir;
use wiremock::matchers::{body_json, header, method, path, query_param};
use wiremock::{Mock, MockServer, ResponseTemplate};

const FIXTURE_API_KEY: &str = "sk_test_fixture";
const VALIDATION_BASE_URL: &str = "http://127.0.0.1:1";
const CANONICAL_CLOCK: &str = "2026-07-01T00:00:00Z";
const CANONICAL_CLOCK_MS: u64 = 1_782_864_000_000;

#[tokio::test]
async fn client_fixtures_replay_through_native_client() {
    let root = client_fixtures_root();
    let fixtures = load_client_fixtures(&root);
    assert!(
        !fixtures.is_empty(),
        "expected client fixtures under {}, found none (path drift?)",
        root.display()
    );
    assert!(
        fixtures.len() >= 100,
        "expected at least 100 client fixtures, found {} under {}",
        fixtures.len(),
        root.display()
    );

    let missing_params = fixtures
        .iter()
        .find(|(_, fixture)| fixture.case == "get-customer-missing-params");
    match missing_params {
        Some((_, fixture)) => assert!(
            fixture.wire.is_none(),
            "get-customer/missing-params must be a no-wire client-side validation case"
        ),
        None => panic!("missing client/get-customer/missing-params.json"),
    }

    let replayed: BTreeSet<&str> = fixtures
        .iter()
        .map(|(_, fixture)| fixture.input.fn_name.as_str())
        .collect();
    let expected: BTreeSet<&str> = dispatch_operation_names().iter().copied().collect();
    assert_eq!(
        replayed, expected,
        "replayed input.fn set must equal dispatch_operation_names() (36 ops)"
    );

    let mut failures: Vec<String> = Vec::new();
    for (path, fixture) in &fixtures {
        if let Err(err) = replay_one(fixture).await {
            failures.push(format!("{} ({}): {err}", path.display(), fixture.case));
        }
    }

    assert!(
        failures.is_empty(),
        "native client fixture replay failed ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

async fn replay_one(fixture: &Fixture) -> Result<(), String> {
    let inner: SharedTransport = Arc::new(ReqwestTransport::new().map_err(|err| {
        format!(
            "build ReqwestTransport: {}",
            sdk_error_to_observation(err).message
        )
    })?);
    let (recording, exchanges) = RecordingTransport::new(inner);
    let recording_shared: SharedTransport = Arc::new(recording);

    let server = if fixture.wire.is_some() {
        Some(MockServer::start().await)
    } else {
        None
    };

    let mut shell = ClientShell::new(recording_shared, FIXTURE_API_KEY);
    if let (Some(server), Some(wire)) = (server.as_ref(), fixture.wire.as_ref()) {
        mount_wire(server, wire).await?;
        shell = shell.with_base_url(server.uri());
    } else {
        shell = shell.with_base_url(VALIDATION_BASE_URL);
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
    let args = Value::Object(fixture.input.args.clone().into_iter().collect());
    let outcome = dispatch(&client, &fixture.input.fn_name, &args).await;
    let recorded = exchanges
        .lock()
        .map(|guard| guard.clone())
        .unwrap_or_default();

    let compared = match outcome {
        Ok(value) => assert_expect(&fixture.expect, Ok(value)),
        Err(err) => {
            let observation = sdk_error_to_observation(err);
            assert_expect(
                &fixture.expect,
                Err(BindingError::Sdk(fixture_error_observation(observation))),
            )
        }
    };

    if let Err(err) = compared {
        return Err(format!(
            "{err}\n  recorded wire: {}",
            format_recorded_wire(&recorded)
        ));
    }

    if matches!(fixture.expect, FixtureExpect::Result(_))
        && fixture.wire.is_some()
        && recorded.is_empty()
    {
        return Err("expected a recorded wire exchange on the success path".to_owned());
    }

    drop(server);
    Ok(())
}

fn fixture_error_observation(
    observation: client_conformance::ErrorObservation,
) -> fixture_runner::ErrorObservation {
    fixture_runner::ErrorObservation {
        name: observation.name,
        message: observation.message,
        kind: observation.kind,
        code: observation.code,
        status: observation.status,
    }
}

async fn mount_wire(server: &MockServer, wire: &Wire) -> Result<(), String> {
    for route in wire.routes() {
        mount_one_route(server, &route.request, &route.response).await?;
    }
    Ok(())
}

async fn mount_one_route(
    server: &MockServer,
    request: &fixture_runner::WireRequest,
    response: &fixture_runner::WireResponse,
) -> Result<(), String> {
    let mut mock = Mock::given(method(request.method.as_str())).and(path(&request.path));

    if let Some(query) = &request.query {
        for (key, value) in query {
            mock = mock.and(query_param(key.as_str(), value.as_str()));
        }
    }

    if let Some(headers) = &request.headers {
        for (name, value) in headers {
            mock = mock.and(header(name.as_str(), value.as_str()));
        }
    }

    if let Some(body) = &request.body {
        mock = mock.and(body_json(body));
    }

    let status = u16::try_from(response.status)
        .map_err(|_| format!("status out of u16 range: {}", response.status))?;
    let body_bytes = response_body_bytes(&response.body)?;
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

fn format_recorded_wire(exchanges: &[WireExchange]) -> String {
    serde_json::to_string_pretty(exchanges).unwrap_or_else(|_| format!("{exchanges:?}"))
}

fn clock_ms_from_iso(iso: &str) -> Result<u64, String> {
    if iso == CANONICAL_CLOCK {
        return Ok(CANONICAL_CLOCK_MS);
    }
    Err(format!("unsupported fixture clock (extend parser): {iso}"))
}

fn client_fixtures_root() -> PathBuf {
    repo_paths::load()
        .expect("repo-paths")
        .client_fixtures()
        .expect("client fixtures")
}

fn load_client_fixtures(root: &Path) -> Vec<(PathBuf, Fixture)> {
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
        out.push((path.to_path_buf(), fixture));
    }
    out.sort_by(|a, b| a.0.cmp(&b.0));
    out
}
