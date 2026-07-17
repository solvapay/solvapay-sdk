//! RED→GREEN tests for the §5.3 fixture model, discovery, and suite execution.

use std::collections::BTreeMap;
use std::path::PathBuf;

use serde_json::{json, Value};

use crate::bindings::create_default_registry;
use crate::discover::discover_fixtures;
use crate::model::{parse_fixture, FixtureErrorExpect, FixtureExpect, FixtureInput};
use crate::runner::{
    format_summary, run_one, run_suite, Binding, BindingError, BindingRegistry, ErrorObservation,
};

fn fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contract/fixtures")
}

#[test]
fn parses_success_fixture_with_result() {
    let raw = json!({
        "suite": "retry-schedule",
        "case": "immediate-success",
        "input": {
            "fn": "withRetry",
            "args": { "attempts": [{ "resolve": { "ok": true } }] }
        },
        "expect": {
            "result": {
                "delays": [],
                "events": ["call:0"],
                "outcome": { "type": "resolved", "value": { "ok": true } }
            }
        }
    });

    let fixture = parse_fixture(&raw).expect("valid success fixture");
    assert_eq!(fixture.suite, "retry-schedule");
    assert_eq!(fixture.case, "immediate-success");
    assert_eq!(fixture.input.fn_name, "withRetry");
    assert!(fixture.input.args.contains_key("attempts"));
    assert!(matches!(fixture.expect, FixtureExpect::Result(_)));
}

#[test]
fn parses_error_fixture_with_wire() {
    let raw = json!({
        "suite": "client",
        "case": "create-payment-intent-error",
        "input": {
            "fn": "createPaymentIntent",
            "args": {
                "productRef": "prod_fixture",
                "planRef": "plan_basic",
                "customerRef": "cus_fixture",
                "idempotencyKey": "err_key"
            },
            "clock": "2026-07-01T00:00:00Z"
        },
        "wire": {
            "request": {
                "method": "POST",
                "path": "/v1/sdk/payment-intents",
                "headers": {
                    "Content-Type": "application/json",
                    "Authorization": "Bearer sk_test_fixture",
                    "Idempotency-Key": "err_key"
                },
                "body": {
                    "productRef": "prod_fixture",
                    "planRef": "plan_basic",
                    "customerRef": "cus_fixture"
                }
            },
            "response": {
                "status": 400,
                "body": "bad"
            }
        },
        "expect": {
            "error": {
                "name": "SolvaPayError",
                "message": "Create payment intent failed (400): bad",
                "status": 400
            }
        }
    });

    let fixture = parse_fixture(&raw).expect("valid error fixture");
    assert_eq!(fixture.input.clock.as_deref(), Some("2026-07-01T00:00:00Z"));
    let wire = fixture.wire.expect("wire present");
    assert_eq!(wire.request.path, "/v1/sdk/payment-intents");
    match fixture.expect {
        FixtureExpect::Error(err) => {
            assert_eq!(err.message, "Create payment intent failed (400): bad");
            assert_eq!(err.status, Some(400));
        }
        FixtureExpect::Result(_) => panic!("expected error branch"),
    }
}

#[test]
fn rejects_expect_with_both_result_and_error() {
    let raw = json!({
        "suite": "x",
        "case": "y",
        "input": { "fn": "f", "args": {} },
        "expect": {
            "result": true,
            "error": { "message": "nope" }
        }
    });
    let err = parse_fixture(&raw).expect_err("both result and error");
    assert!(
        err.to_string().contains("exactly one of result or error"),
        "unexpected error: {err}"
    );
}

#[test]
fn rejects_expect_with_neither_result_nor_error() {
    let raw = json!({
        "suite": "x",
        "case": "y",
        "input": { "fn": "f", "args": {} },
        "expect": {}
    });
    let err = parse_fixture(&raw).expect_err("empty expect");
    assert!(
        err.to_string().contains("exactly one of result or error"),
        "unexpected error: {err}"
    );
}

#[test]
fn rejects_missing_suite() {
    let raw = json!({
        "case": "y",
        "input": { "fn": "f", "args": {} },
        "expect": { "result": null }
    });
    let err = parse_fixture(&raw).expect_err("missing suite");
    assert!(err.to_string().contains("suite"), "unexpected error: {err}");
}

#[test]
fn rejects_bad_wire_request_method() {
    let raw = json!({
        "suite": "x",
        "case": "y",
        "input": { "fn": "f", "args": {} },
        "wire": {
            "request": {
                "method": "TRACE",
                "path": "/v1/sdk/x"
            },
            "response": { "status": 200, "body": {} }
        },
        "expect": { "result": true }
    });
    let err = parse_fixture(&raw).expect_err("bad method");
    assert!(
        err.to_string().to_ascii_lowercase().contains("method"),
        "unexpected error: {err}"
    );
}

#[test]
fn defaults_missing_args_to_empty_object() {
    let raw = json!({
        "suite": "x",
        "case": "y",
        "input": { "fn": "f" },
        "expect": { "result": 1 }
    });
    let fixture = parse_fixture(&raw).expect("args default");
    assert!(fixture.input.args.is_empty());
}

