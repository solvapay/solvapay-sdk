//! Agent payments: who is calling, and how a merchant drives one paid call.
//!
//! SolvaPay decides everything about an agent's call server-side (the
//! customer, the spend policy, the reservation, the owner's approval). What
//! lives here are the rules every merchant SDK must apply the same way:
//! recognising an agent credential, verifying an agent token, the prompt
//! facts sent with a call, the OAuth protected-resource document and its 401
//! challenge, strict reading of SolvaPay's answers, and the authorize loop's
//! next step. Transport (the four `/v1/sdk/agent/*` routes) is on
//! `SolvaPayClient`; timers, caches and logging stay with the host.

use serde_json::{json, Map, Value};

use crate::helper_error::HelperErrorResult;

/// Prefix of an agent key: long-lived, for one merchant, sent in place of an agent token.
pub const AGENT_KEY_PREFIX: &str = "agk_";
/// The one OAuth scope an agent token carries.
pub const AGENT_SCOPE: &str = "usage";
/// The most of a prompt SolvaPay accepts, in UTF-16 code units.
pub const PROMPT_EXCERPT_MAX: usize = 1500;
/// The longest one authorize request may hold; a longer wait is a series of requests.
pub const AUTHORIZE_WAIT_MAX_SECONDS: i64 = 55;
/// Clock skew accepted on agent token `exp` / `nbf`.
pub const AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS: i64 = 30;

/// Where an agent spends.
const ENVIRONMENTS: [&str; 2] = ["sandbox", "live"];
/// Why SolvaPay refused a call, as the merchant may branch on it.
const SERVER_REFUSAL_REASONS: [&str; 6] = [
    "customer_not_linked",
    "ask",
    "deny",
    "topup_required",
    "approval_declined",
    "approval_expired",
];
/// How a completed call was settled.
const SETTLE_SOURCES: [&str; 3] = ["reported", "provisional", "none"];
/// How SolvaPay reconciled one reported call.
const RECONCILIATION_RESULTS: [&str; 5] = [
    "matched",
    "adjusted",
    "pending",
    "already_reconciled",
    "ignored",
];
/// Why a reconciled call was adjusted or left pending.
const RECONCILIATION_REASONS: [&str; 4] = ["provisional", "expired", "no_debit", "cost_differs"];
/// Refusal copy when SolvaPay answers authorize with 401 / 403.
const NOT_ACCEPTED: &str = "SolvaPay did not accept this agent (revoked or not for this merchant).";
/// Refusal copy when SolvaPay could not be reached, or failed, at authorize.
const UNAVAILABLE: &str =
    "SolvaPay could not be reached to authorize this call. Try again shortly.";

/// A transport-kind helper error carrying `message` as its details.
fn invalid(message: impl Into<String>) -> HelperErrorResult {
    HelperErrorResult::transport(message)
}

/// The input object, or an error naming the helper that needed it.
fn require_input(
    input: Option<&Value>,
    label: &str,
) -> Result<Map<String, Value>, HelperErrorResult> {
    input
        .and_then(Value::as_object)
        .cloned()
        .ok_or_else(|| invalid(format!("{label} input must be an object")))
}

// ---------------------------------------------------------------------------
// Credentials
// ---------------------------------------------------------------------------

/// The environment a merchant secret key is for, from its prefix.
///
/// # Arguments
///
/// * `secret_key` - The merchant's SolvaPay secret key.
///
/// # Returns
///
/// `sandbox` for `sk_sandbox_…`, `live` for `sk_live_…`, otherwise `null`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 93
)]
#[must_use]
pub fn agent_secret_key_environment(secret_key: &str) -> Option<String> {
    if secret_key.starts_with("sk_sandbox_") {
        Some("sandbox".to_owned())
    } else if secret_key.starts_with("sk_live_") {
        Some("live".to_owned())
    } else {
        None
    }
}

/// What kind of credential a caller presented.
///
/// # Arguments
///
/// * `value` - The presented key or token.
///
/// # Returns
///
/// `agentKey` for `agk_…`, `jwt` for a JWS compact token (an agent token
/// candidate), otherwise `other`: the merchant's own auth decides.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 94
)]
#[must_use]
pub fn agent_credential_kind(value: &str) -> String {
    if value.starts_with(AGENT_KEY_PREFIX) && value.len() > AGENT_KEY_PREFIX.len() {
        return "agentKey".to_owned();
    }
    let segment = |s: &str| {
        !s.is_empty()
            && s.bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')
    };
    let parts: Vec<&str> = value.split('.').collect();
    if parts.len() == 3 && parts.iter().all(|part| segment(part)) {
        "jwt".to_owned()
    } else {
        "other".to_owned()
    }
}

/// Refuse an agent from the other environment. With the merchant's unknown,
/// SolvaPay refuses it at authorize instead.
fn check_environment(agent: Value, merchant: Option<&str>) -> Value {
    let agent_env = agent
        .get("environment")
        .and_then(Value::as_str)
        .unwrap_or("");
    match merchant {
        Some(merchant) if merchant != agent_env => json!({
            "ok": false,
            "reason": "environment_mismatch",
            "detail": format!("This agent spends in {agent_env}, and this secret key is for {merchant}"),
        }),
        _ => json!({ "ok": true, "agent": agent }),
    }
}

/// The merchant's environment from `input.environment`, when given.
fn merchant_environment(input: &Map<String, Value>) -> Result<Option<String>, HelperErrorResult> {
    match input.get("environment") {
        None | Some(Value::Null) => Ok(None),
        Some(Value::String(env)) if ENVIRONMENTS.contains(&env.as_str()) => Ok(Some(env.clone())),
        Some(other) => Err(invalid(format!(
            "environment must be one of sandbox, live, got {other}"
        ))),
    }
}

/// A `{ ok: false, reason, detail }` rejection.
fn rejected(reason: &str, detail: impl Into<String>) -> Value {
    json!({ "ok": false, "reason": reason, "detail": detail.into() })
}

