//! Replay `contract/mcp-fixtures/` against a real rmcp server.
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use std::fs;
use std::path::Path;

use common::driver::{call_registered_payable, tool_results_equal};
use common::mock_transport::{project_usage, MockTransport};
use common::repo_paths::lookup_mcp_fixtures;
use common::scenario::{parse_observation, parse_scenario, UsageProjection};
use serde_json::{json, Value};

const MCP_AUTHORING_FIXTURES: &[&str] = &[
    "allow/respond-emitted-blocks.json",
    "allow/respond-key-order.json",
    "allow/respond-minimal.json",
    "allow/respond-nudge.json",
    "allow/respond-text-option.json",
    "customer-ref/from-hook.json",
    "customer-ref/from-tool-args.json",
    "error/handler-throws.json",
    "gate/activation-required.json",
    "gate/handler-invoked.json",
    "gate/payment-required.json",
];

fn usage_projection_json(item: &UsageProjection) -> Value {
    let units = if item.units.fract() == 0.0 {
        json!(item.units as i64)
    } else {
        json!(item.units)
    };
    json!({
        "outcome": item.outcome,
        "actionType": item.action_type,
        "units": units,
        "productRef": item.product_ref,
        "customerRef": item.customer_ref,
        "metadata": { "action": item.metadata.get("action") },
    })
}

fn discover(root: &Path) -> Vec<String> {
    fn walk(dir: &Path, root: &Path, out: &mut Vec<String>) {
        for entry in fs::read_dir(dir).expect("read_dir") {
            let entry = entry.expect("dirent");
            let path = entry.path();
            if path.is_dir() {
                walk(&path, root, out);
            } else if path.extension().and_then(|e| e.to_str()) == Some("json") {
                let rel = path
                    .strip_prefix(root)
                    .expect("prefix")
                    .to_string_lossy()
                    .replace('\\', "/");
                out.push(rel);
            }
        }
    }
    let mut rels = Vec::new();
    walk(root, root, &mut rels);
    rels.sort();
    rels
}

fn load_fixture(root: &Path, rel: &str) -> Value {
    serde_json::from_str(&fs::read_to_string(root.join(rel)).expect("read fixture"))
        .expect("parse fixture")
}

#[test]
fn discovers_the_frozen_fixture_list() {
    let root = lookup_mcp_fixtures();
    assert_eq!(discover(&root), MCP_AUTHORING_FIXTURES);
}

#[test]
fn fixture_round_trips_strict_schema() {
    let root = lookup_mcp_fixtures();
    for rel in MCP_AUTHORING_FIXTURES {
        let raw = load_fixture(&root, rel);
        assert_eq!(raw["input"]["fn"], "registerPayable");
        parse_scenario(raw["input"]["args"].clone());
        parse_observation(raw["expect"]["result"].clone());
    }
}

#[tokio::test]
async fn replays_fixtures() {
    let root = lookup_mcp_fixtures();
    for rel in MCP_AUTHORING_FIXTURES {
        let raw = load_fixture(&root, rel);
        let scenario = parse_scenario(raw["input"]["args"].clone());
        let observation = parse_observation(raw["expect"]["result"].clone());
        let backend = MockTransport::new(scenario.limits.clone());
        let tool_result = call_registered_payable(backend.clone(), &scenario)
            .await
            .unwrap_or_else(|e| panic!("{rel}: call failed: {e}"));
        let usage = project_usage(&backend.usages());
        assert!(
            tool_results_equal(&tool_result, &observation.tool_result),
            "{rel} toolResult\ngot: {}\nwant: {}",
            serde_json::to_string_pretty(&tool_result).expect("json"),
            serde_json::to_string_pretty(&observation.tool_result).expect("json")
        );
        let want_usage: Vec<Value> = observation
            .usage
            .iter()
            .map(usage_projection_json)
            .collect();
        assert_eq!(usage, want_usage, "{rel} usage");
    }
}
