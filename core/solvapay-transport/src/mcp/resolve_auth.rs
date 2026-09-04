//! `mcpResolveAuth` — single async bearer decision for every MCP facade.

use std::collections::BTreeMap;

use serde_json::{json, Value};
use solvapay_core::SdkError;
use solvapay_mcp_core::{
    customer_ref_from_claims, extract_bearer_token, mcp_auth_challenge, mcp_resource_identifier,
    mcp_verify_bearer, requires_bearer_auth, AuthGateInput, AuthGateResult, McpAuthMode,
    VerifyBearerInput, VerifyBearerResult,
};

use crate::client::SolvaPayClient;
use crate::http::Method;
use crate::mcp::{proxy_customer_auth, FetchJwksParams, McpResolveAuthParams};

const USERINFO_PATH: &str = "/v1/customer/auth/userinfo";
const TOKEN_USE_MCP_ACCESS: &str = "mcp_access";
const MSG_VALIDATOR_UNREACHABLE: &str = "Token validator unreachable";

pub(crate) async fn resolve(
    client: &SolvaPayClient,
    params: McpResolveAuthParams,
) -> Result<Value, SdkError> {
    let mode = params.auth_mode.unwrap_or(McpAuthMode::ToolsCall);
    let gated = requires_bearer_auth(params.rpc_method.as_deref(), mode);
    let token = extract_bearer_token(params.auth_header.as_deref()).map(str::to_owned);

    if token.is_none() {
        if gated {
            return Ok(challenge_value(&params));
        }
        return Ok(allow_value(None, None));
    }
    let token = token.ok_or_else(|| SdkError::transport("bearer token vanished", false))?;

    let now_ms = client.shell().now_ms();
    let now_unix_secs = i64::try_from(now_ms / 1000).unwrap_or(i64::MAX);
    let origin = params.public_base_url.trim_end_matches('/');
    let expected_issuer = origin.to_owned();
    let expected_audience = mcp_resource_identifier(origin, params.mcp_path.as_deref());

    if let Some(jti) = structural_jti(&token) {
        if let Some(hit) = client.auth_caches().get_verdict(&jti, now_ms)? {
            return Ok(allow_from_claims(&token, hit.claims, hit.customer_ref));
        }
    }

    let material = resolve_material(client, &params, origin, now_ms).await?;
    if let Some((jwks_json, hs256_secret)) = material {
        match mcp_verify_bearer(&VerifyBearerInput {
            token: token.clone(),
            jwks_json,
            hs256_secret,
            expected_issuer: expected_issuer.clone(),
            expected_audience: expected_audience.clone(),
            now_unix_secs,
            claim_priority: None,
        }) {
            VerifyBearerResult::Ok {
                claims,
                customer_ref,
            } => {
                cache_verdict(client, &claims, &customer_ref, now_ms)?;
                return Ok(allow_from_claims(&token, claims, customer_ref));
            }
            VerifyBearerResult::Unauthorized { .. } => {
                return Ok(challenge_value(&params));
            }
        }
    }

    match validate_remote(client, &params.auth_header, &token).await? {
        RemoteOutcome::Unreachable => Ok(validator_unreachable(&params)),
        RemoteOutcome::Invalid => Ok(challenge_value(&params)),
        RemoteOutcome::Valid { sub } => {
            let Some(claims) = decode_jwt_payload(&token) else {
                return Ok(challenge_value(&params));
            };
            if !remote_claims_ok(&claims, &expected_issuer, &expected_audience, now_unix_secs) {
                return Ok(challenge_value(&params));
            }
            let customer_ref = customer_ref_from_claims(&claims, None).unwrap_or(sub);
            cache_verdict(client, &claims, &customer_ref, now_ms)?;
            Ok(allow_from_claims(&token, claims, customer_ref))
        }
    }
}

async fn resolve_material(
    client: &SolvaPayClient,
    params: &McpResolveAuthParams,
    origin: &str,
    now_ms: u64,
) -> Result<Option<(Option<Value>, Option<String>)>, SdkError> {
    let secret = params
        .hs256_secret
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned);
    let explicit_jwks = params
        .jwks_json
        .as_ref()
        .filter(|value| value.get("keys").and_then(Value::as_array).is_some())
        .cloned();
    if secret.is_some() || explicit_jwks.is_some() {
        return Ok(Some((explicit_jwks, secret)));
    }

    let jwks_url = format!("{origin}/.well-known/jwks.json");
    if let Some(cached) = client.auth_caches().get_jwks(&jwks_url, now_ms)? {
        return Ok(Some((Some(cached), None)));
    }
    match client
        .fetch_jwks(FetchJwksParams {
            jwks_url: jwks_url.clone(),
        })
        .await
    {
        Ok(document) => {
            client
                .auth_caches()
                .put_jwks(jwks_url, document.clone(), now_ms)?;
            Ok(Some((Some(document), None)))
        }
        Err(_) => Ok(None),
    }
}

