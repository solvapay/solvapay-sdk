//! Payable MCP tools for SolvaPay over the `rmcp` SDK.

#![allow(clippy::result_large_err)]

mod layer2;
mod register;
mod response_context;

/// MIME type for the vendored MCP App widget (`text/html;profile=mcp-app`).
pub const MCP_APP_MIME_TYPE: &str = "text/html;profile=mcp-app";
/// Canonical MCP App widget HTML, compiled into the crate.
pub const MCP_APP_HTML: &str = include_str!("../mcp-app.html");

/// Default MCP App widget HTML served when the integrator does not supply one.
pub fn default_mcp_app_html() -> &'static str {
    MCP_APP_HTML
}

pub use register::{
    invoke_payable, register_payable_tool, GetCustomerRef, PayableError, PayableHandler,
    PayableTool,
};
pub use response_context::{CustomerView, PayableResponse, ProductView, ResponseContext};

#[cfg(feature = "test-seams")]
pub use layer2::set_format_gate_override;
