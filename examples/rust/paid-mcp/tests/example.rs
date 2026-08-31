//! Offline mock-transport coverage for the paid-MCP example.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use solvapay_example_paid_mcp::run;

#[tokio::test]
async fn allow_round_trip() {
    let result = run(true, "hello").await.expect("run");
    assert_eq!(result["content"][0]["text"], "{\"echo\":\"hello\"}");
    assert_eq!(
        result["structuredContent"],
        serde_json::json!({ "echo": "hello" })
    );
}

#[tokio::test]
async fn gate_round_trip() {
    let result = run(false, "hello").await.expect("run");
    assert_eq!(result["isError"], false);
    assert_eq!(result["structuredContent"]["kind"], "payment_required");
    let text = result["content"][0]["text"].as_str().expect("text");
    assert!(text.contains("upgrade"), "{text}");
}
