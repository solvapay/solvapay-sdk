//! Offline unit tests for live-contract pure helpers (Step 48 TDD).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use live_contract::{
    extract_ref, is_structured_error, normalize, resolve_args, score_scenario, Scenario, SCENARIOS,
};
use serde_json::json;
use std::collections::BTreeMap;

#[test]
fn scenarios_cover_thirty_six_ops_in_dependency_order() {
    // Python/Ruby live drivers ship 38 scenarios (36 unique ops + 2 bogus probes).
    assert_eq!(SCENARIOS.len(), 38);
    let unique_ops: std::collections::BTreeSet<&str> = SCENARIOS.iter().map(|s| s.op).collect();
    assert_eq!(unique_ops.len(), 36);
    assert_eq!(SCENARIOS[0].id, "getMerchant");
    assert_eq!(SCENARIOS[0].op, "getMerchant");
    assert_eq!(SCENARIOS[SCENARIOS.len() - 1].id, "deleteProduct");
    assert_eq!(SCENARIOS[SCENARIOS.len() - 1].op, "deleteProduct");
    // Setup-ish ops early; deletes last.
    let ids: Vec<&str> = SCENARIOS.iter().map(|s| s.id).collect();
    let create_product = ids.iter().position(|id| *id == "createProduct");
    let delete_product = ids.iter().position(|id| *id == "deleteProduct");
    let create_plan = ids.iter().position(|id| *id == "createPlan");
    let delete_plan = ids.iter().position(|id| *id == "deletePlan");
    assert!(create_product < delete_product);
    assert!(create_plan < delete_plan);
}

#[test]
fn resolve_args_substitutes_placeholders_recursively() {
    let mut refs = BTreeMap::new();
    refs.insert("productRef".to_owned(), "prd_abc".to_owned());
    refs.insert("sideTag".to_owned(), "rs-1".to_owned());
    let template = json!({
        "productRef": "{productRef}",
        "name": "Shadow Product Scenario {sideTag}",
        "events": [{"customerRef": "{productRef}", "units": 1}],
        "nested": {"tag": "{sideTag}"},
    });
    let resolved = resolve_args(&template, &refs);
    assert_eq!(resolved["productRef"], "prd_abc");
    assert_eq!(resolved["name"], "Shadow Product Scenario rs-1");
    assert_eq!(resolved["events"][0]["customerRef"], "prd_abc");
    assert_eq!(resolved["nested"]["tag"], "rs-1");
}

#[test]
fn extract_ref_checks_top_level_and_nested() {
    assert_eq!(
        extract_ref(&json!({"reference": "prd_1"}), &["reference", "productRef"]),
        Some("prd_1".to_owned())
    );
    assert_eq!(
        extract_ref(
            &json!({"product": {"productRef": "prd_nested"}}),
            &["reference", "productRef"]
        ),
        Some("prd_nested".to_owned())
    );
    assert_eq!(extract_ref(&json!("not-an-object"), &["reference"]), None);
}

#[test]
fn normalize_strips_volatile_keys_suffixes_and_nulls() {
    let raw = json!({
        "ok": true,
        "value": {
            "id": "x",
            "reference": "prd_1",
            "createdAt": "2026-01-01",
            "name": "Keep",
            "checkoutUrl": "https://example.com",
            "token": "secret",
            "planRef": "pln_1",
            "nested": {
                "updatedAt": "t",
                "status": "active",
                "gone": null
            },
            "dropNull": null
        }
    });
    let normalized = normalize(&raw);
    assert_eq!(
        normalized,
        json!({
            "ok": true,
            "value": {
                "name": "Keep",
                "nested": {
                    "status": "active"
                }
            }
        })
    );
}

#[test]
fn score_scenario_identical_on_success_and_structured_expect_error() {
    let success = Scenario {
        id: "getMerchant",
        op: "getMerchant",
        args: json!({}),
        requires: None,
        expect_error: false,
        skip_reason: None,
    };
    assert_eq!(
        score_scenario(&success, &json!({"ok": true, "value": {}})),
        "IDENTICAL"
    );
    assert_eq!(
        score_scenario(
            &success,
            &json!({"ok": false, "error": {"message": "nope"}})
        ),
        "DIVERGED"
    );

    let expect_err = Scenario {
        id: "cloneProduct",
        op: "cloneProduct",
        args: json!({}),
        requires: None,
        expect_error: true,
        skip_reason: None,
    };
    assert_eq!(
        score_scenario(
            &expect_err,
            &json!({"ok": false, "error": {"name": "SolvaPayError", "message": "boom", "status": 500}})
        ),
        "IDENTICAL"
    );
    assert_eq!(
        score_scenario(&expect_err, &json!({"ok": true, "value": {}})),
        "DIVERGED"
    );
}

#[test]
fn is_structured_error_requires_ok_false_and_message() {
    assert!(!is_structured_error(&json!({"ok": true})));
    assert!(!is_structured_error(
        &json!({"ok": false, "error": "string"})
    ));
    assert!(!is_structured_error(
        &json!({"ok": false, "error": {"message": ""}})
    ));
    assert!(is_structured_error(
        &json!({"ok": false, "error": {"message": "Payment required"}})
    ));
}