/// Verify a SolvaPay agent token.
///
/// Agent tokens are ES256 JWTs signed by SolvaPay's agent service and issued
/// for one merchant: `aud` is its provider reference, or this server's OAuth
/// resource for a token a host got by OAuth.
///
/// # Arguments
///
/// * `input` - `{ token, jwks, issuer, providerRef, resource?, environment?, nowUnixSecs }`.
///   `jwks` is the issuer's published key set (`<issuer>/jwks.json`); fetching
///   and caching it is the host's job. `environment` is the merchant's
///   (`agentSecretKeyEnvironment`); an agent from the other one is refused.
///
/// # Returns
///
/// `{ ok: true, agent: { agentRef, principalRef, tokenId, expiresAt, promptExcerpt,
/// environment, clientId? } }` (`expiresAt` in Unix seconds), or
/// `{ ok: false, reason: 'expired' | 'invalid' | 'environment_mismatch', detail }`.
///
/// # Errors
///
/// When `input` itself is malformed (missing token, keys, issuer or clock).
#[cfg(feature = "agent-verify")]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 95
)]
pub fn verify_agent_token(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let input = require_input(input, "verifyAgentToken")?;
    let text = |key: &str| -> Result<String, HelperErrorResult> {
        input
            .get(key)
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| invalid(format!("{key} must be a non-empty string")))
    };
    let token = text("token")?;
    let issuer = text("issuer")?;
    let provider_ref = text("providerRef")?;
    let jwks = input
        .get("jwks")
        .filter(|v| v.is_object())
        .ok_or_else(|| invalid("jwks must be a JWKS object"))?;
    let now = input
        .get("nowUnixSecs")
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid("nowUnixSecs must be an integer"))?;
    let resource = match input.get("resource").and_then(Value::as_str) {
        Some(resource) => Some(canonical_resource(resource)?),
        None => None,
    };
    let merchant = merchant_environment(&input)?;

    let payload = match crate::jwt_es256::verify_es256_jwt(&token, jwks) {
        Ok(payload) => payload,
        Err(err) => return Ok(rejected("invalid", err.as_str())),
    };
    for claim in ["sub", "exp", "iat", "jti"] {
        if payload.get(claim).is_none() {
            return Ok(rejected(
                "invalid",
                format!("missing required \"{claim}\" claim"),
            ));
        }
    }
    let Some(exp) = payload.get("exp").and_then(Value::as_i64) else {
        return Ok(rejected("invalid", "\"exp\" claim must be a number"));
    };
    if payload.get("iat").and_then(Value::as_i64).is_none() {
        return Ok(rejected("invalid", "\"iat\" claim must be a number"));
    }
    if exp <= now - AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS {
        return Ok(rejected("expired", "\"exp\" claim timestamp check failed"));
    }
    if let Some(nbf) = payload.get("nbf") {
        match nbf.as_i64() {
            Some(nbf) if nbf <= now + AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS => {}
            _ => return Ok(rejected("invalid", "\"nbf\" claim timestamp check failed")),
        }
    }
    if payload.get("iss").and_then(Value::as_str) != Some(issuer.as_str()) {
        return Ok(rejected("invalid", "unexpected \"iss\" claim value"));
    }
    let audience_ok = |aud: &str| aud == provider_ref || resource.as_deref() == Some(aud);
    let aud_matches = match payload.get("aud") {
        Some(Value::String(aud)) => audience_ok(aud),
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).any(audience_ok),
        _ => false,
    };
    if !aud_matches {
        return Ok(rejected("invalid", "unexpected \"aud\" claim value"));
    }
    let client_id = match payload.get("cid") {
        None => None,
        Some(Value::String(cid)) => Some(cid.clone()),
        Some(_) => return Ok(rejected("invalid", "cid is not a string")),
    };
    let sub = payload.get("sub").and_then(Value::as_str).unwrap_or("");
    if !sub.starts_with("agt_") {
        return Ok(rejected("invalid", "sub is not an agent reference"));
    }
    let principal = payload
        .get("principal")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !principal.starts_with("ppl_") {
        return Ok(rejected("invalid", "principal is missing"));
    }
    if payload.get("scope").and_then(Value::as_str) != Some(AGENT_SCOPE) {
        return Ok(rejected("invalid", "scope is not usage"));
    }
    let environment = match payload.get("env").and_then(Value::as_str) {
        Some(env) if ENVIRONMENTS.contains(&env) => env,
        _ => return Ok(rejected("invalid", "env is not sandbox or live")),
    };
    let token_id = match payload.get("jti") {
        Some(Value::String(jti)) => jti.clone(),
        Some(other) => other.to_string(),
        None => String::new(),
    };
    let mut agent = json!({
        "agentRef": sub,
        "principalRef": principal,
        "tokenId": token_id,
        "expiresAt": exp,
        "promptExcerpt": payload.get("px") == Some(&Value::Bool(true)),
        "environment": environment,
    });
    if let (Some(cid), Some(obj)) = (client_id.filter(|c| !c.is_empty()), agent.as_object_mut()) {
        obj.insert("clientId".to_owned(), Value::String(cid));
    }
    Ok(check_environment(agent, merchant.as_deref()))
}

