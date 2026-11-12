//! ES256 (ECDSA P-256 / SHA-256) JWS verification against a JWKS document.
//!
//! One implementation for every caller that verifies SolvaPay-signed tokens:
//! MCP bearer verification (`solvapay-mcp-core`) and agent tokens
//! ([`crate::agents::verify_agent_token`]). Signature only: claim checks
//! (`exp`, `iss`, `aud`, …) belong to the caller, whose rules differ.

use serde_json::Value;

use crate::jwt_util::{base64url_decode, base64url_decode_to_string};

/// Why a compact JWS was not accepted.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Es256Error {
    /// Not three base64url segments, or a segment that is not valid JSON.
    Malformed,
    /// The header's `alg` is not `ES256`.
    WrongAlgorithm,
    /// No P-256 key in the JWKS (matching `kid`, when the header names one) verifies the signature.
    BadSignature,
}

impl Es256Error {
    /// Short reason for logs and rejection details.
    #[must_use]
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Malformed => "token is not a well-formed JWS",
            Self::WrongAlgorithm => "token is not signed with ES256",
            Self::BadSignature => "signature does not verify against the published keys",
        }
    }
}

/// Verify an ES256 signature over `signing_input` with a P-256 key from `jwks`.
///
/// Tries every `kty: EC`, `crv: P-256` key, narrowed to `kid` when given.
/// The signature is the JWS raw `r || s` form (64 bytes).
#[must_use]
pub fn verify_es256_signature(
    jwks: &Value,
    kid: Option<&str>,
    signing_input: &[u8],
    sig: &[u8],
) -> bool {
    use p256::ecdsa::signature::Verifier;
    use p256::ecdsa::{Signature, VerifyingKey};
    use p256::{EncodedPoint, FieldBytes};

    if sig.len() != 64 {
        return false;
    }
    let Ok(signature) = Signature::from_slice(sig) else {
        return false;
    };
    let Some(keys) = jwks.get("keys").and_then(Value::as_array) else {
        return false;
    };
    for key in keys {
        if key.get("kty").and_then(Value::as_str) != Some("EC")
            || key.get("crv").and_then(Value::as_str) != Some("P-256")
        {
            continue;
        }
        if let Some(kid) = kid {
            if key.get("kid").and_then(Value::as_str) != Some(kid) {
                continue;
            }
        }
        let coordinate = |name: &str| -> Option<[u8; 32]> {
            let bytes = base64url_decode(key.get(name).and_then(Value::as_str)?)?;
            bytes.try_into().ok()
        };
        let (Some(x), Some(y)) = (coordinate("x"), coordinate("y")) else {
            continue;
        };
        let point = EncodedPoint::from_affine_coordinates(
            &FieldBytes::from(x),
            &FieldBytes::from(y),
            false,
        );
        let Ok(verifying_key) = VerifyingKey::from_encoded_point(&point) else {
            continue;
        };
        if verifying_key.verify(signing_input, &signature).is_ok() {
            return true;
        }
    }
    false
}

/// Verify a compact ES256 JWS and return its payload object.
///
/// Checks the structure, that `alg` is `ES256`, and the signature. Does not
/// check any claim.
///
/// # Errors
///
/// [`Es256Error`] naming the first check that failed.
pub fn verify_es256_jwt(token: &str, jwks: &Value) -> Result<Value, Es256Error> {
    let mut parts = token.split('.');
    let (Some(header_b64), Some(payload_b64), Some(sig_b64), None) =
        (parts.next(), parts.next(), parts.next(), parts.next())
    else {
        return Err(Es256Error::Malformed);
    };
    let header: Value = base64url_decode_to_string(header_b64)
        .and_then(|json| serde_json::from_str(&json).ok())
        .ok_or(Es256Error::Malformed)?;
    if header.get("alg").and_then(Value::as_str) != Some("ES256") {
        return Err(Es256Error::WrongAlgorithm);
    }
    let sig = base64url_decode(sig_b64).ok_or(Es256Error::Malformed)?;
    let signing_input = format!("{header_b64}.{payload_b64}");
    if !verify_es256_signature(
        jwks,
        header.get("kid").and_then(Value::as_str),
        signing_input.as_bytes(),
        &sig,
    ) {
        return Err(Es256Error::BadSignature);
    }
    let payload: Value = base64url_decode_to_string(payload_b64)
        .and_then(|json| serde_json::from_str(&json).ok())
        .ok_or(Es256Error::Malformed)?;
    if !payload.is_object() {
        return Err(Es256Error::Malformed);
    }
    Ok(payload)
}
