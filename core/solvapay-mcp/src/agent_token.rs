//! SolvaPay agent token verification (`verify_agent_token`).
//!
//! Agent tokens are ES256 JWTs signed by SolvaPay's agent service and issued
//! for one merchant: `aud` is its provider reference, or this server's OAuth
//! resource for a token a host got by OAuth. Pure: token, JWKS, expectations
//! and clock in, verdict out. The asymmetric crypto is feature-gated
//! (`jwt-verify`), as for MCP bearer verification.

use serde_json::Value;
#[cfg(feature = "jwt-verify")]
use solvapay_core::agents::agent_from_claims;

/// Input for [`verify_agent_token`].
#[derive(Debug, Clone, Copy)]
pub struct AgentTokenInput<'a> {
    /// Compact JWT as presented.
    pub token: &'a str,
    /// The issuer's JWKS document (`{"keys":[...]}`).
    pub jwks: &'a Value,
    /// SolvaPay's agent token issuer, e.g. `https://api.solvapay.com/v1/agent`.
    pub issuer: &'a str,
    /// This merchant's provider reference. Tokens for any other provider are refused.
    pub provider_ref: &'a str,
    /// This server's canonical OAuth resource, accepted as `aud` beside the provider reference.
    pub resource: Option<&'a str>,
    /// Explicit clock for the time claims (no wall clock in core).
    pub now_unix_secs: i64,
    /// The environment this merchant's secret key is for. An agent from the other is refused.
    pub merchant_environment: Option<&'a str>,
}

/// `{ ok: false, reason, detail }`.
fn rejected(reason: &str, detail: &str) -> Value {
    serde_json::json!({ "ok": false, "reason": reason, "detail": detail })
}

/// Verify an agent token and read the agent it names.
///
/// Returns `{ ok: true, agent }`, or `{ ok: false, reason, detail }` with
/// `reason` `expired`, `invalid` or `environment_mismatch`.
#[must_use]
pub fn verify_agent_token(input: &AgentTokenInput<'_>) -> Value {
    #[cfg(not(feature = "jwt-verify"))]
    {
        let _ = input;
        rejected("invalid", "JWT verification requires the server profile")
    }
    #[cfg(feature = "jwt-verify")]
    {
        match verified_claims(input) {
            Ok(claims) => agent_from_claims(&claims, input.merchant_environment),
            Err((reason, detail)) => rejected(reason, detail),
        }
    }
}

/// Signature, issuer, audience and time claims, in the order a JWT library checks them.
#[cfg(feature = "jwt-verify")]
fn verified_claims(input: &AgentTokenInput<'_>) -> Result<Value, (&'static str, &'static str)> {
    use crate::bearer_verify::{
        base64url_decode, base64url_decode_to_string, claim_as_i64, verify_es256,
    };
    use solvapay_core::agents::AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS as TOLERANCE;

    /// Shorthand for an `invalid` rejection.
    fn invalid(detail: &'static str) -> (&'static str, &'static str) {
        ("invalid", detail)
    }

    let mut parts = input.token.split('.');
    let (Some(header_b64), Some(payload_b64), Some(sig_b64), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(invalid("Invalid Compact JWS"));
    };
    let header: Value = base64url_decode_to_string(header_b64)
        .and_then(|json| serde_json::from_str(&json).ok())
        .ok_or_else(|| invalid("Invalid Compact JWS"))?;
    if header.get("alg").and_then(Value::as_str) != Some("ES256") {
        return Err(invalid(
            "\"alg\" (Algorithm) Header Parameter value not allowed",
        ));
    }
    let signature = base64url_decode(sig_b64).ok_or_else(|| invalid("Invalid Compact JWS"))?;
    let signing_input = format!("{header_b64}.{payload_b64}");
    verify_es256(
        input.jwks,
        header.get("kid").and_then(Value::as_str),
        signing_input.as_bytes(),
        &signature,
    )
    .ok_or_else(|| invalid("signature verification failed"))?;

    let claims: Value = base64url_decode_to_string(payload_b64)
        .and_then(|json| serde_json::from_str(&json).ok())
        .filter(Value::is_object)
        .ok_or_else(|| invalid("JWT Claims Set must be a top-level JSON object"))?;

    for (claim, detail) in [
        ("sub", "missing required \"sub\" claim"),
        ("exp", "missing required \"exp\" claim"),
        ("iat", "missing required \"iat\" claim"),
        ("jti", "missing required \"jti\" claim"),
        ("iss", "missing required \"iss\" claim"),
        ("aud", "missing required \"aud\" claim"),
    ] {
        if claims.get(claim).is_none() {
            return Err(invalid(detail));
        }
    }
    if claims.get("iss").and_then(Value::as_str) != Some(input.issuer) {
        return Err(invalid("unexpected \"iss\" claim value"));
    }
    let accepted = |audience: &str| {
        audience == input.provider_ref
            || input.resource.is_some_and(|resource| audience == resource)
    };
    let audience_ok = match claims.get("aud") {
        Some(Value::String(audience)) => accepted(audience),
        Some(Value::Array(items)) => items.iter().filter_map(Value::as_str).any(accepted),
        _ => false,
    };
    if !audience_ok {
        return Err(invalid("unexpected \"aud\" claim value"));
    }
    if !claims.get("iat").is_some_and(Value::is_number) {
        return Err(invalid("\"iat\" claim must be a number"));
    }
    if let Some(nbf) = claims.get("nbf") {
        let nbf = claim_as_i64(nbf).ok_or_else(|| invalid("\"nbf\" claim must be a number"))?;
        if nbf > input.now_unix_secs.saturating_add(TOLERANCE) {
            return Err(invalid("\"nbf\" claim timestamp check failed"));
        }
    }
    let exp = claims
        .get("exp")
        .and_then(claim_as_i64)
        .ok_or_else(|| invalid("\"exp\" claim must be a number"))?;
    if exp <= input.now_unix_secs.saturating_sub(TOLERANCE) {
        return Err(("expired", "\"exp\" claim timestamp check failed"));
    }
    Ok(claims)
}