/// Turn SolvaPay's answer about an agent key into the same result a token gives.
///
/// # Arguments
///
/// * `input` - `{ verified }` with the `verifyAgentKey` response, or
///   `{ errorStatus, errorMessage }` for its 401 / 403; plus the merchant's
///   `environment`. Any other failure is the host's to throw: every paid call
///   would fail the same way.
///
/// # Returns
///
/// `{ ok: true, agent }` or `{ ok: false, reason, detail }`.
///
/// # Errors
///
/// When `verified` is malformed, or the error status is not 401 / 403.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 96
)]
pub fn agent_key_verification_result(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let input = require_input(input, "agentKeyVerificationResult")?;
    let merchant = merchant_environment(&input)?;
    if let Some(verified) = input.get("verified").filter(|v| !v.is_null()) {
        let key = parse_verified_agent_key(verified)?;
        return Ok(check_environment(key, merchant.as_deref()));
    }
    let status = input.get("errorStatus").and_then(Value::as_i64);
    let message = input
        .get("errorMessage")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("errorMessage must be a string"))?
        .to_owned();
    match status {
        // SolvaPay refuses a key from the other environment with this code in its 403.
        Some(403) if message.contains("environment_mismatch") => {
            Ok(rejected("environment_mismatch", message))
        }
        Some(401 | 403) => Ok(rejected("invalid", message)),
        _ => Err(invalid(format!(
            "agentKeyVerificationResult takes a verified key or a 401 / 403, got status {}",
            status.map_or_else(|| "none".to_owned(), |s| s.to_string())
        ))),
    }
}

// ---------------------------------------------------------------------------
// Prompt facts
// ---------------------------------------------------------------------------

/// What SolvaPay's classifier gets from a call's prompt.
///
/// # Arguments
///
/// * `text` - The prompt text the merchant picked (an LLM proxy: the last user
///   turn; an MCP tool: its input). Repeats of the same text show loops.
/// * `tool_error` - The prompt carries a tool result marked as an error.
///
/// # Returns
///
/// `{ promptHash: 'sha256:…', toolError, excerpt }`. `excerpt` is the last
/// 1,500 UTF-16 code units; a surrogate pair cut by that boundary is dropped
/// whole. It is sent only when the agent's token allows it (`px`).
#[cfg(feature = "hmac-crypto")]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 97
)]
#[must_use]
pub fn agent_prompt_facts(text: &str, tool_error: bool) -> Value {
    use sha2::{Digest, Sha256};
    let digest = Sha256::digest(text.as_bytes());
    let hex: String = digest.iter().map(|b| format!("{b:02x}")).collect();
    json!({
        "promptHash": format!("sha256:{hex}"),
        "toolError": tool_error,
        "excerpt": prompt_excerpt(text),
    })
}

/// The prompt's last 1,500 UTF-16 code units, never splitting a surrogate pair.
#[cfg(feature = "hmac-crypto")]
fn prompt_excerpt(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() <= PROMPT_EXCERPT_MAX {
        return text.to_owned();
    }
    let mut tail = &units[units.len() - PROMPT_EXCERPT_MAX..];
    if tail.first().is_some_and(|u| (0xDC00..=0xDFFF).contains(u)) {
        tail = &tail[1..];
    }
    String::from_utf16_lossy(tail)
}

// ---------------------------------------------------------------------------
// OAuth protected resource (RFC 9728)
// ---------------------------------------------------------------------------

/// The parts of an absolute http(s) URL the resource rules need.
struct ParsedUrl {
    /// Lowercased scheme (`http` / `https`).
    scheme: String,
    /// Lowercased host, with a non-default port.
    host: String,
    /// Path, `/` when empty.
    path: String,
    /// Query including `?`, empty when absent.
    search: String,
}

/// Parse an absolute http(s) URL, refusing a fragment or credentials.
fn parse_url(raw: &str) -> Result<ParsedUrl, HelperErrorResult> {
    let bad = || invalid(format!("{raw} is not an absolute http(s) URL"));
    let (scheme, rest) = raw.split_once("://").ok_or_else(bad)?;
    let scheme = scheme.to_ascii_lowercase();
    if scheme != "http" && scheme != "https" {
        return Err(bad());
    }
    let (before_fragment, fragment) = match rest.split_once('#') {
        Some((before, fragment)) => (before, Some(fragment)),
        None => (rest, None),
    };
    let authority_end = before_fragment
        .find(['/', '?'])
        .unwrap_or(before_fragment.len());
    let authority = &before_fragment[..authority_end];
    let remainder = &before_fragment[authority_end..];
    if authority.is_empty() {
        return Err(bad());
    }
    if authority.contains('@') || fragment.is_some_and(|f| !f.is_empty()) {
        return Err(invalid(format!(
            "{raw} cannot be an OAuth resource: no fragment or credentials"
        )));
    }
    let lowered = authority.to_ascii_lowercase();
    let default_port = if scheme == "https" { ":443" } else { ":80" };
    let host = lowered
        .strip_suffix(default_port)
        .map_or_else(|| lowered.clone(), str::to_owned);
    let (path, search) = match remainder.split_once('?') {
        Some((path, query)) if !query.is_empty() => (path, format!("?{query}")),
        Some((path, _)) => (path, String::new()),
        None => (remainder, String::new()),
    };
    Ok(ParsedUrl {
        scheme,
        host,
        path: if path.is_empty() {
            "/".to_owned()
        } else {
            path.to_owned()
        },
        search,
    })
}

/// Canonical form SolvaPay compares resources in: scheme and host lowercased,
/// default port dropped, no trailing slash.
fn canonical_resource(resource: &str) -> Result<String, HelperErrorResult> {
    let url = parse_url(resource)?;
    Ok(format!(
        "{}://{}{}{}",
        url.scheme,
        url.host,
        url.path.trim_end_matches('/'),
        url.search
    ))
}

