//! Who is calling.
//!
//! Agent tokens are ES256 JWTs signed by SolvaPay's agent service, issued for
//! one merchant. Agent keys (`agk_…`) are long-lived and opaque: SolvaPay says
//! whose they are. Anything else a caller presents is the merchant's own auth.
//!
//! The signature check and the key lookup are I/O and live outside this crate.
//! What a verified payload or a key answer means is decided here.

use serde_json::{json, Map, Value};

use super::{
    str_field, AGENT_ENVIRONMENTS, AGENT_KEY_PREFIX, AGENT_TOKEN_CLIENT_CLAIM,
    AGENT_TOKEN_ENV_CLAIM, AGENT_TOKEN_EXCERPT_CLAIM,
};

/// The environment a merchant secret key is for, when its prefix says.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 152
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

/// Whether `value` is an agent key: the prefix and something after it.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 153
)]
#[must_use]
pub fn is_agent_key(value: &str) -> bool {
    value.starts_with(AGENT_KEY_PREFIX) && value.len() > AGENT_KEY_PREFIX.len()
}

/// Whether `value` is a JWS compact token, as opposed to a merchant API key.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 154
)]
#[must_use]
pub fn looks_like_jwt(value: &str) -> bool {
    let mut parts = 0_u8;
    for part in value.split('.') {
        parts = parts.saturating_add(1);
        let base64url = !part.is_empty()
            && part
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || byte == b'-' || byte == b'_');
        if !base64url {
            return false;
        }
    }
    parts == 3
}

/// How a presented key is checked: `agent_key`, `agent_token` or `not_agent`.
///
/// Without `accept_agent_keys` an agent key is the merchant's own auth's to answer.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 155
)]
#[must_use]
pub fn agent_credential_kind(presented_key: &str, accept_agent_keys: bool) -> String {
    if accept_agent_keys && is_agent_key(presented_key) {
        "agent_key".to_owned()
    } else if looks_like_jwt(presented_key) {
        "agent_token".to_owned()
    } else {
        "not_agent".to_owned()
    }
}

/// `{ ok: false, reason, detail }`.
pub(crate) fn rejected(reason: &str, detail: impl Into<String>) -> Value {
    json!({ "ok": false, "reason": reason, "detail": detail.into() })
}

/// Refuses an agent from the other environment. With the merchant's unknown, SolvaPay does.
fn check_environment(agent: Map<String, Value>, merchant_environment: Option<&str>) -> Value {
    let spends_in = agent
        .get("environment")
        .and_then(Value::as_str)
        .unwrap_or_default();
    if let Some(merchant) = merchant_environment.filter(|env| !env.is_empty()) {
        if spends_in != merchant {
            return rejected(
                "environment_mismatch",
                format!("This agent spends in {spends_in}, and this secret key is for {merchant}"),
            );
        }
    }
    json!({ "ok": true, "agent": Value::Object(agent) })
}

/// Days since 1970-01-01 to a civil date (proleptic Gregorian).
fn civil_from_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = shifted.div_euclid(146_097);
    let day_of_era = shifted.rem_euclid(146_097);
    let year_of_era =
        (day_of_era - day_of_era / 1460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_index = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_index + 2) / 5 + 1;
    let month = if month_index < 10 {
        month_index + 3
    } else {
        month_index - 9
    };
    let year = year_of_era + era * 400 + i64::from(month <= 2);
    (year, month, day)
}

/// Unix seconds as `YYYY-MM-DDTHH:MM:SS.000Z`.
fn iso_from_unix_seconds(seconds: i64) -> String {
    let (year, month, day) = civil_from_days(seconds.div_euclid(86_400));
    let second_of_day = seconds.rem_euclid(86_400);
    format!(
        "{year:04}-{month:02}-{day:02}T{:02}:{:02}:{:02}.000Z",
        second_of_day / 3600,
        (second_of_day / 60) % 60,
        second_of_day % 60
    )
}

