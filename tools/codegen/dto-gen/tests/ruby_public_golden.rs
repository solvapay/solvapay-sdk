//! Golden tests for generated Ruby client, helpers, and RBS.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::{emit_client_rb, emit_rbs_rb};

#[test]
fn public_client_helpers_and_rbs_match_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_client_rb(&ir).expect("emit Ruby public");
    assert_eq!(
        emitted.client_rb,
        fs::read_to_string(
            support::paths()
                .generated_path("rbClient")
                .expect("rbClient")
        )
        .expect("client")
    );
    assert_eq!(
        emitted.helpers_rb,
        fs::read_to_string(
            support::paths()
                .generated_path("rubyHelpers")
                .expect("rubyHelpers")
        )
        .expect("helpers")
    );
    let rbs = emit_rbs_rb(&ir).expect("emit RBS");
    assert_eq!(
        rbs,
        fs::read_to_string(support::paths().generated_path("rbRbs").expect("rbRbs")).expect("RBS")
    );
    assert_eq!(emitted.client_rb.matches("    def ").count(), 42);
    assert!(!rbs.contains("SolvaPay::Native"));
    assert!(!rbs.contains("module Layer2"));
}

#[test]
fn mcp_layer2_rbs_matches_committed_ruby_mcp_sig() {
    let ir = support::lower_bindings_ir();
    let rbs = dto_gen::emit_mcp_rbs_rb(&ir).expect("emit MCP RBS");
    assert_eq!(
        rbs,
        fs::read_to_string(
            support::paths()
                .generated_path("rbMcpRbs")
                .expect("rbMcpRbs")
        )
        .expect("MCP RBS")
    );
    assert!(rbs.contains("module Layer2"));
    assert!(!emit_rbs_rb(&ir).expect("core RBS").contains("module Layer2"));
}