/// Everything a merchant serves about itself as an OAuth protected resource.
///
/// # Arguments
///
/// * `input` - `{ resource, authorizationServer, metadataPath?, serverName?, documentation? }`.
///   `resource` is the MCP or API URL with its path; `authorizationServer` is
///   SolvaPay's agent issuer.
///
/// # Returns
///
/// `{ resource, metadataPath, metadataUrl, metadata }`: the canonical resource
/// (and expected `aud`), where the RFC 9728 document is served (by default
/// path-suffixed, which hosts try first), its absolute URL, and the document.
///
/// # Errors
///
/// When `resource` is not an absolute http(s) URL, or has a fragment or credentials.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 98
)]
pub fn agent_protected_resource(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let input = require_input(input, "agentProtectedResource")?;
    let resource = input
        .get("resource")
        .and_then(Value::as_str)
        .ok_or_else(|| invalid("resource must be a URL string"))?;
    let authorization_server = input
        .get("authorizationServer")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("authorizationServer must be a non-empty string"))?;
    let canonical = canonical_resource(resource)?;
    let parsed = parse_url(&canonical)?;
    let metadata_path = match input.get("metadataPath").and_then(Value::as_str) {
        Some(path) if path.starts_with('/') => path.to_owned(),
        Some(path) => {
            return Err(invalid(format!(
                "metadataPath must start with '/', got {path}"
            )))
        }
        None => format!("/.well-known/oauth-protected-resource{}", parsed.path),
    };
    let origin = parse_url(resource)?;
    let metadata_url = format!("{}://{}{}", origin.scheme, origin.host, metadata_path);
    let mut metadata = json!({
        "resource": canonical,
        "authorization_servers": [authorization_server],
        "scopes_supported": [AGENT_SCOPE],
        "bearer_methods_supported": ["header"],
    });
    if let Some(obj) = metadata.as_object_mut() {
        if let Some(name) = input.get("serverName").and_then(Value::as_str) {
            obj.insert("resource_name".to_owned(), json!(name));
        }
        if let Some(docs) = input.get("documentation").and_then(Value::as_str) {
            obj.insert("resource_documentation".to_owned(), json!(docs));
        }
    }
    Ok(json!({
        "resource": canonical,
        "metadataPath": metadata_path,
        "metadataUrl": metadata_url,
        "metadata": metadata,
    }))
}

/// The 401 that sends a host to sign the owner in, or refresh, and retry.
///
/// # Arguments
///
/// * `input` - The [`agent_protected_resource`] input plus `description` (why)
///   and an optional `jsonRpcId`.
///
/// # Returns
///
/// `{ status: 401, headers, body }`. `WWW-Authenticate` carries `error` and
/// `error_description` (ChatGPT requires both), the metadata URL and the one
/// scope; `body` is a JSON-RPC error with code -32001.
///
/// # Errors
///
/// As [`agent_protected_resource`], or a missing `description`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 99
)]
pub fn agent_auth_challenge(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let resource = agent_protected_resource(input)?;
    let obj = require_input(input, "agentAuthChallenge")?;
    let description = obj
        .get("description")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| invalid("description must be a non-empty string"))?;
    let quoted = description.replace('\\', "\\\\").replace('"', "\\\"");
    let metadata_url = resource
        .get("metadataUrl")
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(json!({
        "status": 401,
        "headers": {
            "WWW-Authenticate": format!(
                "Bearer error=\"invalid_token\", error_description=\"{quoted}\", resource_metadata=\"{metadata_url}\", scope=\"{AGENT_SCOPE}\""
            ),
            "Access-Control-Expose-Headers": "WWW-Authenticate",
            "Content-Type": "application/json",
        },
        "body": {
            "jsonrpc": "2.0",
            "id": obj.get("jsonRpcId").cloned().unwrap_or(Value::Null),
            "error": { "code": -32001, "message": description },
        },
    }))
}

// ---------------------------------------------------------------------------
// Reading SolvaPay's answers, field by field
// ---------------------------------------------------------------------------

/// A value as JSON for error messages, `undefined` when absent.
fn describe(value: Option<&Value>) -> String {
    value.map_or_else(|| "undefined".to_owned(), Value::to_string)
}

/// A required non-empty string field.
fn req_str(obj: &Map<String, Value>, key: &str, label: &str) -> Result<String, HelperErrorResult> {
    obj.get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| invalid(format!("{label} must be a non-empty string")))
}

/// A required boolean field.
fn req_bool(obj: &Map<String, Value>, key: &str, label: &str) -> Result<bool, HelperErrorResult> {
    obj.get(key)
        .and_then(Value::as_bool)
        .ok_or_else(|| invalid(format!("{label} must be a boolean")))
}

/// A required string field from a closed set.
fn req_one_of(
    obj: &Map<String, Value>,
    key: &str,
    label: &str,
    allowed: &[&str],
) -> Result<String, HelperErrorResult> {
    match obj.get(key).and_then(Value::as_str) {
        Some(value) if allowed.contains(&value) => Ok(value.to_owned()),
        _ => Err(invalid(format!(
            "{label} must be one of {}, got {}",
            allowed.join(", "),
            describe(obj.get(key))
        ))),
    }
}

/// A required object field.
fn req_obj<'a>(
    obj: &'a Map<String, Value>,
    key: &str,
    message: &str,
) -> Result<&'a Map<String, Value>, HelperErrorResult> {
    obj.get(key)
        .and_then(Value::as_object)
        .ok_or_else(|| invalid(message.to_owned()))
}

/// A required `{ amount, currency }` field.
fn money(obj: &Map<String, Value>, key: &str, label: &str) -> Result<Value, HelperErrorResult> {
    let m = req_obj(
        obj,
        key,
        &format!("{label} must be an object with amount and currency"),
    )?;
    Ok(json!({
        "amount": req_str(m, "amount", &format!("{label}.amount"))?,
        "currency": req_str(m, "currency", &format!("{label}.currency"))?,
    }))
}

/// The response root as an object.
fn root<'a>(value: &'a Value, what: &str) -> Result<&'a Map<String, Value>, HelperErrorResult> {
    value
        .as_object()
        .ok_or_else(|| invalid(format!("{what} was not an object")))
}

/// Read a `verifyAgentKey` answer.
fn parse_verified_agent_key(value: &Value) -> Result<Value, HelperErrorResult> {
    let obj = root(value, "Agent key verification")?;
    Ok(json!({
        "agentRef": req_str(obj, "agentRef", "agentRef")?,
        "principalRef": req_str(obj, "principalRef", "principalRef")?,
        "promptExcerpt": req_bool(obj, "promptExcerpt", "promptExcerpt")?,
        "environment": req_one_of(obj, "environment", "environment", &ENVIRONMENTS)?,
    }))
}

