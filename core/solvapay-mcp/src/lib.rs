//! Shared MCP product surface (descriptors, OAuth, auth gate, JSON-RPC engine).
//!
//! Sync ops are `(args_json) -> JSON` so every language, including C, can
//! reach them through `solvapay_call`. Async fan-out is implemented on
//! `solvapay_transport::SolvaPayClient` (server/edge profiles only).

#![cfg_attr(
    not(test),
    deny(clippy::unwrap_used, clippy::expect_used, clippy::panic)
)]
#![allow(clippy::result_large_err, clippy::missing_docs_in_private_items)]

mod auth_gate;
mod config_log;
mod csp;
mod dcr;
mod descriptors;
mod hide_tools;
mod narrate;
mod oauth;
mod overview;
mod sync_dispatch;

#[cfg(feature = "engine")]
mod engine;

pub use auth_gate::{
    is_free_mcp_method, mcp_auth_gate, requires_bearer_auth, AuthGateInput, AuthGateResult,
    McpAuthMode,
};
pub use config_log::mcp_config_log;
pub use csp::{mcp_merge_csp, SolvaPayMcpCsp};
pub use dcr::{mcp_dcr_diagnostics, DcrDiagnosticsInput};
pub use descriptors::{mcp_descriptors, McpDescriptors, McpDescriptorsInput, McpToolDescriptor};
pub use hide_tools::{mcp_hide_tools_by_audience, HideToolsInput};
pub use narrate::{
    mcp_narrate, narrated_tool_result, new_widget_session_id, parse_mode, tool_error_result,
    tool_result, ui_placeholder, NarrateInput,
};
pub use oauth::{
    mcp_normalize_oauth_error, mcp_oauth_discovery, mcp_oauth_error_inspect, mcp_oauth_path,
    mcp_resource_identifier, path_aware_protected_resource_path, OauthDiscoveryInput,
    OauthDiscoveryKind, OauthErrorInspectInput, OauthErrorInspectKind, OauthPathInput,
    OauthPathKind, OauthPaths,
};
pub use overview::mcp_overview_resource;
pub use sync_dispatch::{dispatch_sync, solvapay_call};

#[cfg(feature = "engine")]
pub use engine::{mcp_handle_request, mcp_resume, EngineConfig, HandleRequestInput, ResumeInput};

#[cfg(test)]
mod fixture_replay;
