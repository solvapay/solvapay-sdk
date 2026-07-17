//! Pure MCP descriptor metadata (Step 35).
//!
//! Parity target: `packages/mcp-core/src/descriptor-metadata.ts`.

use serde::Serialize;
use serde_json::{json, Value};

use super::tool_names::{MCP_TOOL_NAMES, TOOL_FOR_VIEW};

/// Frozen validation message for non-http(s) `publicBaseUrl`.
pub const PUBLIC_BASE_URL_ERROR: &str =
    "buildSolvaPayDescriptors: publicBaseUrl must be an http(s) URL (Stripe confirmPayment rejects `ui://`).";

/// Prefix stamped on UI-only transport tool descriptions.
const UI_ONLY_PREFIX: &str =
    "UI-only; agents should prefer `upgrade` / `manage_account` / `activate_plan`. ";

/// Trailing mode hint appended to intent-tool / activate_plan descriptions.
const MODE_HINT: &str =
    " By default renders the UI iframe with a one-line placeholder; pass `mode: 'text'` for a markdown-only summary on CLI / text-only hosts, or `mode: 'auto'` to include both.";

/// Default enabled views when the caller omits `views`.
const DEFAULT_VIEWS: &[&str] = &["checkout", "account", "topup"];

/// Merchant branding input for icon projection.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MerchantBranding {
    /// Display name (unused by icon projection).
    pub brand_name: Option<String>,
    /// Preferred square icon URL.
    pub icon_url: Option<String>,
    /// Landscape logo fallback URL.
    pub logo_url: Option<String>,
}

/// One MCP tool icon entry.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct ToolIcon {
    /// Absolute URL or `data:` URI.
    pub src: String,
    /// Size hints (omit when unset — skip-absent).
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sizes: Option<Vec<String>>,
}

/// Portable MCP tool annotations (only set flags are serialized).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolAnnotations {
    /// Always `true` for SolvaPay tools.
    pub open_world_hint: bool,
    /// Read-only hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub read_only_hint: Option<bool>,
    /// Destructive hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub destructive_hint: Option<bool>,
    /// Idempotent hint.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub idempotent_hint: Option<bool>,
}

/// Tool metadata without `inputSchema` / `handler`.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDescriptorMetadata {
    /// Tool name (snake_case wire name).
    pub name: String,
    /// Optional human title.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    /// Tool description (byte-exact, including prefix/hint concatenations).
    pub description: String,
    /// Annotation flags.
    pub annotations: ToolAnnotations,
    /// Descriptor `_meta` envelope.
    pub meta: Value,
    /// Brand icons when branding provided.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icons: Option<Vec<ToolIcon>>,
}

/// Prompt metadata without `argsSchema` / `handler`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PromptDescriptorMetadata {
    /// Prompt name (matches tool name).
    pub name: String,
    /// Prompt title.
    pub title: String,
    /// Prompt description.
    pub description: String,
}

/// Prompt user-message result (`SolvaPayPromptResult` parity).
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PromptUserMessage {
    /// Message list (always one user text message).
    pub messages: Vec<PromptMessage>,
}

/// One prompt message.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PromptMessage {
    /// Role (`user`).
    pub role: String,
    /// Text content block.
    pub content: PromptContent,
}

/// Prompt content block.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PromptContent {
    /// Always `"text"`.
    #[serde(rename = "type")]
    pub content_type: String,
    /// Message text.
    pub text: String,
}

/// Options for [`build_tool_descriptor_metadata`].
#[derive(Debug, Clone, Default)]
pub struct BuildToolDescriptorMetadataOptions {
    /// UI resource URI.
    pub resource_uri: String,
    /// Enabled views (default: all three).
    pub views: Option<Vec<String>>,
    /// Optional merchant branding.
    pub branding: Option<MerchantBranding>,
}

/// Options for [`build_prompt_descriptor_metadata`].
#[derive(Debug, Clone, Default)]
pub struct BuildPromptDescriptorMetadataOptions {
    /// Enabled views (default: all three).
    pub views: Option<Vec<String>>,
}

/// Project branding → icons (`deriveIcons` parity).
///
/// Returns `None` when branding is absent or has neither icon nor logo.
#[must_use]
pub fn derive_icons(branding: Option<&MerchantBranding>) -> Option<Vec<ToolIcon>> {
    let branding = branding?;
    if let Some(icon_url) = branding.icon_url.as_deref().filter(|s| !s.is_empty()) {
        return Some(vec![ToolIcon {
            src: icon_url.to_owned(),
            sizes: Some(vec!["any".to_owned(), "512x512".to_owned()]),
        }]);
    }
    if let Some(logo_url) = branding.logo_url.as_deref().filter(|s| !s.is_empty()) {
        return Some(vec![ToolIcon {
            src: logo_url.to_owned(),
            sizes: None,
        }]);
    }
    None
}

