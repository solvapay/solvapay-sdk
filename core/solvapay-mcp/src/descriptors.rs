//! Full MCP descriptors with JSON Schema `inputSchema`.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use solvapay_core::{
    assert_valid_product_ref, build_prompt_descriptor_metadata, build_tool_descriptor_metadata,
    validate_public_base_url, BuildPromptDescriptorMetadataOptions,
    BuildToolDescriptorMetadataOptions, MerchantBranding, PromptDescriptorMetadata,
    ToolDescriptorMetadata,
};

use crate::csp::{mcp_merge_csp, SolvaPayMcpCsp};
use crate::overview::mcp_overview_resource;

/// Input for [`mcp_descriptors`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDescriptorsInput {
    /// UI resource URI.
    pub resource_uri: String,
    /// Public http(s) origin.
    pub public_base_url: String,
    /// Default product ref.
    pub product_ref: String,
    /// Enabled views.
    #[serde(default)]
    pub views: Option<Vec<String>>,
    /// Optional CSP overrides.
    #[serde(default)]
    pub csp: Option<SolvaPayMcpCsp>,
    /// Optional API origin for CSP auto-include.
    #[serde(default)]
    pub api_base_url: Option<String>,
    /// Optional branding.
    #[serde(default)]
    pub branding: Option<BrandingIn>,
}

/// Merchant branding on the wire.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BrandingIn {
    /// Display name.
    #[serde(default)]
    pub brand_name: Option<String>,
    /// Icon URL.
    #[serde(default)]
    pub icon_url: Option<String>,
    /// Logo URL.
    #[serde(default)]
    pub logo_url: Option<String>,
}

/// Tool descriptor including JSON Schema.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpToolDescriptor {
    /// Tool name.
    pub name: String,
    /// Optional title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Description.
    pub description: String,
    /// Annotations.
    pub annotations: Value,
    /// `_meta`.
    pub meta: Value,
    /// Icons.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icons: Option<Value>,
    /// JSON Schema.
    pub input_schema: Value,
    /// Optional output JSON Schema for `structuredContent`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<Value>,
}

/// Descriptor bundle (no handlers).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpDescriptors {
    /// Tools.
    pub tools: Vec<McpToolDescriptor>,
    /// Prompts.
    pub prompts: Vec<PromptDescriptorMetadata>,
    /// Resolved CSP.
    pub csp: SolvaPayMcpCsp,
    /// Overview docs resource (body omitted here — see `docs` + overview op).
    pub docs: Value,
    /// Bootstrap resource metadata.
    pub bootstrap: Value,
    /// UI resource metadata.
    pub resource: Value,
}

fn json_schema(properties: Value, required: &[&str]) -> Value {
    let mut schema = json!({ "type": "object", "properties": properties });
    if !required.is_empty() {
        schema["required"] = json!(required);
    }
    schema
}

fn mode_schema() -> Value {
    json!({ "type": "string", "enum": ["ui", "text", "auto"] })
}

fn output_schema_for(name: &str) -> Option<Value> {
    match name {
        "account" => Some(bootstrap_output_schema()),
        _ => None,
    }
}

fn bootstrap_output_schema() -> Value {
    json!({
        "type": "object",
        "additionalProperties": true,
        "properties": {
            "view": { "type": "string" },
            "productRef": { "type": "string" },
            "checkoutUrl": { "type": ["string", "null"] },
            "portalUrl": { "type": ["string", "null"] },
            "plans": { "type": "array" },
            "customer": {},
            "product": {},
            "merchant": {}
        }
    })
}

/// Gate `structuredContent` schema. Payable tools must not default to this —
/// a success payload would fail host validation. Pass it explicitly when a
/// tool only ever returns a gate.
#[must_use]
pub fn paywall_structured_content_schema() -> Value {
    json!({
        "oneOf": [
            {
                "type": "object",
                "required": ["kind", "product", "checkoutUrl", "message", "shortMessage"],
                "additionalProperties": true,
                "properties": {
                    "kind": { "const": "payment_required" },
                    "product": { "type": "string" },
                    "checkoutUrl": { "type": "string" },
                    "message": { "type": "string" },
                    "shortMessage": { "type": "string" },
                    "planRef": { "type": "string" },
                    "plans": { "type": "array" },
                    "meterName": { "type": "string" },
                    "unitPriceMinor": { "type": "number" },
                    "currency": { "type": "string" },
                    "included": {
                        "type": "object",
                        "properties": {
                            "total": { "type": "number" },
                            "used": { "type": "number" },
                            "remaining": { "type": "number" }
                        }
                    },
                    "creditBalance": { "type": "number" },
                    "balance": {},
                    "productDetails": {}
                }
            },
            {
                "type": "object",
                "required": ["kind", "product", "checkoutUrl", "message", "shortMessage"],
                "additionalProperties": true,
                "properties": {
                    "kind": { "const": "activation_required" },
                    "product": { "type": "string" },
                    "checkoutUrl": { "type": "string" },
                    "message": { "type": "string" },
                    "shortMessage": { "type": "string" },
                    "planRef": { "type": "string" },
                    "plans": { "type": "array" },
                    "meterName": { "type": "string" },
                    "unitPriceMinor": { "type": "number" },
                    "currency": { "type": "string" },
                    "included": {
                        "type": "object",
                        "properties": {
                            "total": { "type": "number" },
                            "used": { "type": "number" },
                            "remaining": { "type": "number" }
                        }
                    },
                    "creditBalance": { "type": "number" },
                    "confirmationUrl": { "type": "string" },
                    "balance": {},
                    "productDetails": {}
                }
            }
        ]
    })
}

