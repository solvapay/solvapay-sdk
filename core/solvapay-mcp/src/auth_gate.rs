//! Auth gate (`allow` vs 401 challenge).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::bearer_verify::{
    extract_bearer_token, mcp_verify_bearer, VerifyBearerInput, VerifyBearerResult,
};
use crate::oauth::{mcp_resource_identifier, path_aware_protected_resource_path};

/// MCP auth mode (`isFreeMcpMethod` / `requires_bearer_auth`).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum McpAuthMode {
    /// Only `tools/call` requires a bearer.
    ToolsCall,
    /// Every method requires a bearer.
    All,
}

/// Whether `mcpMethod` is free (no bearer) in `tools-call` mode.
#[must_use]
pub fn is_free_mcp_method(mcp_method: Option<&str>) -> bool {
    !mcp_method
        .unwrap_or("")
        .trim()
        .eq_ignore_ascii_case("tools/call")
}

/// Whether a bearer is required for this method + mode.
#[must_use]
pub fn requires_bearer_auth(mcp_method: Option<&str>, auth_mode: McpAuthMode) -> bool {
    match auth_mode {
        McpAuthMode::All => true,
        McpAuthMode::ToolsCall => !is_free_mcp_method(mcp_method),
    }
}

/// Input for [`mcp_auth_gate`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthGateInput {
    /// JSON-RPC method (may be absent).
    #[serde(default)]
    pub rpc_method: Option<String>,
    /// `Authorization` header (may be null).
    #[serde(default)]
    pub auth_header: Option<String>,
    /// Auth mode. Defaults to `tools-call`.
    #[serde(default)]
    pub auth_mode: Option<McpAuthMode>,
    /// Public origin for `WWW-Authenticate`.
    pub public_base_url: String,
    /// Optional MCP mount path.
    #[serde(default)]
    pub mcp_path: Option<String>,
    /// JSON-RPC id echoed on the challenge body.
    #[serde(default)]
    pub json_rpc_id: Option<Value>,
    /// JWKS document for RS256 / ES256 verification.
    #[serde(default)]
    pub jwks_json: Option<Value>,
    /// Explicit HS256 secret (local / stub only — never inferred).
    #[serde(default)]
    pub hs256_secret: Option<String>,
    /// Expected `iss`. Defaults to the public origin.
    #[serde(default)]
    pub expected_issuer: Option<String>,
    /// Expected `aud`. Defaults to the MCP resource identifier.
    #[serde(default)]
    pub expected_audience: Option<String>,
    /// Explicit clock for `exp` / `nbf`. Required when a gated method presents a bearer.
    #[serde(default)]
    pub now_unix_secs: Option<i64>,
}

/// Auth-gate decision.
#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum AuthGateResult {
    /// Proceed to the handler.
    Allow,
    /// Return this HTTP challenge as-is.
    Challenge {
        /// HTTP status (401).
        status: u16,
        /// Response headers.
        headers: Value,
        /// JSON body.
        body: Value,
    },
}

/// Decide allow vs 401 challenge. A gated method requires a *verified* bearer
/// (JWKS RS256/ES256 or an explicit HS256 secret). Header presence is not enough.
#[must_use]
pub fn mcp_auth_gate(input: &AuthGateInput) -> AuthGateResult {
    let mode = input.auth_mode.unwrap_or(McpAuthMode::ToolsCall);
    let gated = requires_bearer_auth(input.rpc_method.as_deref(), mode);
    if !gated {
        return AuthGateResult::Allow;
    }
    if bearer_verified(input) {
        return AuthGateResult::Allow;
    }
    challenge(input)
}

fn bearer_verified(input: &AuthGateInput) -> bool {
    let Some(token) = extract_bearer_token(input.auth_header.as_deref()) else {
        return false;
    };
    let Some(now_unix_secs) = input.now_unix_secs else {
        return false;
    };
    let origin = input.public_base_url.trim_end_matches('/');
    let expected_issuer = input
        .expected_issuer
        .clone()
        .unwrap_or_else(|| origin.to_owned());
    let expected_audience = input
        .expected_audience
        .clone()
        .unwrap_or_else(|| mcp_resource_identifier(origin, input.mcp_path.as_deref()));
    matches!(
        mcp_verify_bearer(&VerifyBearerInput {
            token: token.to_owned(),
            jwks_json: input.jwks_json.clone(),
            hs256_secret: input.hs256_secret.clone(),
            expected_issuer,
            expected_audience,
            now_unix_secs,
            claim_priority: None,
        }),
        VerifyBearerResult::Ok { .. }
    )
}

fn challenge(input: &AuthGateInput) -> AuthGateResult {
    let origin = input.public_base_url.trim_end_matches('/');
    let metadata_path = match input.mcp_path.as_deref() {
        Some(path) if !path.is_empty() => path_aware_protected_resource_path(path),
        _ => "/.well-known/oauth-protected-resource".to_owned(),
    };
    AuthGateResult::Challenge {
        status: 401,
        headers: json!({
            "WWW-Authenticate": format!("Bearer resource_metadata=\"{origin}{metadata_path}\""),
            "Access-Control-Expose-Headers": "WWW-Authenticate",
            "Content-Type": "application/json",
        }),
        body: json!({
            "jsonrpc": "2.0",
            "id": input.json_rpc_id.clone().unwrap_or(Value::Null),
            "error": { "code": -32001, "message": "Unauthorized" },
        }),
    }
}