/// Read an `authorizeAgentCall` answer.
fn parse_authorize(value: &Value) -> Result<Value, HelperErrorResult> {
    let obj = root(value, "Authorize response")?;
    let call_ref = req_str(obj, "callRef", "callRef")?;
    let status = req_str(obj, "status", "status")?;
    match status.as_str() {
        "allowed" => {
            let reservation = req_obj(obj, "reservation", "reservation must be an object")?;
            Ok(json!({
                "status": "allowed",
                "callRef": call_ref,
                "reservation": {
                    "held": money(reservation, "held", "reservation.held")?,
                    "expiresAt": req_str(reservation, "expiresAt", "reservation.expiresAt")?,
                },
            }))
        }
        "refused" => Ok(json!({
            "status": "refused",
            "callRef": call_ref,
            "reason": req_one_of(obj, "reason", "reason", &SERVER_REFUSAL_REASONS)?,
            "message": req_str(obj, "message", "message")?,
        })),
        "waiting" => {
            let approval = req_obj(obj, "approval", "approval must be an object")?;
            let retry = obj
                .get("retryAfterSeconds")
                .and_then(Value::as_i64)
                .ok_or_else(|| invalid("retryAfterSeconds must be an integer"))?;
            Ok(json!({
                "status": "waiting",
                "callRef": call_ref,
                "message": req_str(obj, "message", "message")?,
                "approval": {
                    "reference": req_str(approval, "reference", "approval.reference")?,
                    "expiresAt": req_str(approval, "expiresAt", "approval.expiresAt")?,
                },
                "retryAfterSeconds": retry,
            }))
        }
        other => Err(invalid(format!(
            "Authorize status \"{other}\" is not allowed, refused or waiting"
        ))),
    }
}

/// Read a `completeAgentCall` answer.
fn parse_complete(value: &Value) -> Result<Value, HelperErrorResult> {
    let obj = root(value, "Complete response")?;
    Ok(json!({
        "callRef": req_str(obj, "callRef", "callRef")?,
        "settled": req_bool(obj, "settled", "settled")?,
        "source": req_one_of(obj, "source", "source", &SETTLE_SOURCES)?,
        "amount": money(obj, "amount", "amount")?,
        "duplicate": req_bool(obj, "duplicate", "duplicate")?,
    }))
}

/// Read a `reportAgentUsage` answer.
fn parse_usage_report(value: &Value) -> Result<Value, HelperErrorResult> {
    let obj = root(value, "Usage report response")?;
    let results = obj
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| invalid("Usage report results must be a list"))?;
    let untagged = req_obj(obj, "untagged", "Usage report untagged must be an object")?;
    let mut parsed = Vec::with_capacity(results.len());
    for item in results {
        let item = root(item, "Usage report result")?;
        let mut out = Map::new();
        let optional = |key: &str, out: &mut Map<String, Value>| -> Result<(), HelperErrorResult> {
            match item.get(key) {
                None | Some(Value::Null) => Ok(()),
                Some(_) => {
                    out.insert(key.to_owned(), json!(req_str(item, key, key)?));
                    Ok(())
                }
            }
        };
        optional("callRef", &mut out)?;
        out.insert(
            "result".to_owned(),
            json!(req_one_of(
                item,
                "result",
                "result",
                &RECONCILIATION_RESULTS
            )?),
        );
        if !matches!(item.get("reason"), None | Some(Value::Null)) {
            out.insert(
                "reason".to_owned(),
                json!(req_one_of(
                    item,
                    "reason",
                    "reason",
                    &RECONCILIATION_REASONS
                )?),
            );
        }
        for key in [
            "reported",
            "bookedPolicy",
            "bookedCredit",
            "policyDelta",
            "creditDelta",
        ] {
            optional(key, &mut out)?;
        }
        parsed.push(Value::Object(out));
    }
    Ok(json!({
        "reference": req_str(obj, "reference", "reference")?,
        "currency": req_str(obj, "currency", "currency")?,
        "duplicate": req_bool(obj, "duplicate", "duplicate")?,
        "results": parsed,
        "untagged": {
            "total": req_str(untagged, "total", "untagged.total")?,
            "beforePolicy": req_str(untagged, "beforePolicy", "untagged.beforePolicy")?,
            "flagged": req_bool(untagged, "flagged", "untagged.flagged")?,
        },
    }))
}

/// Read one of SolvaPay's agent answers strictly: a paid call goes ahead, and
/// books are settled, on it, so a misread must fail rather than guess.
///
/// # Arguments
///
/// * `kind` - `verifiedKey`, `authorize`, `complete` or `usageReport`.
/// * `value` - The response body as received.
///
/// # Returns
///
/// The response with only the documented fields, each checked.
///
/// # Errors
///
/// Naming the first field that is missing or of the wrong type or value.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 100
)]
pub fn parse_agent_response(kind: &str, value: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let value = value.unwrap_or(&Value::Null);
    match kind {
        "verifiedKey" => parse_verified_agent_key(value),
        "authorize" => parse_authorize(value),
        "complete" => parse_complete(value),
        "usageReport" => parse_usage_report(value),
        other => Err(invalid(format!(
            "parseAgentResponse kind must be verifiedKey, authorize, complete or usageReport, got {other}"
        ))),
    }
}

// ---------------------------------------------------------------------------
// One paid call
// ---------------------------------------------------------------------------

/// An amount as a decimal string with up to 8 places, trailing zeros trimmed.
fn amount_string(amount: f64) -> String {
    let fixed = format!("{amount:.8}");
    let trimmed = fixed.trim_end_matches('0').trim_end_matches('.');
    match trimmed {
        "" | "-0" => "0".to_owned(),
        other => other.to_owned(),
    }
}