/// Union a merchant `outputSchema` with the paywall gate schema so hosts that
/// validate `structuredContent` accept both success payloads and gates.
#[must_use]
pub fn union_payable_output_schema(merchant: &Value) -> Value {
    json!({
        "oneOf": [merchant, paywall_structured_content_schema()]
    })
}

fn view_schema(views: Option<&[String]>) -> Value {
    let default = [
        "checkout".to_owned(),
        "account".to_owned(),
        "topup".to_owned(),
        "auto-recharge".to_owned(),
    ];
    let enabled: Vec<String> = views
        .map(|items| {
            items
                .iter()
                .filter(|view| default.iter().any(|known| known == *view))
                .cloned()
                .collect()
        })
        .unwrap_or(default.to_vec());
    json!({ "type": "string", "enum": enabled })
}

fn input_schema_for(name: &str, views: Option<&[String]>) -> Value {
    match name {
        "account" => json_schema(
            json!({
                "view": view_schema(views),
                "mode": mode_schema()
            }),
            &[],
        ),
        "create_hosted_session" => json_schema(
            json!({
                "kind": { "type": "string", "enum": ["checkout", "portal"] },
                "planRef": { "type": "string" },
                "productRef": { "type": "string" }
            }),
            &["kind"],
        ),
        "create_payment_intent" => json_schema(
            json!({
                "purpose": { "type": "string", "enum": ["plan", "topup"] },
                "planRef": { "type": "string" },
                "productRef": { "type": "string" },
                "currency": { "type": "string" },
                "amount": { "type": "integer" },
                "description": { "type": "string" }
            }),
            &["purpose"],
        ),
        "process_payment" => json_schema(
            json!({
                "paymentIntentId": { "type": "string" },
                "productRef": { "type": "string" },
                "planRef": { "type": "string" }
            }),
            &["paymentIntentId", "productRef"],
        ),
        "attach_business_details" => json_schema(
            json!({
                "paymentIntentId": { "type": "string" },
                "isBusiness": { "type": "boolean" },
                "businessName": { "type": "string" },
                "country": { "type": "string" },
                "customerCountry": { "type": "string" },
                "customerName": { "type": "string" },
                "customerState": { "type": "string" },
                "customerPostalCode": { "type": "string" },
                "taxId": { "type": "string" },
                "taxIdType": { "type": "string", "enum": ["eu_vat", "gb_vat", "us_ein"] }
            }),
            &["paymentIntentId", "isBusiness"],
        ),
        "set_renewal" => json_schema(
            json!({
                "purchaseRef": { "type": "string" },
                "enabled": { "type": "boolean" },
                "reason": { "type": "string" }
            }),
            &["purchaseRef", "enabled"],
        ),
        "get_history" => json_schema(
            json!({
                "productRef": { "type": "string" },
                "limit": { "type": "integer" }
            }),
            &[],
        ),
        "activate_plan" => json_schema(
            json!({
                "planRef": { "type": "string" },
                "productRef": { "type": "string" }
            }),
            &["planRef"],
        ),
        _ => json_schema(json!({}), &[]),
    }
}

fn tool_from_meta(meta: ToolDescriptorMetadata, views: Option<&[String]>) -> McpToolDescriptor {
    let name = meta.name.clone();
    let annotations = serde_json::to_value(&meta.annotations).unwrap_or_else(|_| json!({}));
    let icons = meta
        .icons
        .and_then(|icons| serde_json::to_value(icons).ok());
    McpToolDescriptor {
        name: name.clone(),
        title: meta.title,
        description: meta.description,
        annotations,
        meta: meta.meta,
        icons,
        input_schema: input_schema_for(&name, views),
        output_schema: output_schema_for(&name),
    }
}

/// Build descriptors (metadata + JSON Schema). Errors as JSON `{ "error": ... }`.
pub fn mcp_descriptors(input: &McpDescriptorsInput) -> Result<McpDescriptors, String> {
    if let Some(msg) = validate_public_base_url(&input.public_base_url) {
        return Err(msg.to_owned());
    }
    if let Err(err) = assert_valid_product_ref(&input.product_ref, "buildSolvaPayDescriptors") {
        let message = match err {
            solvapay_core::SdkError::Api { message, .. } => message,
            other => format!("{other:?}"),
        };
        return Err(message);
    }
    let branding = input.branding.as_ref().map(|b| MerchantBranding {
        brand_name: b.brand_name.clone(),
        icon_url: b.icon_url.clone(),
        logo_url: b.logo_url.clone(),
    });
    let options = BuildToolDescriptorMetadataOptions {
        resource_uri: input.resource_uri.clone(),
        views: input.views.clone(),
        branding,
    };
    let tools = build_tool_descriptor_metadata(&options)
        .into_iter()
        .map(|meta| tool_from_meta(meta, input.views.as_deref()))
        .collect();
    let prompts = build_prompt_descriptor_metadata(&BuildPromptDescriptorMetadataOptions {
        views: input.views.clone(),
    });
    let csp = mcp_merge_csp(input.csp.as_ref(), input.api_base_url.as_deref());
    let overview = mcp_overview_resource();
    Ok(McpDescriptors {
        tools,
        prompts,
        csp: csp.clone(),
        docs: json!({
            "uri": overview.uri,
            "name": overview.name,
            "title": overview.title,
            "description": overview.description,
            "mimeType": overview.mime_type,
        }),
        bootstrap: json!({
            "uri": "solvapay://bootstrap.json",
            "name": "SolvaPay bootstrap",
            "title": "SolvaPay bootstrap",
            "description": "Current merchant/product/plans/customer snapshot for the embedded UI. Widgets read this idempotently when the host scrubs structuredContent from tool results.",
            "mimeType": "application/json",
        }),
        resource: json!({
            "uri": input.resource_uri,
            "mimeType": "text/html;profile=mcp-app",
            "csp": csp,
        }),
    })
}