/// The agent a verified token payload names, or why it is not one.
///
/// `claims` must come from a token whose signature, issuer, audience and time
/// claims already passed. Returns `{ ok: true, agent }` or
/// `{ ok: false, reason, detail }` with `reason` `invalid` or
/// `environment_mismatch`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 156
)]
#[must_use]
pub fn agent_from_claims(claims: &Value, merchant_environment: Option<&str>) -> Value {
    let client_id = claims.get(AGENT_TOKEN_CLIENT_CLAIM);
    if client_id.is_some_and(|raw| !raw.is_string()) {
        return rejected("invalid", "cid is not a string");
    }
    let Some(sub) = claims
        .get("sub")
        .and_then(Value::as_str)
        .filter(|sub| sub.starts_with("agt_"))
    else {
        return rejected("invalid", "sub is not an agent reference");
    };
    let Some(principal) = claims
        .get("principal")
        .and_then(Value::as_str)
        .filter(|principal| principal.starts_with("ppl_"))
    else {
        return rejected("invalid", "principal is missing");
    };
    if claims.get("scope").and_then(Value::as_str) != Some(super::AGENT_SCOPE) {
        return rejected("invalid", "scope is not usage");
    }
    let Some(environment) = claims
        .get(AGENT_TOKEN_ENV_CLAIM)
        .and_then(Value::as_str)
        .filter(|env| AGENT_ENVIRONMENTS.contains(env))
    else {
        return rejected("invalid", "env is not sandbox or live");
    };

    let mut agent = Map::new();
    agent.insert("agentRef".to_owned(), json!(sub));
    agent.insert("principalRef".to_owned(), json!(principal));
    if let Some(jti) = str_field(claims, "jti") {
        agent.insert("tokenId".to_owned(), json!(jti));
    }
    if let Some(exp) = claims.get("exp").and_then(Value::as_f64) {
        if exp.is_finite() {
            // Whole seconds: a JWT `exp` is a NumericDate.
            #[allow(clippy::cast_possible_truncation)]
            let seconds = exp.floor() as i64;
            agent.insert(
                "expiresAt".to_owned(),
                json!(iso_from_unix_seconds(seconds)),
            );
        }
    }
    agent.insert(
        "promptExcerpt".to_owned(),
        json!(claims.get(AGENT_TOKEN_EXCERPT_CLAIM) == Some(&Value::Bool(true))),
    );
    agent.insert("environment".to_owned(), json!(environment));
    if let Some(client) = client_id
        .and_then(Value::as_str)
        .filter(|id| !id.is_empty())
    {
        agent.insert("clientId".to_owned(), json!(client));
    }
    check_environment(agent, merchant_environment)
}

