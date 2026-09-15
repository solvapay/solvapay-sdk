//! DCR failure diagnostic string (Python `dcr_failure_diagnostic` parity).

use serde::Deserialize;
use serde_json::json;
use serde_json::Value;

/// Input for [`mcp_dcr_diagnostics`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DcrDiagnosticsInput {
    /// Product ref from the integrator config.
    pub product_ref: String,
    /// Configured API origin.
    pub api_base_url: String,
    /// Upstream HTTP status.
    pub status: i64,
    /// Upstream body text.
    #[serde(default)]
    pub body_text: String,
}

/// Build the diagnostic log line (does not print).
#[must_use]
pub fn mcp_dcr_diagnostics(input: &DcrDiagnosticsInput) -> Value {
    let body = input.body_text.as_str();
    let looks_like_unresolved = body.to_ascii_lowercase().contains("invalid identifier")
        || (body.to_ascii_lowercase().contains("product_ref")
            && body.to_ascii_lowercase().contains("mcp_server_id"));
    let hint = if looks_like_unresolved {
        "The platform could not resolve this productRef (often a wrong/missing product or API base URL mismatch). A 400 \"Invalid identifier\" here means the product did not resolve — not that the DCR body was malformed. Run `npx solvapay doctor` or check SOLVAPAY_PRODUCT_REF / SOLVAPAY_API_BASE_URL."
    } else {
        "Upstream DCR rejected the registration. Check SOLVAPAY_PRODUCT_REF and SOLVAPAY_API_BASE_URL (or run `npx solvapay doctor`)."
    };
    json!({
        "message": format!(
            "[solvapay] OAuth DCR failed ({}) productRef={} apiBaseUrl={}. {hint}",
            input.status, input.product_ref, input.api_base_url
        )
    })
}
