//! MCP payload builders + descriptor metadata (§9 steps 34–35).
//!
//! Pure ports of `@solvapay/mcp-core` paywall/envelope helpers and
//! descriptor metadata. Transport/host wiring stays out of core.

mod descriptors;
mod envelope;
mod paywall_tool_result;
mod tool_names;

pub use descriptors::{
    build_prompt_descriptor_metadata, build_prompt_user_message, build_tool_descriptor_metadata,
    derive_icons, validate_public_base_url, BuildPromptDescriptorMetadataOptions,
    BuildToolDescriptorMetadataOptions, MerchantBranding, PromptDescriptorMetadata,
    PromptUserMessage, ToolAnnotations, ToolDescriptorMetadata, ToolIcon, PUBLIC_BASE_URL_ERROR,
};
pub use envelope::{assert_response_result, make_response_result, ResponseEnvelope};
pub use paywall_tool_result::{paywall_tool_result, McpContentBlock, McpPaywallToolResult};
pub use tool_names::{
    mcp_tool_names_json, mcp_view_maps, McpViewMaps, MCP_TOOL_NAMES, TOOL_FOR_VIEW, VIEW_FOR_TOOL,
};
