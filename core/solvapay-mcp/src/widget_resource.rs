//! Host-side widget `resources/read` envelope (`mcpWidgetResource`).

#![allow(clippy::missing_docs_in_private_items)]

use serde::Deserialize;
use serde_json::{json, Value};

use crate::csp::SolvaPayMcpCsp;
use crate::descriptors::{mcp_descriptors, BrandingIn, McpDescriptorsInput};
use crate::engine::{is_modern_era, stamp_catalog_result};

/// MIME type for the vendored MCP App widget.
pub const MCP_APP_MIME_TYPE: &str = "text/html;profile=mcp-app";

/// Input for [`mcp_widget_resource`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpWidgetResourceInput {
    /// JSON-RPC request object.
    pub rpc: Value,
    /// UI resource URI this host serves.
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
    /// Optional branding forwarded to [`mcp_descriptors`].
    #[serde(default)]
    pub branding: Option<BrandingIn>,
}

/// Build a widget `resources/read` JSON-RPC envelope with `text` omitted.
///
/// Returns `None` when the request is not a read of this host's widget URI.
pub fn mcp_widget_resource(input: &McpWidgetResourceInput) -> Result<Option<Value>, String> {
    if input.rpc.get("method").and_then(Value::as_str) != Some("resources/read") {
        return Ok(None);
    }
    let Some(uri) = input.rpc.pointer("/params/uri").and_then(Value::as_str) else {
        return Ok(None);
    };
    if uri != input.resource_uri {
        return Ok(None);
    }

    let desc = mcp_descriptors(&McpDescriptorsInput {
        resource_uri: input.resource_uri.clone(),
        public_base_url: input.public_base_url.clone(),
        product_ref: input.product_ref.clone(),
        views: input.views.clone(),
        csp: input.csp.clone(),
        api_base_url: input.api_base_url.clone(),
        branding: input.branding.clone(),
    })?;
    let csp = serde_json::to_value(&desc.csp).map_err(|err| err.to_string())?;

    let mut result = json!({
        "contents": [{
            "uri": uri,
            "mimeType": MCP_APP_MIME_TYPE,
            "_meta": {
                "ui": {
                    "prefersBorder": false,
                    "csp": csp,
                }
            }
        }]
    });
    if is_modern_era(&input.rpc) {
        stamp_catalog_result(&mut result);
    }

    Ok(Some(json!({
        "jsonrpc": "2.0",
        "id": input.rpc.get("id").cloned().unwrap_or(Value::Null),
        "result": result,
    })))
}

#[cfg(test)]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use serde_json::{json, Value};

    use crate::dispatch_sync;

    const RESOURCE_URI: &str = "ui://test/view.html";

    fn widget_args(rpc: Value) -> String {
        json!({
            "rpc": rpc,
            "resourceUri": RESOURCE_URI,
            "publicBaseUrl": "https://app.example.com",
            "productRef": "prd_demo",
        })
        .to_string()
    }

    fn dispatch(args: &str) -> Value {
        let parsed: Value =
            serde_json::from_str(&dispatch_sync("mcpWidgetResource", args)).unwrap();
        assert_eq!(parsed["ok"], true, "envelope {parsed}");
        parsed["value"].clone()
    }

    fn widget_rpc(modern: bool) -> Value {
        let mut params = json!({ "uri": RESOURCE_URI });
        if modern {
            params["_meta"] = json!({
                "io.modelcontextprotocol/protocolVersion": "2026-07-28",
                "io.modelcontextprotocol/clientCapabilities": {},
            });
        }
        json!({
            "jsonrpc": "2.0",
            "id": 7,
            "method": "resources/read",
            "params": params,
        })
    }

    fn assert_content_shape(got: &Value) {
        let content = &got["result"]["contents"][0];
        assert_eq!(content["uri"], RESOURCE_URI);
        assert_eq!(content["mimeType"], "text/html;profile=mcp-app");
        assert_eq!(content["_meta"]["ui"]["prefersBorder"], false);
        assert!(content["_meta"]["ui"]["csp"].is_object());
        assert!(
            content.get("text").is_none(),
            "widget envelope must omit text so the host can splice HTML"
        );
    }

    #[test]
    fn modern_widget_read_stamps_catalog_envelope() {
        let got = dispatch(&widget_args(widget_rpc(true)));
        assert_eq!(got["jsonrpc"], "2.0");
        assert_eq!(got["id"], 7);
        assert_eq!(got["result"]["resultType"], "complete");
        assert_eq!(got["result"]["ttlMs"], 60_000);
        assert_eq!(got["result"]["cacheScope"], "public");
        assert!(got["result"]["_meta"]["io.modelcontextprotocol/serverInfo"].is_object());
        assert_content_shape(&got);
    }

    #[test]
    fn legacy_widget_read_omits_era_stamps() {
        let got = dispatch(&widget_args(widget_rpc(false)));
        assert_eq!(got["jsonrpc"], "2.0");
        assert_eq!(got["id"], 7);
        assert!(got["result"].get("resultType").is_none());
        assert!(got["result"].get("ttlMs").is_none());
        assert!(got["result"].get("cacheScope").is_none());
        assert!(got["result"].get("_meta").is_none());
        assert_content_shape(&got);
    }

    #[test]
    fn non_widget_uri_returns_null() {
        let mut rpc = widget_rpc(true);
        rpc["params"]["uri"] = json!("docs://solvapay/overview.md");
        assert_eq!(dispatch(&widget_args(rpc)), Value::Null);
    }

    #[test]
    fn non_resources_read_returns_null() {
        let rpc = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "ping",
        });
        assert_eq!(dispatch(&widget_args(rpc)), Value::Null);
    }
}