#[cfg(all(test, feature = "jwt-verify"))]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests {
    use super::*;
    use p256::ecdsa::signature::Signer;
    use p256::ecdsa::{Signature, SigningKey};
    use serde_json::json;

    const ISSUER: &str = "https://api.solvapay.test/v1/agent";
    const PROVIDER: &str = "prov_W3TLPNOA";
    const NOW: i64 = 1_700_000_000;

    fn base64url(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
        let mut out = String::new();
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0];
            let b1 = chunk.get(1).copied().unwrap_or(0);
            let b2 = chunk.get(2).copied().unwrap_or(0);
            out.push(TABLE[usize::from(b0 >> 2)] as char);
            out.push(TABLE[usize::from((b0 & 0x03) << 4 | b1 >> 4)] as char);
            if chunk.len() > 1 {
                out.push(TABLE[usize::from((b1 & 0x0f) << 2 | b2 >> 6)] as char);
            }
            if chunk.len() > 2 {
                out.push(TABLE[usize::from(b2 & 0x3f)] as char);
            }
        }
        out
    }

    fn key(seed: u8) -> SigningKey {
        SigningKey::from_slice(&[seed; 32]).unwrap()
    }

    fn jwks(signer: &SigningKey) -> Value {
        let point = signer.verifying_key().to_encoded_point(false);
        json!({ "keys": [{
            "kty": "EC", "crv": "P-256", "kid": "k1", "alg": "ES256", "use": "sig",
            "x": base64url(point.x().unwrap()),
            "y": base64url(point.y().unwrap()),
        }] })
    }

    fn sign(signer: &SigningKey, alg: &str, claims: &Value) -> String {
        let header = base64url(json!({ "alg": alg, "kid": "k1" }).to_string().as_bytes());
        let payload = base64url(claims.to_string().as_bytes());
        let signature: Signature = signer.sign(format!("{header}.{payload}").as_bytes());
        format!("{header}.{payload}.{}", base64url(&signature.to_bytes()))
    }

    fn claims() -> Value {
        json!({
            "iss": ISSUER, "aud": PROVIDER, "sub": "agt_TESTAGNT",
            "principal": "ppl_ABCDEFGHIJKLMNOP", "scope": "usage", "env": "sandbox",
            "jti": "tok_1", "iat": NOW, "exp": NOW + 900,
        })
    }

    fn verify(token: &str, keys: &Value, resource: Option<&str>, env: Option<&str>) -> Value {
        verify_agent_token(&AgentTokenInput {
            token,
            jwks: keys,
            issuer: ISSUER,
            provider_ref: PROVIDER,
            resource,
            now_unix_secs: NOW,
            merchant_environment: env,
        })
    }

    #[test]
    fn valid_token_names_its_agent() {
        let signer = key(7);
        let result = verify(
            &sign(&signer, "ES256", &claims()),
            &jwks(&signer),
            None,
            Some("sandbox"),
        );
        assert_eq!(result["ok"], true, "{result}");
        assert_eq!(result["agent"]["agentRef"], "agt_TESTAGNT");
        assert_eq!(result["agent"]["tokenId"], "tok_1");
        assert_eq!(result["agent"]["promptExcerpt"], false);
    }

    #[test]
    fn another_key_or_a_tampered_payload_is_invalid() {
        let signer = key(7);
        let token = sign(&signer, "ES256", &claims());
        assert_eq!(
            verify(&token, &jwks(&key(9)), None, None)["reason"],
            "invalid"
        );
        let mut parts: Vec<String> = token.split('.').map(str::to_owned).collect();
        let mut forged = claims();
        forged["sub"] = json!("agt_OTHER");
        parts[1] = base64url(forged.to_string().as_bytes());
        assert_eq!(
            verify(&parts.join("."), &jwks(&signer), None, None)["detail"],
            "signature verification failed"
        );
    }

    #[test]
    fn only_es256_is_accepted() {
        let signer = key(7);
        let result = verify(
            &sign(&signer, "HS256", &claims()),
            &jwks(&signer),
            None,
            None,
        );
        assert_eq!(result["reason"], "invalid");
    }

    #[test]
    fn issuer_and_audience_must_match() {
        let signer = key(7);
        let mut other_issuer = claims();
        other_issuer["iss"] = json!("https://elsewhere");
        assert_eq!(
            verify(
                &sign(&signer, "ES256", &other_issuer),
                &jwks(&signer),
                None,
                None
            )["detail"],
            "unexpected \"iss\" claim value"
        );
        let mut other_provider = claims();
        other_provider["aud"] = json!("prov_OTHER");
        assert_eq!(
            verify(
                &sign(&signer, "ES256", &other_provider),
                &jwks(&signer),
                None,
                None
            )["detail"],
            "unexpected \"aud\" claim value"
        );
    }

    #[test]
    fn oauth_resource_is_an_accepted_audience_only_when_configured() {
        let signer = key(7);
        let mut oauth = claims();
        oauth["aud"] = json!("https://mcp.example.com/mcp");
        oauth["cid"] = json!("oac_1");
        let token = sign(&signer, "ES256", &oauth);
        let accepted = verify(
            &token,
            &jwks(&signer),
            Some("https://mcp.example.com/mcp"),
            None,
        );
        assert_eq!(accepted["agent"]["clientId"], "oac_1", "{accepted}");
        assert_eq!(
            verify(&token, &jwks(&signer), None, None)["reason"],
            "invalid"
        );
        assert_eq!(
            verify(
                &token,
                &jwks(&signer),
                Some("https://other.example.com/mcp"),
                None
            )["reason"],
            "invalid"
        );
    }

    #[test]
    fn expiry_has_thirty_seconds_of_tolerance() {
        let signer = key(7);
        let mut just_expired = claims();
        just_expired["exp"] = json!(NOW - 29);
        assert_eq!(
            verify(
                &sign(&signer, "ES256", &just_expired),
                &jwks(&signer),
                None,
                None
            )["ok"],
            true
        );
        let mut expired = claims();
        expired["exp"] = json!(NOW - 30);
        assert_eq!(
            verify(
                &sign(&signer, "ES256", &expired),
                &jwks(&signer),
                None,
                None
            )["reason"],
            "expired"
        );
    }

    #[test]
    fn required_claims_must_be_present() {
        let signer = key(7);
        for claim in ["sub", "exp", "iat", "jti"] {
            let mut missing = claims();
            missing.as_object_mut().unwrap().remove(claim);
            let result = verify(
                &sign(&signer, "ES256", &missing),
                &jwks(&signer),
                None,
                None,
            );
            assert_eq!(result["reason"], "invalid", "{claim}");
        }
    }

    #[test]
    fn other_environment_is_refused() {
        let signer = key(7);
        let result = verify(
            &sign(&signer, "ES256", &claims()),
            &jwks(&signer),
            None,
            Some("live"),
        );
        assert_eq!(result["reason"], "environment_mismatch");
    }

    #[test]
    fn malformed_tokens_are_invalid() {
        let signer = key(7);
        assert_eq!(
            verify("not-a-jwt", &jwks(&signer), None, None)["reason"],
            "invalid"
        );
        assert_eq!(
            verify("a.b.c.d", &jwks(&signer), None, None)["reason"],
            "invalid"
        );
    }
}