/// What SolvaPay's answer about an agent key means.
///
/// `input` carries `verified` (the parsed key verification) or the failure as
/// `errorStatus` and `errorMessage`, plus an optional `merchantEnvironment`.
/// Returns `{ ok: true, agent }`, `{ ok: false, reason, detail }`, or
/// `{ rethrow: true }` when SolvaPay was out of reach: every paid call would
/// fail the same way, so that failure is not an answer about the key.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 157
)]
#[must_use]
pub fn agent_key_result(input: &Value) -> Value {
    let merchant_environment = str_field(input, "merchantEnvironment");
    if let Some(verified) = input.get("verified").and_then(Value::as_object) {
        let mut agent = Map::new();
        for field in ["agentRef", "principalRef", "promptExcerpt", "environment"] {
            if let Some(value) = verified.get(field) {
                agent.insert(field.to_owned(), value.clone());
            }
        }
        return check_environment(agent, merchant_environment);
    }
    let status = input.get("errorStatus").and_then(Value::as_i64);
    let message = input
        .get("errorMessage")
        .and_then(Value::as_str)
        .unwrap_or_default();
    match status {
        // SolvaPay refuses a key from the other environment with this code in its 403.
        Some(403) if message.contains("environment_mismatch") => {
            rejected("environment_mismatch", message)
        }
        Some(401 | 403) => rejected("invalid", message),
        _ => json!({ "rethrow": true }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn claims() -> Value {
        json!({
            "sub": "agt_TESTAGNT",
            "principal": "ppl_ABCDEFGHIJKLMNOP",
            "scope": "usage",
            "env": "sandbox",
            "jti": "tok_1",
            "exp": 1_767_225_600,
        })
    }

    #[test]
    fn secret_key_environment_reads_the_prefix() {
        assert_eq!(
            agent_secret_key_environment("sk_sandbox_abc").as_deref(),
            Some("sandbox")
        );
        assert_eq!(
            agent_secret_key_environment("sk_live_abc").as_deref(),
            Some("live")
        );
        assert_eq!(agent_secret_key_environment("sk_test_abc"), None);
    }

    #[test]
    fn agent_key_needs_more_than_the_prefix() {
        assert!(is_agent_key("agk_sandbox_X"));
        assert!(!is_agent_key("agk_"));
        assert!(!is_agent_key("sk_live_X"));
    }

    #[test]
    fn jwt_shape_is_three_base64url_parts() {
        assert!(looks_like_jwt("aaa.bbb.c-_c"));
        assert!(!looks_like_jwt("aaa.bbb"));
        assert!(!looks_like_jwt("aaa..ccc"));
        assert!(!looks_like_jwt("aaa.b+b.ccc"));
        assert!(!looks_like_jwt("a.b.c.d"));
    }

    #[test]
    fn credential_kind_routes_keys_only_when_accepted() {
        assert_eq!(agent_credential_kind("agk_x", true), "agent_key");
        assert_eq!(agent_credential_kind("agk_x", false), "not_agent");
        assert_eq!(agent_credential_kind("a.b.c", true), "agent_token");
        assert_eq!(agent_credential_kind("sk_live_x", true), "not_agent");
    }

    #[test]
    fn claims_become_an_agent() {
        let mut payload = claims();
        payload["px"] = json!(true);
        payload["cid"] = json!("oac_1");
        assert_eq!(
            agent_from_claims(&payload, Some("sandbox")),
            json!({
                "ok": true,
                "agent": {
                    "agentRef": "agt_TESTAGNT",
                    "principalRef": "ppl_ABCDEFGHIJKLMNOP",
                    "tokenId": "tok_1",
                    "expiresAt": "2026-01-01T00:00:00.000Z",
                    "promptExcerpt": true,
                    "environment": "sandbox",
                    "clientId": "oac_1",
                },
            })
        );
    }

    #[test]
    fn claims_are_rejected_in_dev_order() {
        let detail = |payload: Value| {
            agent_from_claims(&payload, None)["detail"]
                .as_str()
                .unwrap_or_default()
                .to_owned()
        };
        let mut bad_cid = claims();
        bad_cid["cid"] = json!(7);
        bad_cid["sub"] = json!("usr_1");
        assert_eq!(detail(bad_cid), "cid is not a string");
        let mut bad_sub = claims();
        bad_sub["sub"] = json!("usr_1");
        assert_eq!(detail(bad_sub), "sub is not an agent reference");
        let mut no_principal = claims();
        no_principal
            .as_object_mut()
            .map(|map| map.remove("principal"));
        assert_eq!(detail(no_principal), "principal is missing");
        let mut bad_scope = claims();
        bad_scope["scope"] = json!("admin");
        assert_eq!(detail(bad_scope), "scope is not usage");
        let mut bad_env = claims();
        bad_env["env"] = json!("staging");
        assert_eq!(detail(bad_env), "env is not sandbox or live");
    }

    #[test]
    fn other_environment_is_a_mismatch() {
        assert_eq!(
            agent_from_claims(&claims(), Some("live")),
            json!({
                "ok": false,
                "reason": "environment_mismatch",
                "detail": "This agent spends in sandbox, and this secret key is for live",
            })
        );
    }

    #[test]
    fn key_answer_maps_to_agent_rejection_or_rethrow() {
        let verified = json!({
            "verified": {
                "agentRef": "agt_1",
                "principalRef": "ppl_1",
                "promptExcerpt": false,
                "environment": "sandbox",
            },
            "merchantEnvironment": "sandbox",
        });
        assert_eq!(agent_key_result(&verified)["ok"], true);
        assert_eq!(
            agent_key_result(&json!({ "errorStatus": 401, "errorMessage": "nope" }))["reason"],
            "invalid"
        );
        assert_eq!(
            agent_key_result(
                &json!({ "errorStatus": 403, "errorMessage": "failed (403): environment_mismatch" })
            )["reason"],
            "environment_mismatch"
        );
        assert_eq!(
            agent_key_result(&json!({ "errorStatus": 403, "errorMessage": "other merchant" }))
                ["reason"],
            "invalid"
        );
        assert_eq!(
            agent_key_result(&json!({ "errorStatus": 500, "errorMessage": "down" })),
            json!({ "rethrow": true })
        );
        assert_eq!(agent_key_result(&json!({})), json!({ "rethrow": true }));
    }

    #[test]
    fn iso_formats_leap_days() {
        assert_eq!(iso_from_unix_seconds(0), "1970-01-01T00:00:00.000Z");
        assert_eq!(
            iso_from_unix_seconds(1_709_210_096),
            "2024-02-29T12:34:56.000Z"
        );
    }
}