/// The body of one authorize request.
///
/// # Arguments
///
/// * `input` - `{ agentToken, requestId, item, estimate: { amount, currency },
///   prompt?: { promptHash, toolError, excerpt }, promptExcerptAllowed, nowMs, deadlineMs }`.
///
/// # Returns
///
/// The `authorizeAgentCall` body. `wait` is the seconds left before the
/// deadline, at most 55. The prompt's end is included only when the agent's
/// token says its owner opted in.
///
/// # Errors
///
/// When a required field is missing.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 101
)]
pub fn agent_authorize_request(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let obj = require_input(input, "agentAuthorizeRequest")?;
    let now = obj
        .get("nowMs")
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid("nowMs must be a number"))?;
    let deadline = obj
        .get("deadlineMs")
        .and_then(Value::as_f64)
        .ok_or_else(|| invalid("deadlineMs must be a number"))?;
    #[allow(clippy::cast_possible_truncation)]
    let left = ((deadline - now) / 1000.0).floor() as i64;
    let wait = left.clamp(0, AUTHORIZE_WAIT_MAX_SECONDS);
    let mut body = json!({
        "agentToken": req_str(&obj, "agentToken", "agentToken")?,
        "requestId": req_str(&obj, "requestId", "requestId")?,
        "item": req_str(&obj, "item", "item")?,
        "estimate": money(&obj, "estimate", "estimate")?,
        "wait": wait,
    });
    if let (Some(prompt), Some(out)) = (
        obj.get("prompt").and_then(Value::as_object),
        body.as_object_mut(),
    ) {
        out.insert(
            "promptHash".to_owned(),
            json!(req_str(prompt, "promptHash", "prompt.promptHash")?),
        );
        out.insert(
            "toolError".to_owned(),
            json!(prompt
                .get("toolError")
                .and_then(Value::as_bool)
                .ok_or_else(|| invalid("prompt.toolError must be a boolean"))?),
        );
        if obj.get("promptExcerptAllowed") == Some(&Value::Bool(true)) {
            if let Some(excerpt) = prompt.get("excerpt").and_then(Value::as_str) {
                out.insert("promptExcerpt".to_owned(), json!(excerpt));
            }
        }
    }
    Ok(body)
}

/// What to do with one authorize answer.
///
/// # Arguments
///
/// * `input` - `{ response }` with the authorize body, or `{ errorStatus }`
///   (`null` when SolvaPay could not be reached); plus `maxWaitSeconds`,
///   `nowMs`, `deadlineMs` and `aborted` (the caller went away).
///
/// # Returns
///
/// `{ kind: 'allow', callRef, reservation }`,
/// `{ kind: 'refuse', reason, message, callRef?, approvalRef? }`, or
/// `{ kind: 'retry', sleepMs, callRef, approvalRef }`: ask again with the same
/// request id after `sleepMs`. A failed authorize is never let through:
/// 401 / 403 is `agent_not_accepted`, anything else `unavailable`.
///
/// # Errors
///
/// When the response is malformed (see [`parse_agent_response`]).
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 102
)]
pub fn agent_authorize_next(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let obj = require_input(input, "agentAuthorizeNext")?;
    if obj.contains_key("errorStatus") {
        return Ok(match obj.get("errorStatus").and_then(Value::as_i64) {
            Some(401 | 403) => json!({
                "kind": "refuse",
                "reason": "agent_not_accepted",
                "message": NOT_ACCEPTED,
            }),
            _ => json!({ "kind": "refuse", "reason": "unavailable", "message": UNAVAILABLE }),
        });
    }
    let answer = parse_authorize(obj.get("response").unwrap_or(&Value::Null))?;
    let call_ref = answer.get("callRef").cloned().unwrap_or(Value::Null);
    match answer.get("status").and_then(Value::as_str) {
        Some("allowed") => Ok(json!({
            "kind": "allow",
            "callRef": call_ref,
            "reservation": answer.get("reservation").cloned().unwrap_or(Value::Null),
        })),
        Some("refused") => Ok(json!({
            "kind": "refuse",
            "reason": answer.get("reason").cloned().unwrap_or(Value::Null),
            "message": answer.get("message").cloned().unwrap_or(Value::Null),
            "callRef": call_ref,
        })),
        _ => {
            let message = answer.get("message").cloned().unwrap_or(Value::Null);
            let approval_ref = answer
                .pointer("/approval/reference")
                .cloned()
                .unwrap_or(Value::Null);
            let refuse = |reason: &str| {
                json!({
                    "kind": "refuse",
                    "reason": reason,
                    "message": message,
                    "callRef": call_ref,
                    "approvalRef": approval_ref,
                })
            };
            if obj.get("maxWaitSeconds").and_then(Value::as_f64) == Some(0.0) {
                return Ok(refuse("ask"));
            }
            if obj.get("aborted") == Some(&Value::Bool(true)) {
                return Ok(refuse("approval_client_closed"));
            }
            let number = |key: &str| {
                obj.get(key)
                    .and_then(Value::as_f64)
                    .ok_or_else(|| invalid(format!("{key} must be a number")))
            };
            if number("nowMs")? >= number("deadlineMs")? {
                return Ok(refuse("approval_timed_out"));
            }
            let retry = answer
                .get("retryAfterSeconds")
                .and_then(Value::as_i64)
                .ok_or_else(|| invalid("retryAfterSeconds must be an integer"))?;
            Ok(json!({
                "kind": "retry",
                "sleepMs": retry * 1000,
                "callRef": call_ref,
                "approvalRef": approval_ref,
            }))
        }
    }
}