enum RemoteOutcome {
    Valid { sub: String },
    Invalid,
    Unreachable,
}

async fn validate_remote(
    client: &SolvaPayClient,
    auth_header: &Option<String>,
    _token: &str,
) -> Result<RemoteOutcome, SdkError> {
    let Some(auth) = auth_header.as_deref().filter(|value| !value.is_empty()) else {
        return Ok(RemoteOutcome::Invalid);
    };
    let mut headers = BTreeMap::new();
    headers.insert("authorization".to_owned(), auth.to_owned());
    let response = match proxy_customer_auth(client, Method::Get, USERINFO_PATH, &headers, "").await
    {
        Ok(response) => response,
        Err(_) => return Ok(RemoteOutcome::Unreachable),
    };
    match response.status {
        200 => {
            let body = std::str::from_utf8(&response.body).unwrap_or("");
            let value: Value = serde_json::from_str(body).unwrap_or(Value::Null);
            let sub = value
                .get("sub")
                .and_then(Value::as_str)
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(str::to_owned);
            match sub {
                Some(sub) => Ok(RemoteOutcome::Valid { sub }),
                None => Ok(RemoteOutcome::Invalid),
            }
        }
        400 | 401 | 403 => Ok(RemoteOutcome::Invalid),
        _ => Ok(RemoteOutcome::Unreachable),
    }
}

fn remote_claims_ok(
    claims: &Value,
    expected_issuer: &str,
    expected_audience: &str,
    now_unix_secs: i64,
) -> bool {
    let iss = claims.get("iss").and_then(Value::as_str);
    if iss != Some(expected_issuer) {
        return false;
    }
    let aud_ok = match claims.get("aud") {
        Some(Value::String(aud)) => aud == expected_audience,
        Some(Value::Array(items)) => items
            .iter()
            .any(|item| item.as_str() == Some(expected_audience)),
        _ => false,
    };
    if !aud_ok {
        return false;
    }
    let Some(exp) = claims.get("exp").and_then(claim_as_i64) else {
        return false;
    };
    if exp <= now_unix_secs {
        return false;
    }
    claims.get("token_use").and_then(Value::as_str) == Some(TOKEN_USE_MCP_ACCESS)
}

fn cache_verdict(
    client: &SolvaPayClient,
    claims: &Value,
    customer_ref: &str,
    now_ms: u64,
) -> Result<(), SdkError> {
    let Some(jti) = claims
        .get("jti")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return Ok(());
    };
    client.auth_caches().put_verdict(
        jti.to_owned(),
        customer_ref.to_owned(),
        claims.clone(),
        now_ms,
        claims.get("exp").and_then(claim_as_i64),
    )
}

fn allow_from_claims(token: &str, claims: Value, customer_ref: String) -> Value {
    allow_value(
        Some(auth_info(token, &claims, &customer_ref)),
        Some(customer_ref),
    )
}

fn allow_value(auth_info: Option<Value>, customer_ref: Option<String>) -> Value {
    json!({
        "kind": "allow",
        "authInfo": auth_info,
        "customerRef": customer_ref,
    })
}

fn challenge_value(params: &McpResolveAuthParams) -> Value {
    match mcp_auth_challenge(&AuthGateInput {
        rpc_method: params.rpc_method.clone(),
        auth_header: params.auth_header.clone(),
        auth_mode: params.auth_mode,
        public_base_url: params.public_base_url.clone(),
        mcp_path: params.mcp_path.clone(),
        json_rpc_id: params.json_rpc_id.clone(),
        jwks_json: None,
        hs256_secret: None,
        expected_issuer: None,
        expected_audience: None,
        now_unix_secs: None,
        pre_verified_customer_ref: None,
    }) {
        AuthGateResult::Challenge {
            status,
            headers,
            body,
        } => json!({ "kind": "challenge", "status": status, "headers": headers, "body": body }),
        AuthGateResult::Allow => json!({
            "kind": "error",
            "status": 200,
            "headers": { "Content-Type": "application/json" },
            "body": jsonrpc_internal(params.json_rpc_id.clone(), "auth challenge produced allow"),
        }),
    }
}