#[test]
fn discovers_and_parses_entire_corpus() {
    let root = fixtures_root();
    assert!(root.is_dir(), "fixtures root missing: {}", root.display());

    let discovered = discover_fixtures(&root).expect("discover corpus");
    assert!(
        discovered.len() >= 100,
        "expected a large Phase 0 corpus, got {}",
        discovered.len()
    );

    for item in &discovered {
        assert!(
            !item.fixture.suite.is_empty(),
            "empty suite at {:?}",
            item.path
        );
        assert!(
            !item.fixture.case.is_empty(),
            "empty case at {:?}",
            item.path
        );
        assert!(
            !item.fixture.input.fn_name.is_empty(),
            "empty fn at {:?}",
            item.path
        );
    }
}

#[test]
fn empty_registry_skips_all() {
    let root = fixtures_root();
    let registry = BindingRegistry::new();
    let (summary, failures) = run_suite(&root, &registry).expect("empty suite");

    assert!(summary.parsed >= 100, "parsed={}", summary.parsed);
    assert_eq!(summary.executed, 0);
    assert_eq!(summary.passed, 0);
    assert_eq!(summary.failed, 0);
    assert_eq!(summary.skipped_unbound, summary.parsed);
    assert!(failures.is_empty());
    assert_eq!(
        format_summary(&summary),
        format!(
            "parsed={} executed=0 passed=0 failed=0 skipped-unbound={}",
            summary.parsed, summary.parsed
        )
    );
}

#[test]
fn default_registry_executes_bound_core_fixtures() {
    let root = fixtures_root();
    let registry = create_default_registry();
    let (summary, failures) = run_suite(&root, &registry).expect("suite");

    let bound_count = discover_fixtures(&root)
        .expect("discover")
        .iter()
        .filter(|item| registry.contains(&item.fixture.input.fn_name))
        .count();

    assert_eq!(summary.executed, bound_count);
    assert_eq!(summary.passed, bound_count);
    assert_eq!(summary.failed, 0);
    assert_eq!(
        summary.skipped_unbound,
        summary.parsed.saturating_sub(bound_count)
    );
    assert!(failures.is_empty(), "unexpected failures: {failures:?}");
    assert!(
        format_summary(&summary).contains(&format!("passed={bound_count}")),
        "summary={}",
        format_summary(&summary)
    );
}

fn empty_input() -> FixtureInput {
    FixtureInput {
        fn_name: "verifyWebhook".to_owned(),
        args: BTreeMap::new(),
        clock: None,
        rng_seed: None,
    }
}

fn webhook_error_expect() -> FixtureErrorExpect {
    FixtureErrorExpect {
        name: Some("SolvaPayError".to_owned()),
        message: "Missing webhook signature".to_owned(),
        status: None,
        kind: Some("Webhook".to_owned()),
        code: Some("missing_signature".to_owned()),
    }
}

fn sdk_observation(message: &str, kind: Option<&str>, code: Option<&str>) -> ErrorObservation {
    ErrorObservation {
        name: Some("SolvaPayError".to_owned()),
        message: message.to_owned(),
        kind: kind.map(str::to_owned),
        code: code.map(str::to_owned),
        status: None,
    }
}

#[test]
fn error_expect_matches_structured_sdk_error() {
    let binding = Binding {
        id: "core",
        invoke: Box::new(|_| {
            Err(BindingError::Sdk(sdk_observation(
                "Missing webhook signature",
                Some("Webhook"),
                Some("missing_signature"),
            )))
        }),
    };
    let expect = FixtureExpect::Error(webhook_error_expect());
    run_one(&expect, &empty_input(), &binding).expect("structured error should match");
}

#[test]
fn error_expect_fails_on_message_mismatch() {
    let binding = Binding {
        id: "core",
        invoke: Box::new(|_| {
            Err(BindingError::Sdk(sdk_observation(
                "wrong message",
                Some("Webhook"),
                Some("missing_signature"),
            )))
        }),
    };
    let expect = FixtureExpect::Error(webhook_error_expect());
    let err = run_one(&expect, &empty_input(), &binding).expect_err("message mismatch");
    assert!(
        err.contains("message:") && err.contains("wrong message"),
        "unexpected error: {err}"
    );
}

#[test]
fn error_expect_fails_on_kind_or_code_mismatch() {
    let binding = Binding {
        id: "core",
        invoke: Box::new(|_| {
            Err(BindingError::Sdk(sdk_observation(
                "Missing webhook signature",
                Some("Api"),
                Some("other_code"),
            )))
        }),
    };
    let expect = FixtureExpect::Error(webhook_error_expect());
    let err = run_one(&expect, &empty_input(), &binding).expect_err("kind/code mismatch");
    assert!(
        err.contains("kind:") && err.contains("code:"),
        "unexpected error: {err}"
    );
}

#[test]
fn error_expect_fails_on_unexpected_success() {
    let binding = Binding {
        id: "core",
        invoke: Box::new(|_| Ok(Value::Bool(true))),
    };
    let expect = FixtureExpect::Error(webhook_error_expect());
    let err = run_one(&expect, &empty_input(), &binding).expect_err("unexpected success");
    assert!(
        err.contains("produced a result but fixture expects an error"),
        "unexpected error: {err}"
    );
}

#[test]
fn result_expect_fails_on_unexpected_sdk_error() {
    let binding = Binding {
        id: "core",
        invoke: Box::new(|_| {
            Err(BindingError::Sdk(sdk_observation(
                "Missing webhook signature",
                Some("Webhook"),
                Some("missing_signature"),
            )))
        }),
    };
    let expect = FixtureExpect::Result(Value::Bool(true));
    let err = run_one(&expect, &empty_input(), &binding).expect_err("unexpected error");
    assert!(
        err.contains("returned error but fixture expects a result"),
        "unexpected error: {err}"
    );
}