/// The body that completes an allowed call.
///
/// # Arguments
///
/// * `input` - `{ status, cost: { amount: number, currency } | null, interrupted? }`:
///   how the upstream answered. A call that never reached the upstream is
///   `{ status: 502, cost: null, interrupted }`, so nothing is charged.
///
/// # Returns
///
/// The `completeAgentCall` body; the cost amount as a decimal string with up
/// to 8 places.
///
/// # Errors
///
/// When `status` is missing or `cost` is malformed.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 103
)]
pub fn agent_complete_body(input: Option<&Value>) -> Result<Value, HelperErrorResult> {
    let obj = require_input(input, "agentCompleteBody")?;
    let status = obj
        .get("status")
        .and_then(Value::as_i64)
        .ok_or_else(|| invalid("status must be an integer"))?;
    let cost = match obj.get("cost") {
        None | Some(Value::Null) => Value::Null,
        Some(Value::Object(cost)) => {
            let amount = cost
                .get("amount")
                .and_then(Value::as_f64)
                .ok_or_else(|| invalid("cost.amount must be a number"))?;
            json!({
                "amount": amount_string(amount),
                "currency": req_str(cost, "currency", "cost.currency")?,
            })
        }
        Some(_) => return Err(invalid("cost must be an object or null")),
    };
    let mut body = json!({ "status": status, "cost": cost });
    if let (Some(reason), Some(out)) = (
        obj.get("interrupted")
            .and_then(Value::as_str)
            .filter(|s| !s.is_empty()),
        body.as_object_mut(),
    ) {
        out.insert("interrupted".to_owned(), json!(reason));
    }
    Ok(body)
}

#[cfg(test)]
mod tests {
    #![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

    use super::*;

    #[test]
    fn credential_kinds() {
        assert_eq!(agent_credential_kind("agk_abc"), "agentKey");
        assert_eq!(agent_credential_kind("agk_"), "other");
        assert_eq!(agent_credential_kind("aaa.bbb.ccc"), "jwt");
        assert_eq!(agent_credential_kind("sk_live_x"), "other");
        assert_eq!(agent_credential_kind("a..c"), "other");
    }

    #[test]
    fn secret_key_environments() {
        assert_eq!(
            agent_secret_key_environment("sk_sandbox_1").as_deref(),
            Some("sandbox")
        );
        assert_eq!(
            agent_secret_key_environment("sk_live_1").as_deref(),
            Some("live")
        );
        assert_eq!(agent_secret_key_environment("sk_test_1"), None);
    }

    #[test]
    fn amounts_trim_zeros() {
        assert_eq!(amount_string(0.0125), "0.0125");
        assert_eq!(amount_string(1.0), "1");
        assert_eq!(amount_string(0.0), "0");
        assert_eq!(amount_string(-0.0), "0");
        assert_eq!(amount_string(0.123_456_789), "0.12345679");
    }

    #[test]
    fn canonical_resources() {
        assert_eq!(
            canonical_resource("HTTPS://Api.Example.com:443/mcp/").unwrap(),
            "https://api.example.com/mcp"
        );
        assert_eq!(
            canonical_resource("http://x.dev:8080").unwrap(),
            "http://x.dev:8080"
        );
        assert!(canonical_resource("https://u:p@x.dev/mcp").is_err());
        assert!(canonical_resource("https://x.dev/mcp#frag").is_err());
        assert!(canonical_resource("x.dev/mcp").is_err());
    }

    #[test]
    fn protected_resource_paths() {
        let out = agent_protected_resource(Some(&json!({
            "resource": "https://mcp.example.com/mcp",
            "authorizationServer": "https://api.solvapay.com/v1/agent",
        })))
        .unwrap();
        assert_eq!(
            out["metadataPath"],
            "/.well-known/oauth-protected-resource/mcp"
        );
        assert_eq!(
            out["metadataUrl"],
            "https://mcp.example.com/.well-known/oauth-protected-resource/mcp"
        );
        let root = agent_protected_resource(Some(&json!({
            "resource": "https://api.example.com",
            "authorizationServer": "https://api.solvapay.com/v1/agent",
        })))
        .unwrap();
        assert_eq!(
            root["metadataPath"],
            "/.well-known/oauth-protected-resource/"
        );
        assert_eq!(root["resource"], "https://api.example.com");
    }

    #[test]
    fn challenge_quotes_description() {
        let out = agent_auth_challenge(Some(&json!({
            "resource": "https://mcp.example.com/mcp",
            "authorizationServer": "https://api.solvapay.com/v1/agent",
            "description": "say \"hi\"",
            "jsonRpcId": 7,
        })))
        .unwrap();
        assert_eq!(out["status"], 401);
        assert!(out["headers"]["WWW-Authenticate"]
            .as_str()
            .unwrap()
            .contains("error_description=\"say \\\"hi\\\"\""));
        assert_eq!(out["body"]["id"], 7);
        assert_eq!(out["body"]["error"]["code"], -32001);
    }

