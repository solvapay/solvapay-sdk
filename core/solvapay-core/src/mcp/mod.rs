//! MCP payload builders + descriptor metadata (§9 steps 34–35).
//!
//! Pure ports of `@solvapay/mcp-core` paywall/envelope helpers and
//! descriptor metadata. Transport/host wiring stays out of core.

mod account_state;
mod descriptors;
mod display_mode;
mod envelope;
mod payable_tool_result;
mod paywall_tool_result;
mod plan_consequence;
mod portal_links;
mod tool_names;

pub use account_state::{
    derive_default_view, merge_plan, resolve_account_state, resolve_narrator_plan_shape,
    NarratorPlanShape,
};
/// Append the paid-tool account hint. Implementation lives in [`descriptors`].
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "paywall",
    emit_order = 46
)]
pub fn append_paid_tool_description(description: Option<&str>) -> String {
    descriptors::append_paid_tool_description(description)
}

pub use descriptors::{
    build_prompt_descriptor_metadata, build_prompt_user_message, build_tool_descriptor_metadata,
    derive_icons, validate_public_base_url, BuildPromptDescriptorMetadataOptions,
    BuildToolDescriptorMetadataOptions, MerchantBranding, PromptDescriptorMetadata,
    PromptUserMessage, ToolAnnotations, ToolDescriptorMetadata, ToolIcon, PAID_TOOL_HINT,
    PUBLIC_BASE_URL_ERROR,
};
pub use display_mode::{
    resolve_display_mode, McpContainerDimensions, McpDisplayMode, McpDisplayModeState,
    McpHostedRail, McpSafeAreaInsets,
};
pub use envelope::{assert_response_result, make_response_result, ResponseEnvelope};
pub use payable_tool_result::{build_payable_tool_result, McpPayableToolResult};
pub use paywall_tool_result::{paywall_tool_result, McpContentBlock, McpPaywallToolResult};
pub use plan_consequence::plan_consequence;
pub use portal_links::{auto_recharge_url_from, PORTAL_AUTO_RECHARGE_QUERY};
pub use tool_names::{
    mcp_tool_names_json, mcp_view_maps, McpViewMaps, MCP_PROMPT_NAMES, MCP_TOOL_NAMES,
    TOOL_FOR_VIEW, VIEWER_TOOL_NAME, VIEW_FOR_TOOL,
};
