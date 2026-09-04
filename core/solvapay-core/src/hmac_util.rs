//! Shared HMAC-SHA256 helpers (webhook + auth JWT verification).

use hmac::{Hmac, KeyInit, Mac};
use sha2::Sha256;
use subtle::ConstantTimeEq;

/// HMAC-SHA256 MAC type alias.
type HmacSha256 = Hmac<Sha256>;

/// Computes raw HMAC-SHA256 digest bytes over `message` with `key`.
///
/// # Arguments
///
/// * `key` - HMAC key bytes (any length accepted by HMAC-SHA256).
/// * `message` - Message to authenticate.
///
/// # Returns
///
/// 32-byte digest, or [`None`] if key init fails (should not happen for HMAC-SHA256).
pub fn hmac_sha256(key: &[u8], message: &[u8]) -> Option<[u8; 32]> {
    let mut mac = HmacSha256::new_from_slice(key).ok()?;
    mac.update(message);
    let bytes = mac.finalize().into_bytes();
    let mut out = [0u8; 32];
    out.copy_from_slice(&bytes);
    Some(out)
}

/// Encodes bytes as lowercase hexadecimal (no `hex` crate).
///
/// # Arguments
///
/// * `bytes` - Digest or other binary input.
///
/// # Returns
///
/// Lowercase hex string with two characters per input byte.
pub fn bytes_to_hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len().saturating_mul(2));
    for &byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

/// Constant-time equality of two byte slices after a length check.
///
/// # Arguments
///
/// * `expected` - Locally computed bytes.
/// * `received` - Candidate bytes.
///
/// # Returns
///
/// `true` when lengths match and bytes are equal under [`ConstantTimeEq`].
pub fn constant_time_eq(expected: &[u8], received: &[u8]) -> bool {
    if expected.len() != received.len() {
        return false;
    }
    bool::from(expected.ct_eq(received))
}

/// Constant-time equality of two hex strings after a length check.
///
/// # Arguments
///
/// * `expected` - Lowercase hex digest computed locally.
/// * `received` - Hex string from the wire.
///
/// # Returns
///
/// `true` when lengths match and UTF-8 bytes are equal under [`ConstantTimeEq`].
pub fn constant_time_hex_eq(expected: &str, received: &str) -> bool {
    constant_time_eq(expected.as_bytes(), received.as_bytes())
}
