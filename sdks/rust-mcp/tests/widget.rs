//! Default MCP App widget reader.
#![allow(clippy::expect_used, clippy::unwrap_used)]

use std::fs;

#[test]
fn default_widget_has_root_mount() {
    assert!(solvapay_mcp::default_mcp_app_html().contains("id=\"root\""));
    assert_eq!(solvapay_mcp::MCP_APP_MIME_TYPE, "text/html;profile=mcp-app");
}

#[test]
fn vendored_widget_matches_canonical() {
    let canonical = repo_paths::load()
        .expect("repo paths")
        .lookup("mcpAppWidgetCanonical")
        .expect("mcpAppWidgetCanonical lookup");
    let expected = fs::read_to_string(canonical).expect("canonical widget");
    assert_eq!(solvapay_mcp::default_mcp_app_html(), expected);
}