    #[cfg(feature = "hmac-crypto")]
    #[test]
    fn prompt_facts_hash_and_excerpt() {
        let facts = agent_prompt_facts("hello", false);
        assert_eq!(
            facts["promptHash"],
            "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(facts["toolError"], false);
        assert_eq!(facts["excerpt"], "hello");
        let long = "a".repeat(1600);
        let facts = agent_prompt_facts(&long, true);
        assert_eq!(facts["excerpt"].as_str().unwrap().len(), 1500);
        assert_eq!(facts["toolError"], true);
    }

    #[test]
    fn authorize_request_gates_excerpt_and_caps_wait() {
        let base = json!({
            "agentToken": "t", "requestId": "r", "item": "m",
            "estimate": { "amount": "0.01", "currency": "USD" },
            "prompt": { "promptHash": "sha256:x", "toolError": false, "excerpt": "end" },
            "promptExcerptAllowed": false, "nowMs": 0, "deadlineMs": 120_000,
        });
        let body = agent_authorize_request(Some(&base)).unwrap();
        assert_eq!(body["wait"], 55);
        assert!(body.get("promptExcerpt").is_none());
        let mut allowed = base.clone();
        allowed["promptExcerptAllowed"] = json!(true);
        allowed["deadlineMs"] = json!(-5);
        let body = agent_authorize_request(Some(&allowed)).unwrap();
        assert_eq!(body["promptExcerpt"], "end");
        assert_eq!(body["wait"], 0);
    }

    #[test]
    fn authorize_next_outcomes() {
        let waiting = json!({
            "status": "waiting", "callRef": "acl_1", "message": "Waiting",
            "approval": { "reference": "apr_1", "expiresAt": "x" }, "retryAfterSeconds": 2,
        });
        let next = |extra: Value| {
            let mut input = json!({ "response": waiting, "maxWaitSeconds": 30, "nowMs": 0, "deadlineMs": 10_000, "aborted": false });
            for (k, v) in extra.as_object().unwrap() {
                input[k] = v.clone();
            }
            agent_authorize_next(Some(&input)).unwrap()
        };
        assert_eq!(next(json!({}))["kind"], "retry");
        assert_eq!(next(json!({}))["sleepMs"], 2000);
        assert_eq!(next(json!({ "maxWaitSeconds": 0 }))["reason"], "ask");
        assert_eq!(
            next(json!({ "aborted": true }))["reason"],
            "approval_client_closed"
        );
        assert_eq!(
            next(json!({ "nowMs": 10_000 }))["reason"],
            "approval_timed_out"
        );
        let failed = agent_authorize_next(Some(&json!({ "errorStatus": 403 }))).unwrap();
        assert_eq!(failed["reason"], "agent_not_accepted");
        let down = agent_authorize_next(Some(&json!({ "errorStatus": null }))).unwrap();
        assert_eq!(down["reason"], "unavailable");
    }

    #[test]
    fn parse_rejects_unknown_status() {
        let err = parse_agent_response(
            "authorize",
            Some(&json!({ "status": "maybe", "callRef": "acl_1" })),
        )
        .unwrap_err();
        assert!(err.details.unwrap().contains("\"maybe\""));
    }

    #[test]
    fn key_verification_maps_refusals() {
        let mismatch = agent_key_verification_result(Some(&json!({
            "errorStatus": 403, "errorMessage": "environment_mismatch: other env",
        })))
        .unwrap();
        assert_eq!(mismatch["reason"], "environment_mismatch");
        let ok = agent_key_verification_result(Some(&json!({
            "verified": { "agentRef": "agt_1", "principalRef": "ppl_1", "promptExcerpt": true, "environment": "live" },
            "environment": "sandbox",
        })))
        .unwrap();
        assert_eq!(ok["reason"], "environment_mismatch");
        assert!(agent_key_verification_result(Some(&json!({ "errorStatus": 500 }))).is_err());
    }

    #[cfg(feature = "agent-verify")]
    mod token {
        use super::*;
        use crate::jwt_util::base64url_decode;
        use p256::ecdsa::signature::Signer;
        use p256::ecdsa::{Signature, SigningKey};

        fn b64url(bytes: &[u8]) -> String {
            const T: &[u8; 64] =
                b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
            let mut out = String::new();
            for chunk in bytes.chunks(3) {
                let b = [
                    chunk[0],
                    *chunk.get(1).unwrap_or(&0),
                    *chunk.get(2).unwrap_or(&0),
                ];
                let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
                for i in 0..=chunk.len() {
                    out.push(T[((n >> (18 - 6 * i)) & 63) as usize] as char);
                }
            }
            out
        }

        fn key() -> SigningKey {
            SigningKey::from_bytes(&[7u8; 32].into()).unwrap()
        }

        fn jwks() -> Value {
            let point = key().verifying_key().to_encoded_point(false);
            json!({ "keys": [{
                "kty": "EC", "crv": "P-256", "kid": "k1",
                "x": b64url(point.x().unwrap()), "y": b64url(point.y().unwrap()),
            }]})
        }

        fn sign(claims: &Value) -> String {
            let header = b64url(br#"{"alg":"ES256","kid":"k1"}"#);
            let payload = b64url(claims.to_string().as_bytes());
            let input = format!("{header}.{payload}");
            let sig: Signature = key().sign(input.as_bytes());
            format!("{input}.{}", b64url(&sig.to_bytes()))
        }

        fn claims() -> Value {
            json!({
                "iss": "https://api.solvapay.com/v1/agent", "aud": "prov_1",
                "sub": "agt_1", "principal": "ppl_1", "scope": "usage", "env": "sandbox",
                "jti": "tok_1", "iat": 1000, "exp": 2000, "px": true,
            })
        }

        fn verify(token: &str, extra: Value) -> Value {
            let mut input = json!({
                "token": token, "jwks": jwks(), "issuer": "https://api.solvapay.com/v1/agent",
                "providerRef": "prov_1", "nowUnixSecs": 1500,
            });
            for (k, v) in extra.as_object().unwrap() {
                input[k] = v.clone();
            }
            verify_agent_token(Some(&input)).unwrap()
        }

        #[test]
        fn accepts_a_valid_token() {
            assert!(base64url_decode(&b64url(b"ab")).is_some());
            let out = verify(&sign(&claims()), json!({}));
            assert_eq!(out["ok"], true, "{out}");
            assert_eq!(out["agent"]["agentRef"], "agt_1");
            assert_eq!(out["agent"]["promptExcerpt"], true);
            assert_eq!(out["agent"]["expiresAt"], 2000);
        }

        #[test]
        fn rejects_expired_wrong_audience_and_environment() {
            let token = sign(&claims());
            assert_eq!(
                verify(&token, json!({ "nowUnixSecs": 2031 }))["reason"],
                "expired"
            );
            assert_eq!(
                verify(&token, json!({ "providerRef": "prov_2" }))["reason"],
                "invalid"
            );
            assert_eq!(
                verify(&token, json!({ "environment": "live" }))["reason"],
                "environment_mismatch"
            );
            let mut oauth = claims();
            oauth["aud"] = json!("https://mcp.example.com/mcp");
            assert_eq!(
                verify(
                    &sign(&oauth),
                    json!({ "resource": "https://MCP.example.com/mcp/" })
                )["ok"],
                true
            );
            let tampered = format!("{}x", &token[..token.len() - 1]);
            assert_eq!(verify(&tampered, json!({}))["reason"], "invalid");
        }
    }
}