fn validator_unreachable(params: &McpResolveAuthParams) -> Value {
    json!({
        "kind": "error",
        "status": 200,
        "headers": { "Content-Type": "application/json" },
        "body": jsonrpc_internal(params.json_rpc_id.clone(), MSG_VALIDATOR_UNREACHABLE),
    })
}

fn jsonrpc_internal(id: Option<Value>, message: &str) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id.unwrap_or(Value::Null),
        "error": { "code": -32603, "message": message },
    })
}

fn auth_info(token: &str, claims: &Value, customer_ref: &str) -> Value {
    let client_id = claims
        .get("client_id")
        .and_then(Value::as_str)
        .or_else(|| claims.get("azp").and_then(Value::as_str))
        .filter(|value| !value.is_empty())
        .unwrap_or("solvapay-mcp-client");
    let scopes = scopes_from_claims(claims);
    let expires_at = claims.get("exp").and_then(claim_as_i64);
    let resource =
        claims
            .get("resource")
            .and_then(Value::as_str)
            .or_else(|| match claims.get("aud") {
                Some(Value::String(aud)) => Some(aud.as_str()),
                _ => None,
            });
    let mut extra = json!({ "customer_ref": customer_ref });
    if let Some(resource) = resource {
        extra["resource"] = json!(resource);
    }
    let mut info = json!({
        "token": token,
        "clientId": client_id,
        "scopes": scopes,
        "extra": extra,
    });
    if let Some(exp) = expires_at {
        info["expiresAt"] = json!(exp);
    }
    info
}

fn scopes_from_claims(claims: &Value) -> Vec<String> {
    if let Some(scp) = claims.get("scp").and_then(Value::as_array) {
        return scp
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_owned)
            .collect();
    }
    claims
        .get("scope")
        .and_then(Value::as_str)
        .map(|scope| {
            scope
                .split_whitespace()
                .filter(|part| !part.is_empty())
                .map(str::to_owned)
                .collect()
        })
        .unwrap_or_default()
}

fn structural_jti(token: &str) -> Option<String> {
    decode_jwt_payload(token)?
        .get("jti")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let mut parts = token.split('.');
    let _header = parts.next()?;
    let payload_b64 = parts.next()?;
    let _sig = parts.next()?;
    if parts.next().is_some() {
        return None;
    }
    let json = String::from_utf8(base64url_decode(payload_b64)?).ok()?;
    let value: Value = serde_json::from_str(&json).ok()?;
    value.is_object().then_some(value)
}

fn claim_as_i64(value: &Value) -> Option<i64> {
    match value {
        Value::Number(n) => n.as_i64().or_else(|| n.as_f64().map(|f| f as i64)),
        _ => None,
    }
}

fn base64url_decode(input: &str) -> Option<Vec<u8>> {
    let mut std = String::with_capacity(input.len() + 3);
    for ch in input.chars() {
        match ch {
            '-' => std.push('+'),
            '_' => std.push('/'),
            c if c.is_ascii_alphanumeric() || c == '+' || c == '/' => std.push(c),
            '=' => {}
            _ => return None,
        }
    }
    let pad = (4 - (std.len() % 4)) % 4;
    for _ in 0..pad {
        std.push('=');
    }
    fn val(c: u8) -> Option<u8> {
        match c {
            b'A'..=b'Z' => Some(c - b'A'),
            b'a'..=b'z' => Some(c - b'a' + 26),
            b'0'..=b'9' => Some(c - b'0' + 52),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let bytes = std.as_bytes();
    if !bytes.len().is_multiple_of(4) {
        return None;
    }
    let mut out = Vec::with_capacity(bytes.len() / 4 * 3);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i];
        let b1 = bytes[i + 1];
        let b2 = bytes[i + 2];
        let b3 = bytes[i + 3];
        let v0 = val(b0)?;
        let v1 = val(b1)?;
        out.push((v0 << 2) | (v1 >> 4));
        if b2 == b'=' {
            if b3 != b'=' {
                return None;
            }
            break;
        }
        let v2 = val(b2)?;
        out.push(((v1 & 0x0f) << 4) | (v2 >> 2));
        if b3 == b'=' {
            break;
        }
        let v3 = val(b3)?;
        out.push(((v2 & 0x03) << 6) | v3);
        i += 4;
    }
    Some(out)
}
