//! What SolvaPay's classifier gets from a call's prompt.
//!
//! A hash of the text, whether it carries a failed tool result, and its end,
//! which goes only once the owner opted in. Each merchant picks the text from
//! its own protocol, so repeats of the same text show loops.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};

use super::PROMPT_EXCERPT_MAX;

/// Lowercase hex of `bytes`.
fn hex(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

/// The last [`PROMPT_EXCERPT_MAX`] UTF-16 units of `text`.
///
/// Counted in UTF-16 units to match the TypeScript SDK. A cut that would
/// split a surrogate pair drops the orphaned half.
fn excerpt(text: &str) -> String {
    let units: Vec<u16> = text.encode_utf16().collect();
    if units.len() <= PROMPT_EXCERPT_MAX {
        return text.to_owned();
    }
    let mut tail = &units[units.len() - PROMPT_EXCERPT_MAX..];
    if let Some(first) = tail.first() {
        if (0xDC00..=0xDFFF).contains(first) {
            tail = &tail[1..];
        }
    }
    String::from_utf16_lossy(tail)
}

/// The facts about a prompt that go to SolvaPay with an authorize.
///
/// Returns `{ promptHash, toolError, excerpt }`: `sha256:` over the text, the
/// tool-error flag as given, and the text's last 1,500 characters.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 161
)]
#[must_use]
pub fn agent_prompt_facts(text: &str, tool_error: bool) -> Value {
    let digest = Sha256::digest(text.as_bytes());
    json!({
        "promptHash": format!("sha256:{}", hex(&digest)),
        "toolError": tool_error,
        "excerpt": excerpt(text),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hashes_the_text_and_keeps_a_short_prompt_whole() {
        let facts = agent_prompt_facts("hello", false);
        assert_eq!(
            facts["promptHash"],
            "sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"
        );
        assert_eq!(facts["toolError"], false);
        assert_eq!(facts["excerpt"], "hello");
    }

    #[test]
    fn excerpt_is_the_last_1500_characters() {
        let text = format!("{}{}", "a".repeat(100), "b".repeat(1500));
        let facts = agent_prompt_facts(&text, true);
        assert_eq!(facts["excerpt"], "b".repeat(1500));
        assert_eq!(facts["toolError"], true);
    }

    #[test]
    fn excerpt_never_starts_on_half_a_surrogate_pair() {
        // 1,499 ASCII units after an astral character: the cut lands inside the pair.
        let text = format!("xx\u{1F600}{}", "c".repeat(1499));
        assert_eq!(
            agent_prompt_facts(&text, false)["excerpt"],
            "c".repeat(1499)
        );
    }
}
