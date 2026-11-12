//! SolvaPay agent payments for merchants: the pure half.
//!
//! A merchant verifies who is calling (an agent token or an agent key), asks
//! SolvaPay to authorize each paid call, completes it at the cost its upstream
//! reported, and reports usage for reconciliation. The spend policy, the
//! approval hold, the balance and the settle rules all run in SolvaPay.
//!
//! Everything here is a function of its inputs: no HTTP, no clock, no key
//! material. The HTTP calls and the token signature check live in
//! `solvapay-transport` and `solvapay-mcp-core`, and each language surface
//! reaches both through the generated bindings.

mod calls;
mod http;
mod identity;
mod mcp;
mod oauth;
mod parse;
mod prompt;

use serde_json::{json, Value};

pub use calls::{agent_amount_string, agent_call_step, agent_complete_body};
pub use http::{agent_gate_result, agent_refusal_status};
pub use identity::{
    agent_credential_kind, agent_from_claims, agent_key_result, agent_secret_key_environment,
    is_agent_key, looks_like_jwt,
};
pub use mcp::{agent_mcp_route_step, agent_refusal_tool_result};
pub use oauth::{agent_canonical_resource, agent_challenge_headers, agent_protected_resource};
pub use parse::{parse_agent_response, parse_agent_response_typed};
pub use prompt::agent_prompt_facts;

/// Why SolvaPay refused a call. The sentence for the human comes with it.
pub const SERVER_REFUSAL_REASONS: &[&str] = &[
    "customer_not_linked",
    "ask",
    "deny",
    "topup_required",
    "approval_declined",
    "approval_expired",
];

/// How SolvaPay reconciled one call of a usage report.
pub const RECONCILIATION_RESULTS: &[&str] = &[
    "matched",
    "adjusted",
    "pending",
    "already_reconciled",
    "ignored",
];

/// Why a reconciled call was not a plain match.
pub const RECONCILIATION_REASONS: &[&str] = &["provisional", "expired", "no_debit", "cost_differs"];

/// Where an agent spends: sandbox agents at sandbox merchants, live at live.
pub const AGENT_ENVIRONMENTS: &[&str] = &["sandbox", "live"];

/// Where a completed call's amount came from.
pub const COMPLETE_SOURCES: &[&str] = &["reported", "provisional", "none"];

/// Prefix of an agent key: long-lived, for one merchant, sent in place of an agent token.
pub const AGENT_KEY_PREFIX: &str = "agk_";

/// The longest one authorize request may hold. A longer wait is a series of requests.
pub const AUTHORIZE_WAIT_MAX_SECONDS: i64 = 55;

/// Base timeout of one agent API request, before any held wait is added.
pub const AGENT_REQUEST_TIMEOUT_MS: i64 = 10_000;

/// How long an agent key's answer is reused. A revoked key stops within this.
pub const AGENT_KEY_CACHE_MS: u64 = 30_000;

/// Clock tolerance for agent token time claims.
pub const AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS: i64 = 30;

/// The most of a prompt SolvaPay accepts, and only when the owner opted in.
pub const PROMPT_EXCERPT_MAX: usize = 1500;

/// The one scope an agent token carries.
pub const AGENT_SCOPE: &str = "usage";

/// Agent token claim: the classifier may read the end of the prompt.
pub const AGENT_TOKEN_EXCERPT_CLAIM: &str = "px";

/// Agent token claim: the OAuth client a host got the token as.
pub const AGENT_TOKEN_CLIENT_CLAIM: &str = "cid";

/// Agent token claim: where the agent spends.
pub const AGENT_TOKEN_ENV_CLAIM: &str = "env";

/// The frozen agent constants, for surfaces that cannot import Rust consts.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 150
)]
#[must_use]
pub fn agent_constants() -> Value {
    json!({
        "serverRefusalReasons": SERVER_REFUSAL_REASONS,
        "reconciliationResults": RECONCILIATION_RESULTS,
        "reconciliationReasons": RECONCILIATION_REASONS,
        "environments": AGENT_ENVIRONMENTS,
        "agentKeyPrefix": AGENT_KEY_PREFIX,
        "authorizeWaitMaxSeconds": AUTHORIZE_WAIT_MAX_SECONDS,
        "requestTimeoutMs": AGENT_REQUEST_TIMEOUT_MS,
        "agentKeyCacheMs": AGENT_KEY_CACHE_MS,
        "clockToleranceSeconds": AGENT_TOKEN_CLOCK_TOLERANCE_SECONDS,
        "promptExcerptMax": PROMPT_EXCERPT_MAX,
        "scope": AGENT_SCOPE,
        "excerptClaim": AGENT_TOKEN_EXCERPT_CLAIM,
        "clientClaim": AGENT_TOKEN_CLIENT_CLAIM,
        "envClaim": AGENT_TOKEN_ENV_CLAIM,
    })
}

/// A non-empty string field of `value`.
pub(crate) fn str_field<'a>(value: &'a Value, key: &str) -> Option<&'a str> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|text| !text.is_empty())
}

/// `{ ok: false, error }`, the in-band failure of a helper that throws on dev.
pub(crate) fn failure(message: impl Into<String>) -> Value {
    json!({ "ok": false, "error": message.into() })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_carry_the_frozen_lists() {
        let constants = agent_constants();
        assert_eq!(constants["agentKeyPrefix"], "agk_");
        assert_eq!(constants["authorizeWaitMaxSeconds"], 55);
        assert_eq!(constants["serverRefusalReasons"][0], "customer_not_linked");
        assert_eq!(constants["environments"], json!(["sandbox", "live"]));
    }
}