/// Validate `publicBaseUrl` is http(s). Returns frozen error message or `None`.
#[must_use]
pub fn validate_public_base_url(public_base_url: &str) -> Option<&'static str> {
    let lower = public_base_url.to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https://") {
        None
    } else {
        Some(PUBLIC_BASE_URL_ERROR)
    }
}

/// Stamp universal `openWorldHint: true` onto optional per-tool flags.
fn solvapay_tool(
    read_only: Option<bool>,
    destructive: Option<bool>,
    idempotent: Option<bool>,
) -> ToolAnnotations {
    ToolAnnotations {
        open_world_hint: true,
        read_only_hint: read_only,
        destructive_hint: destructive,
        idempotent_hint: idempotent,
    }
}

/// Intent-tool annotations (`readOnly` + `idempotent`).
fn intent_annotations() -> ToolAnnotations {
    solvapay_tool(Some(true), None, Some(true))
}

/// Intent / activate_plan descriptor meta (`ui.resourceUri` only).
fn tool_meta(resource_uri: &str) -> Value {
    json!({ "ui": { "resourceUri": resource_uri } })
}

/// Transport-tool meta (`ui.visibility`, `audience`, `openai/widgetAccessible`).
fn ui_tool_meta(resource_uri: &str) -> Value {
    json!({
        "ui": { "resourceUri": resource_uri, "visibility": ["app"] },
        "audience": "ui",
        "openai/widgetAccessible": true
    })
}

/// Look up a snake_case tool name by its camelCase `MCP_TOOL_NAMES` key.
fn lookup_tool_name(camel_key: &str) -> Option<&'static str> {
    MCP_TOOL_NAMES
        .iter()
        .find(|(k, _)| *k == camel_key)
        .map(|(_, v)| *v)
}

/// Whether `view` is present in the enabled-views list.
fn view_enabled(views: &[String], view: &str) -> bool {
    views.iter().any(|v| v == view)
}

/// Resolve a camelCase tool-name key, falling back to the key itself.
fn require_tool_name(camel_key: &str) -> String {
    match lookup_tool_name(camel_key) {
        Some(name) => name.to_owned(),
        None => camel_key.to_owned(),
    }
}

