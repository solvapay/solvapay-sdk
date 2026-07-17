//! Round-trip step-7 client fixtures through generated wire DTOs.
//!
//! For each in-scope 2xx fixture: deserialize `wire.response.body` into the
//! route's response DTO, re-serialize, and assert `serde_json::Value` equality.

#![allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]

use std::path::{Path, PathBuf};

use fixture_runner::{discover_fixtures, FixtureExpect, HttpMethod};
use serde_json::Value;
use solvapay_dto::roundtrip_response;

/// Fixtures whose wire bodies are intentional alt-shapes / normalizer inputs
/// (step 16 / client steps 22–24), not backend-canonical OpenAPI responses.
const SKIP_RELATIVE: &[&str] = &[
    // Extra `customerRef` / only `customerRef` — mapping overlay, not wire schema.
    "create-customer/success-reference.json",
    "create-customer/success-customer-ref-fallback.json",
    // getCustomer polymorphic shapes.
    "get-customer/by-external-ref-array.json",
    "get-customer/by-external-ref-customers-wrapper.json",
    "get-customer/by-external-ref-customer-wrapper.json",
    "get-customer/no-match.json",
    // listProducts / listPlans alt wrappers (bare array / nested data / price object).
    "list-products/success-bare-array.json",
    "list-products/success-nested-data.json",
    "list-plans/success-bare-array.json",
    "list-plans/success-price-precedence.json",
    // cancel/reactivate flat vs nested + invalid JSON string bodies.
    "cancel-purchase/success-flat.json",
    "cancel-purchase/success-nested.json",
    "cancel-purchase/error-invalid-json.json",
    "reactivate-purchase/success-flat.json",
    "reactivate-purchase/success-nested.json",
    "reactivate-purchase/error-invalid-json.json",
    // getProduct data-merge alt-shape.
    "get-product/success-data-merge.json",
    // Null bodies that do not match the documented JSON object schemas.
    "delete-product/success.json",
    "delete-plan/success.json",
    // OpenAPI 200 has no application/json schema.
    "attach-business-details/success.json",
    // SDK overlays / fixture shapes not in the wire snapshot (step 16).
    "check-limits/success.json", // synthetic `plan` field (LimitResponseWithPlan)
    "track-usage/success.json",  // `outcome` not on UsageRecordResponse
    "track-usage-bulk/success.json", // accepted/rejected vs inserted/results wire shape
];

#[test]
fn client_fixture_response_bodies_round_trip() {
    let fixtures_root = client_fixtures_root();
    let discovered = discover_fixtures(&fixtures_root).expect("discover client fixtures");

    let mut attempted = 0usize;
    let mut failures: Vec<String> = Vec::new();
    let mut seen_process_payment_branches = 0usize;

    for item in &discovered {
        let rel = relative_to(&fixtures_root, &item.path);
        if SKIP_RELATIVE.iter().any(|s| rel.ends_with(s)) {
            continue;
        }

        let Some(wire) = &item.fixture.wire else {
            continue;
        };
        if !(200..300).contains(&wire.response.status) {
            continue;
        }
        // Only object/array JSON bodies are in scope for typed DTO round-trip.
        if !matches!(wire.response.body, Value::Object(_) | Value::Array(_)) {
            continue;
        }
        // Error-expect fixtures with 2xx are out of scope (invalid payloads).
        if matches!(item.fixture.expect, FixtureExpect::Error(_)) {
            continue;
        }

        let method = http_method_str(&wire.request.method);
        let path = wire.request.path.as_str();
        attempted += 1;

        if path.contains("/process") {
            seen_process_payment_branches += 1;
        }

        match roundtrip_response(method, path, &wire.response.body) {
            Ok(again) => {
                if !json_values_equal(&wire.response.body, &again) {
                    failures.push(format!(
                        "{rel}: value mismatch\n  original: {}\n  again:    {}",
                        wire.response.body, again
                    ));
                }
            }
            Err(err) => failures.push(format!("{rel}: {err}")),
        }
    }

    assert!(
        attempted > 0,
        "expected to attempt at least one in-scope client fixture round-trip"
    );
    assert!(
        seen_process_payment_branches >= 7,
        "expected all ProcessPaymentResult success-branch fixtures, found {seen_process_payment_branches}"
    );
    assert!(
        failures.is_empty(),
        "DTO round-trip failures ({}):\n{}",
        failures.len(),
        failures.join("\n")
    );
}

fn client_fixtures_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../contract/fixtures/client")
}

fn relative_to(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .map(|p| p.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|_| path.display().to_string())
}

fn http_method_str(method: &HttpMethod) -> &'static str {
    match method {
        HttpMethod::Get => "GET",
        HttpMethod::Post => "POST",
        HttpMethod::Put => "PUT",
        HttpMethod::Patch => "PATCH",
        HttpMethod::Delete => "DELETE",
    }
}

/// Semantic JSON equality for wire round-trips:
/// - object key order ignored
/// - numbers compared as f64 (fixture ints vs serde f64)
/// - absent object fields ≡ JSON `null` (Option omit vs nullable null)
fn json_values_equal(left: &Value, right: &Value) -> bool {
    match (left, right) {
        (Value::Null, Value::Null) => true,
        (Value::Bool(a), Value::Bool(b)) => a == b,
        (Value::Number(a), Value::Number(b)) => a.as_f64() == b.as_f64(),
        (Value::String(a), Value::String(b)) => a == b,
        (Value::Array(a), Value::Array(b)) => {
            a.len() == b.len() && a.iter().zip(b.iter()).all(|(x, y)| json_values_equal(x, y))
        }
        (Value::Object(a), Value::Object(b)) => {
            let mut keys: Vec<&String> = a.keys().chain(b.keys()).collect();
            keys.sort();
            keys.dedup();
            keys.iter().all(|key| {
                let av = a.get(*key).unwrap_or(&Value::Null);
                let bv = b.get(*key).unwrap_or(&Value::Null);
                json_values_equal(av, bv)
            })
        }
        // Absent ≡ null already handled via Object branch defaults; allow top-level too.
        (Value::Null, _) | (_, Value::Null) => false,
        _ => false,
    }
}
