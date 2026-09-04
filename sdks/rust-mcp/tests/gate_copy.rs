//! Negative suite: paywall copy must come from layer 2.
#![cfg(feature = "test-seams")]
#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod common;

use common::driver::call_registered_payable;
use common::mock_transport::MockTransport;
use common::repo_paths::lookup_mcp_fixtures;
use common::scenario::{parse_observation, parse_scenario};
use rmcp::model::{CallToolResult, ContentBlock};
use serde_json::json;
use solvapay_core::PaywallGate;
use solvapay_mcp::set_format_gate_override;

fn adapter_authored(_message: &str, _gate: &PaywallGate) -> CallToolResult {
    let mut result = CallToolResult::success(vec![ContentBlock::text("adapter-authored")]);
    result.is_error = Some(false);
    result.structured_content = Some(json!({ "kind": "payment_required" }));
    result
}

#[tokio::test]
async fn adapter_authored_gate_copy_fails_fixtures() {
    set_format_gate_override(Some(adapter_authored));
    let root = lookup_mcp_fixtures();
    for rel in [
        "gate/payment-required.json",
        "gate/activation-required.json",
        "gate/handler-invoked.json",
    ] {
        let raw: serde_json::Value =
            serde_json::from_str(&std::fs::read_to_string(root.join(rel)).expect("read"))
                .expect("json");
        let scenario = parse_scenario(raw["input"]["args"].clone());
        let observation = parse_observation(raw["expect"]["result"].clone());
        let backend = MockTransport::new(scenario.limits.clone());
        let tool_result = call_registered_payable(backend, &scenario)
            .await
            .expect("call");
        let text = tool_result["content"][0]["text"].as_str().expect("text");
        assert_eq!(text, "adapter-authored", "{rel}");
        assert_ne!(tool_result, observation.tool_result, "{rel} must not match");
    }
    set_format_gate_override(None);
}