/// Ordered tool descriptor metadata.
#[must_use]
pub fn build_tool_descriptor_metadata(
    options: &BuildToolDescriptorMetadataOptions,
) -> Vec<ToolDescriptorMetadata> {
    let views: Vec<String> = options
        .views
        .clone()
        .unwrap_or_else(|| DEFAULT_VIEWS.iter().map(|s| (*s).to_owned()).collect());
    let icons = derive_icons(options.branding.as_ref());
    let resource_uri = options.resource_uri.as_str();
    let mut tools = Vec::new();

    let push = |tools: &mut Vec<ToolDescriptorMetadata>, mut meta: ToolDescriptorMetadata| {
        if let Some(ref icons) = icons {
            meta.icons = Some(icons.clone());
        }
        tools.push(meta);
    };

    for (view, tool_name) in TOOL_FOR_VIEW {
        if !view_enabled(&views, view) {
            continue;
        }
        let (title, description) = match *view {
            "checkout" => (
                "Upgrade plan",
                format!(
                    "Start or change a paid plan for the current customer. On UI hosts this opens the embedded checkout; on text hosts returns a markdown summary with a checkout URL. This tool only returns a read-only snapshot or opens the UI — actual charges happen later in the embedded checkout after the customer confirms. Also available: manage_account (current plan + cancel/reactivate), activate_plan (pick or activate a specific plan), topup (add credits).{MODE_HINT}"
                ),
            ),
            "account" => (
                "Manage account",
                format!(
                    "Show or manage the current customer's SolvaPay account: plan, balance, usage, payment method, cancel/reactivate auto-renewal. On UI hosts this opens the embedded account view; on text hosts returns a markdown summary. Also available: upgrade (start/change a paid plan), activate_plan (pick or activate), topup (add credits).{MODE_HINT}"
                ),
            ),
            "topup" => (
                "Top up credits",
                format!(
                    "Add SolvaPay credits for the current customer. On UI hosts this opens the embedded top-up flow; on text hosts returns a markdown summary with a top-up URL. This tool only returns a read-only snapshot or opens the UI — credits are not charged until the customer confirms payment in the embedded flow. Also available: manage_account (current plan + balance + usage), upgrade (switch to a recurring plan).{MODE_HINT}"
                ),
            ),
            _ => continue,
        };
        push(
            &mut tools,
            ToolDescriptorMetadata {
                name: (*tool_name).to_owned(),
                title: Some(title.to_owned()),
                description,
                annotations: intent_annotations(),
                meta: tool_meta(resource_uri),
                icons: None,
            },
        );
    }

    let transport: &[(&str, &str, ToolAnnotations)] = &[
        (
            "createCheckoutSession",
            "Create a SolvaPay hosted checkout session and return its URL. The UI opens this URL in a new tab when Stripe Elements is blocked by the host sandbox.",
            solvapay_tool(None, None, None),
        ),
        (
            "createPayment",
            "Create a Stripe payment intent for the authenticated customer to purchase a plan. Returns { clientSecret, publishableKey, accountId?, customerRef } for confirmation with Stripe Elements in the app UI.",
            solvapay_tool(None, None, None),
        ),
        (
            "processPayment",
            "Process a Stripe payment intent after client-side confirmation and create the SolvaPay purchase. Call after confirmPayment resolves to short-circuit webhook latency.",
            solvapay_tool(None, Some(true), None),
        ),
        (
            "createCustomerSession",
            "Create a SolvaPay hosted customer portal session and return its URL. Used to let a paid customer manage or cancel their purchase in a new tab.",
            solvapay_tool(Some(true), None, Some(true)),
        ),
        (
            "createTopupPayment",
            "Create a Stripe payment intent for a credit top-up. Credits are recorded by the SolvaPay webhook after confirmation.",
            solvapay_tool(None, None, None),
        ),
        (
            "attachBusinessDetails",
            "Attach business purchase details to a payment intent and retrieve the computed tax breakdown.",
            solvapay_tool(None, None, None),
        ),
        (
            "cancelRenewal",
            "Cancel the auto-renewal on an active purchase. Backend keeps access until the current period ends.",
            solvapay_tool(None, Some(true), Some(true)),
        ),
        (
            "reactivateRenewal",
            "Undo a pending cancellation so auto-renewal resumes. Only valid while the purchase is still active and its end date hasn't passed.",
            solvapay_tool(None, None, Some(true)),
        ),
    ];

    for (camel_key, body, annotations) in transport {
        push(
            &mut tools,
            ToolDescriptorMetadata {
                name: require_tool_name(camel_key),
                title: None,
                description: format!("{UI_ONLY_PREFIX}{body}"),
                annotations: annotations.clone(),
                meta: ui_tool_meta(resource_uri),
                icons: None,
            },
        );
    }

    push(
        &mut tools,
        ToolDescriptorMetadata {
            name: require_tool_name("activatePlan"),
            title: Some("Activate plan".to_owned()),
            description: format!(
                "Activate a plan for the current customer. With a `planRef`: free plans activate immediately; usage-based plans activate when the balance covers the configured usage; paid plans return a markdown checkout link on text hosts or open the embedded checkout on UI hosts. Without a `planRef`: returns the available plans so the customer can pick — UI hosts render the embedded checkout picker, text hosts see a plans list. Also available: upgrade (direct to checkout), manage_account (current plan + usage), topup (add credits).{MODE_HINT}"
            ),
            annotations: solvapay_tool(None, None, None),
            meta: tool_meta(resource_uri),
            icons: None,
        },
    );

    tools
}

/// Ordered prompt metadata for enabled views.
#[must_use]
pub fn build_prompt_descriptor_metadata(
    options: &BuildPromptDescriptorMetadataOptions,
) -> Vec<PromptDescriptorMetadata> {
    let views: Vec<String> = options
        .views
        .clone()
        .unwrap_or_else(|| DEFAULT_VIEWS.iter().map(|s| (*s).to_owned()).collect());
    let mut prompts = Vec::new();

    if view_enabled(&views, "checkout") {
        prompts.push(PromptDescriptorMetadata {
            name: require_tool_name("upgrade"),
            title: "Upgrade plan".to_owned(),
            description: "Start or change a paid plan for the current customer.".to_owned(),
        });
    }
    if view_enabled(&views, "account") {
        prompts.push(PromptDescriptorMetadata {
            name: require_tool_name("manageAccount"),
            title: "Manage account".to_owned(),
            description:
                "Show the current plan, balance, payment method, and cancel/reactivate controls for the current customer."
                    .to_owned(),
        });
    }
    if view_enabled(&views, "topup") {
        prompts.push(PromptDescriptorMetadata {
            name: require_tool_name("topup"),
            title: "Top up credits".to_owned(),
            description: "Add SolvaPay credits to the current customer.".to_owned(),
        });
    }
    if view_enabled(&views, "checkout") {
        prompts.push(PromptDescriptorMetadata {
            name: require_tool_name("activatePlan"),
            title: "Activate plan".to_owned(),
            description: "Pick a plan to activate, or activate a specific plan by ref.".to_owned(),
        });
    }

    prompts
}

