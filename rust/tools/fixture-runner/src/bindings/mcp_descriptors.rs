//! Host-side MCP descriptor / tool-name fixture adapters (Step 35).

use serde_json::{Map, Value};
use solvapay_core::{
    build_prompt_descriptor_metadata, build_prompt_user_message, build_tool_descriptor_metadata,
    derive_icons, mcp_tool_names_json, mcp_view_maps, validate_public_base_url,
    BuildPromptDescriptorMetadataOptions, BuildToolDescriptorMetadataOptions, MerchantBranding,
};

use crate::model::FixtureInput;
use crate::runner::{require_string_arg, BindingError, ErrorObservation};

/// Binding for `MCP_TOOL_NAMES` (zero-arg const table).
pub(super) fn invoke_mcp_tool_names(_input: &FixtureInput) -> Result<Value, BindingError> {
    Ok(mcp_tool_names_json())
}

/// Binding for `mcpViewMaps` (`TOOL_FOR_VIEW` + `VIEW_FOR_TOOL`).
pub(super) fn invoke_mcp_view_maps(_input: &FixtureInput) -> Result<Value, BindingError> {
    serde_json::to_value(mcp_view_maps()).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `deriveIcons` — absent branding → JSON `null`.
pub(super) fn invoke_derive_icons(input: &FixtureInput) -> Result<Value, BindingError> {
    let branding = optional_branding_arg(input)?;
    match derive_icons(branding.as_ref()) {
        None => Ok(Value::Null),
        Some(icons) => {
            serde_json::to_value(icons).map_err(|e| BindingError::Harness(e.to_string()))
        }
    }
}

/// Binding for `buildToolDescriptorMetadata`.
pub(super) fn invoke_build_tool_descriptor_metadata(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let resource_uri = require_string_arg(input, "resourceUri")?;
    let views = optional_views_arg(input)?;
    let branding = optional_branding_arg(input)?;
    let options = BuildToolDescriptorMetadataOptions {
        resource_uri,
        views,
        branding,
    };
    let result = build_tool_descriptor_metadata(&options);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `buildPromptDescriptorMetadata`.
pub(super) fn invoke_build_prompt_descriptor_metadata(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let views = optional_views_arg(input)?;
    let options = BuildPromptDescriptorMetadataOptions { views };
    let result = build_prompt_descriptor_metadata(&options);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `buildPromptUserMessage`.
pub(super) fn invoke_build_prompt_user_message(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let prompt_name = require_string_arg(input, "promptName")?;
    let args = match input.args.get("args") {
        Some(Value::Object(_)) => input.args["args"].clone(),
        Some(_) => {
            return Err(BindingError::Harness(
                "args.args must be an object".to_owned(),
            ));
        }
        None => {
            return Err(BindingError::Harness("args.args is required".to_owned()));
        }
    };
    let result = build_prompt_user_message(&prompt_name, &args);
    serde_json::to_value(result).map_err(|e| BindingError::Harness(e.to_string()))
}

/// Binding for `validatePublicBaseUrl` — invalid URLs surface as SDK errors.
pub(super) fn invoke_validate_public_base_url(input: &FixtureInput) -> Result<Value, BindingError> {
    let public_base_url = require_string_arg(input, "publicBaseUrl")?;
    match validate_public_base_url(&public_base_url) {
        None => Ok(Value::Null),
        Some(message) => Err(BindingError::Sdk(ErrorObservation {
            name: Some("Error".to_owned()),
            message: message.to_owned(),
            kind: None,
            code: None,
            status: None,
        })),
    }
}

/// Optional `args.views` string array.
fn optional_views_arg(input: &FixtureInput) -> Result<Option<Vec<String>>, BindingError> {
    match input.args.get("views") {
        None => Ok(None),
        Some(Value::Array(items)) => {
            let mut views = Vec::with_capacity(items.len());
            for item in items {
                match item.as_str() {
                    Some(s) => views.push(s.to_owned()),
                    None => {
                        return Err(BindingError::Harness(
                            "args.views must be an array of strings".to_owned(),
                        ));
                    }
                }
            }
            Ok(Some(views))
        }
        Some(_) => Err(BindingError::Harness(
            "args.views must be an array when present".to_owned(),
        )),
    }
}

/// Optional `args.branding` object → [`MerchantBranding`].
fn optional_branding_arg(input: &FixtureInput) -> Result<Option<MerchantBranding>, BindingError> {
    match input.args.get("branding") {
        None => Ok(None),
        Some(Value::Null) => Ok(None),
        Some(Value::Object(map)) => Ok(Some(branding_from_map(map)?)),
        Some(_) => Err(BindingError::Harness(
            "args.branding must be an object when present".to_owned(),
        )),
    }
}

/// Parse branding fields from a JSON object map.
fn branding_from_map(map: &Map<String, Value>) -> Result<MerchantBranding, BindingError> {
    Ok(MerchantBranding {
        brand_name: optional_string_field(map, "brandName")?,
        icon_url: optional_string_field(map, "iconUrl")?,
        logo_url: optional_string_field(map, "logoUrl")?,
    })
}

/// Optional string field on a branding object (`null` ≡ absent).
fn optional_string_field(
    map: &Map<String, Value>,
    key: &str,
) -> Result<Option<String>, BindingError> {
    match map.get(key) {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(s)) => Ok(Some(s.clone())),
        Some(_) => Err(BindingError::Harness(format!(
            "args.branding.{key} must be a string when present"
        ))),
    }
}
