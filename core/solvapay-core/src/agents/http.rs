//! SolvaPay agent payments for an HTTP API.
//!
//! The gate reads the presented key: a SolvaPay agent token or key is verified
//! and the call authorized, and anything else is left to the merchant's own
//! auth. This file turns those outcomes into statuses, challenge headers and a
//! plain JSON refusal.

use serde_json::{json, Map, Value};

use super::oauth::challenge_headers;
use super::str_field;

/// Challenge sentence for a token or key that did not verify.
const SIGN_IN_AGAIN: &str = "The agent token was not accepted: sign in again";

/// The HTTP status for a refusal.
///
/// 402 for anything money or the owner can settle (link the account, top up,
/// approve), so a client shows the reason instead of retrying. 422 for a
/// policy deny, 401 for an agent SolvaPay did not accept, 502 when SolvaPay
/// could not be reached. `None` for a reason that is not a refusal reason.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 165
)]
#[must_use]
pub fn agent_refusal_status(reason: &str) -> Option<i64> {
    match reason {
        "agent_not_accepted" => Some(401),
        "unavailable" => Some(502),
        "deny" => Some(422),
        "customer_not_linked"
        | "topup_required"
        | "ask"
        | "approval_declined"
        | "approval_expired"
        | "approval_timed_out"
        | "approval_client_closed" => Some(402),
        _ => None,
    }
}

/// The challenge headers for `description`, when OAuth is on and the resource is usable.
fn challenge(input: &Value, description: &str) -> Option<Value> {
    let resource = input
        .get("protectedResource")
        .filter(|resource| resource.is_object())?;
    challenge_headers(resource, description).ok()
}