/// Pure user-message text for a SolvaPay slash-command prompt.
#[must_use]
pub fn build_prompt_user_message(prompt_name: &str, args: &Value) -> PromptUserMessage {
    let text = prompt_user_message_text(prompt_name, args);
    PromptUserMessage {
        messages: vec![PromptMessage {
            role: "user".to_owned(),
            content: PromptContent {
                content_type: "text".to_owned(),
                text,
            },
        }],
    }
}

/// Pure prompt body text for a known prompt name.
fn prompt_user_message_text(prompt_name: &str, args: &Value) -> String {
    let plan_ref = args
        .get("planRef")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let amount = args
        .get("amount")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());

    match prompt_name {
        "upgrade" => match plan_ref {
            Some(r) => format!("Activate plan {r} for me."),
            None => "Show me the upgrade options for my SolvaPay account.".to_owned(),
        },
        "manage_account" => "Show me my SolvaPay account.".to_owned(),
        "topup" => match amount {
            Some(a) => format!("Top up my SolvaPay credits by {a}."),
            None => "I want to top up my SolvaPay credits.".to_owned(),
        },
        "activate_plan" => match plan_ref {
            Some(r) => format!("Activate plan {r} on my SolvaPay account."),
            None => "What plans can I activate on my SolvaPay account?".to_owned(),
        },
        _ => String::new(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use serde_json::json;

    #[test]
    fn derive_icons_branches() {
        assert!(derive_icons(None).is_none());
        assert!(derive_icons(Some(&MerchantBranding {
            brand_name: Some("Acme".into()),
            ..Default::default()
        }))
        .is_none());
        let preferred = derive_icons(Some(&MerchantBranding {
            icon_url: Some("https://i".into()),
            logo_url: Some("https://l".into()),
            ..Default::default()
        }))
        .unwrap();
        assert_eq!(preferred[0].src, "https://i");
        assert_eq!(
            preferred[0].sizes.as_ref().unwrap(),
            &["any".to_owned(), "512x512".to_owned()]
        );
        let fallback = derive_icons(Some(&MerchantBranding {
            logo_url: Some("https://l".into()),
            ..Default::default()
        }))
        .unwrap();
        assert_eq!(fallback[0].src, "https://l");
        assert!(fallback[0].sizes.is_none());
    }

    #[test]
    fn validate_public_base_url_frozen_message() {
        assert_eq!(
            validate_public_base_url("ui://nope"),
            Some(PUBLIC_BASE_URL_ERROR)
        );
        assert!(validate_public_base_url("https://example.com").is_none());
        assert!(validate_public_base_url("HTTP://example.com").is_none());
    }

    #[test]
    fn default_tool_order_is_twelve() {
        let tools = build_tool_descriptor_metadata(&BuildToolDescriptorMetadataOptions {
            resource_uri: "ui://x".into(),
            ..Default::default()
        });
        assert_eq!(tools.len(), 12);
        assert_eq!(tools[0].name, "upgrade");
        assert_eq!(tools[11].name, "activate_plan");
        assert!(tools[0].description.contains(MODE_HINT.trim_start()));
        assert!(tools[3].description.starts_with(UI_ONLY_PREFIX));
    }

    #[test]
    fn views_empty_drops_intent_keeps_transport() {
        let tools = build_tool_descriptor_metadata(&BuildToolDescriptorMetadataOptions {
            resource_uri: "ui://x".into(),
            views: Some(vec![]),
            ..Default::default()
        });
        assert_eq!(tools.len(), 9);
        assert_eq!(tools[0].name, "create_checkout_session");
        assert_eq!(tools[8].name, "activate_plan");
    }

    #[test]
    fn prompt_messages_byte_exact() {
        let with_arg = build_prompt_user_message("upgrade", &json!({ "planRef": "pln_pro" }));
        assert_eq!(
            with_arg.messages[0].content.text,
            "Activate plan pln_pro for me."
        );
        let without = build_prompt_user_message("topup", &json!({}));
        assert_eq!(
            without.messages[0].content.text,
            "I want to top up my SolvaPay credits."
        );
    }

    #[test]
    fn prompt_metadata_checkout_disabled() {
        let prompts = build_prompt_descriptor_metadata(&BuildPromptDescriptorMetadataOptions {
            views: Some(vec!["account".into(), "topup".into()]),
        });
        assert_eq!(prompts.len(), 2);
        assert_eq!(prompts[0].name, "manage_account");
        assert_eq!(prompts[1].name, "topup");
    }
}