/// What an HTTP gate answers for an identification and, once begun, a call.
///
/// `input` carries `identity` (`{ kind: "not_agent" | "rejected" | "agent", … }`),
/// then `begun` (the call's `allow` or `refused` outcome) once the call was
/// started, and an optional `protectedResource` that turns the OAuth challenge on.
///
/// Returns one of:
/// - `{ kind: "not_agent" }`: the merchant's own auth decides.
/// - `{ kind: "rejected", status, reason, detail, challenge?, log }`: 401, or 403 for the other environment.
/// - `{ kind: "begin", agent }`: verified; start the call.
/// - `{ kind: "refused", status, refused, agent, challenge?, body }`: `body` is a plain JSON refusal.
/// - `{ kind: "allowed", allowed, agent }`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 166
)]
#[must_use]
pub fn agent_gate_result(input: &Value) -> Value {
    let identity = input.get("identity").unwrap_or(&Value::Null);
    let agent = identity.get("agent").cloned().unwrap_or(Value::Null);
    match identity.get("kind").and_then(Value::as_str) {
        Some("rejected") => {
            let reason = str_field(identity, "reason").unwrap_or("invalid");
            let detail = identity.get("detail").cloned().unwrap_or(Value::Null);
            let status = if reason == "environment_mismatch" {
                403
            } else {
                401
            };
            let mut out = Map::new();
            out.insert("kind".to_owned(), json!("rejected"));
            out.insert("status".to_owned(), json!(status));
            out.insert("reason".to_owned(), json!(reason));
            out.insert("detail".to_owned(), detail.clone());
            if status == 401 {
                if let Some(headers) = challenge(input, SIGN_IN_AGAIN) {
                    out.insert("challenge".to_owned(), headers);
                }
            }
            out.insert(
                "log".to_owned(),
                json!({ "reason": format!("agent_token_{reason}"), "detail": detail }),
            );
            Value::Object(out)
        }
        Some("agent") => {
            let Some(begun) = input.get("begun").filter(|begun| begun.is_object()) else {
                return json!({ "kind": "begin", "agent": agent });
            };
            if begun.get("kind").and_then(Value::as_str) != Some("refused") {
                return json!({ "kind": "allowed", "allowed": begun, "agent": agent });
            }
            let reason = str_field(begun, "reason").unwrap_or_default();
            let message = str_field(begun, "message").unwrap_or_default();
            // A reason outside the frozen list is SolvaPay out of step: never let it through.
            let status = agent_refusal_status(reason).unwrap_or(502);
            let mut out = Map::new();
            out.insert("kind".to_owned(), json!("refused"));
            out.insert("status".to_owned(), json!(status));
            out.insert(
                "refused".to_owned(),
                json!({ "kind": "refused", "reason": reason, "message": message }),
            );
            out.insert("agent".to_owned(), agent);
            if status == 401 {
                if let Some(headers) = challenge(input, message) {
                    out.insert("challenge".to_owned(), headers);
                }
            }
            out.insert(
                "body".to_owned(),
                json!({ "error": { "type": reason, "message": message } }),
            );
            Value::Object(out)
        }
        _ => json!({ "kind": "not_agent" }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn resource() -> Value {
        json!({ "resource": "https://api.example.com/v1", "authorizationServer": "https://issuer" })
    }

    #[test]
    fn refusal_statuses_match_the_table() {
        assert_eq!(agent_refusal_status("agent_not_accepted"), Some(401));
        assert_eq!(agent_refusal_status("unavailable"), Some(502));
        assert_eq!(agent_refusal_status("deny"), Some(422));
        for reason in [
            "customer_not_linked",
            "topup_required",
            "ask",
            "approval_declined",
            "approval_expired",
            "approval_timed_out",
            "approval_client_closed",
        ] {
            assert_eq!(agent_refusal_status(reason), Some(402), "{reason}");
        }
        assert_eq!(agent_refusal_status("other"), None);
    }

    #[test]
    fn not_agent_is_left_to_the_merchant() {
        assert_eq!(
            agent_gate_result(&json!({ "identity": { "kind": "not_agent" } })),
            json!({ "kind": "not_agent" })
        );
    }

    #[test]
    fn rejected_is_401_with_a_challenge_when_oauth_is_on() {
        let gate = agent_gate_result(&json!({
            "identity": { "kind": "rejected", "reason": "expired", "detail": "exp" },
            "protectedResource": resource(),
        }));
        assert_eq!(gate["status"], 401);
        assert_eq!(gate["log"]["reason"], "agent_token_expired");
        assert!(gate["challenge"]["WWW-Authenticate"]
            .as_str()
            .unwrap_or_default()
            .contains("The agent token was not accepted: sign in again"));
        let plain = agent_gate_result(&json!({
            "identity": { "kind": "rejected", "reason": "invalid", "detail": "sig" },
        }));
        assert!(plain.get("challenge").is_none());
    }

    #[test]
    fn other_environment_is_403_without_a_challenge() {
        let gate = agent_gate_result(&json!({
            "identity": { "kind": "rejected", "reason": "environment_mismatch", "detail": "d" },
            "protectedResource": resource(),
        }));
        assert_eq!(gate["status"], 403);
        assert!(gate.get("challenge").is_none());
    }

    #[test]
    fn verified_agent_begins_then_is_allowed_or_refused() {
        let identity = json!({ "kind": "agent", "agent": { "agentRef": "agt_1" } });
        assert_eq!(
            agent_gate_result(&json!({ "identity": identity })),
            json!({ "kind": "begin", "agent": { "agentRef": "agt_1" } })
        );
        let allowed = agent_gate_result(&json!({
            "identity": identity,
            "begun": { "kind": "allow", "callRef": "call_1" },
        }));
        assert_eq!(allowed["kind"], "allowed");
        assert_eq!(allowed["allowed"]["callRef"], "call_1");
        let refused = agent_gate_result(&json!({
            "identity": identity,
            "begun": { "kind": "refused", "reason": "topup_required", "message": "Top up." },
        }));
        assert_eq!(refused["status"], 402);
        assert_eq!(
            refused["body"],
            json!({ "error": { "type": "topup_required", "message": "Top up." } })
        );
        assert!(refused.get("challenge").is_none());
    }

    #[test]
    fn agent_not_accepted_challenges_with_its_own_sentence() {
        let refused = agent_gate_result(&json!({
            "identity": { "kind": "agent", "agent": {} },
            "begun": { "kind": "refused", "reason": "agent_not_accepted", "message": "Revoked." },
            "protectedResource": resource(),
        }));
        assert_eq!(refused["status"], 401);
        assert!(refused["challenge"]["WWW-Authenticate"]
            .as_str()
            .unwrap_or_default()
            .contains("error_description=\"Revoked.\""));
    }
}
