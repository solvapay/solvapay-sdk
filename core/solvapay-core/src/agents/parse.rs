//! Strict readers for SolvaPay's agent API answers.
//!
//! Each answer is checked field by field: an agent is served, a paid call goes
//! ahead and a call's books are settled on them, so a misread must fail.
//! Unknown fields are dropped.

use serde_json::{json, Map, Value};

use super::{
    failure, AGENT_ENVIRONMENTS, COMPLETE_SOURCES, RECONCILIATION_REASONS, RECONCILIATION_RESULTS,
    SERVER_REFUSAL_REASONS,
};

/// A JSON object, or the failure sentence.
fn record<'a>(value: Option<&'a Value>, message: &str) -> Result<&'a Map<String, Value>, String> {
    value
        .and_then(Value::as_object)
        .ok_or_else(|| message.to_owned())
}

/// A non-empty string.
fn require_string(value: Option<&Value>, label: &str) -> Result<String, String> {
    match value.and_then(Value::as_str) {
        Some(text) if !text.is_empty() => Ok(text.to_owned()),
        _ => Err(format!("{label} must be a non-empty string")),
    }
}

/// A number with no fractional part.
fn require_integer(value: Option<&Value>, label: &str) -> Result<Value, String> {
    let number = value.and_then(Value::as_f64);
    match (value, number) {
        (Some(raw), Some(float)) if float.is_finite() && float.fract() == 0.0 => Ok(raw.clone()),
        _ => Err(format!("{label} must be an integer")),
    }
}

/// A boolean.
fn require_boolean(value: Option<&Value>, label: &str) -> Result<bool, String> {
    value
        .and_then(Value::as_bool)
        .ok_or_else(|| format!("{label} must be a boolean"))
}

/// One of a frozen list of strings.
fn require_one_of(allowed: &[&str], value: Option<&Value>, label: &str) -> Result<String, String> {
    if let Some(text) = value.and_then(Value::as_str) {
        if allowed.contains(&text) {
            return Ok(text.to_owned());
        }
    }
    let got = match value {
        None => "undefined".to_owned(),
        Some(other) => serde_json::to_string(other).unwrap_or_else(|_| "undefined".to_owned()),
    };
    Err(format!(
        "{label} must be one of {}, got {got}",
        allowed.join(", ")
    ))
}

/// An amount and its currency, both required.
fn parse_money(value: Option<&Value>, label: &str) -> Result<Value, String> {
    let money = record(
        value,
        &format!("{label} must be an object with amount and currency"),
    )?;
    Ok(json!({
        "amount": require_string(money.get("amount"), &format!("{label}.amount"))?,
        "currency": require_string(money.get("currency"), &format!("{label}.currency"))?,
    }))
}

/// The agent behind an agent key.
fn parse_verified_agent_key(value: &Value) -> Result<Value, String> {
    let object = record(Some(value), "Agent key verification was not an object")?;
    Ok(json!({
        "agentRef": require_string(object.get("agentRef"), "agentRef")?,
        "principalRef": require_string(object.get("principalRef"), "principalRef")?,
        "promptExcerpt": require_boolean(object.get("promptExcerpt"), "promptExcerpt")?,
        "environment": require_one_of(AGENT_ENVIRONMENTS, object.get("environment"), "environment")?,
    }))
}

/// Go ahead, refused with why, or still waiting for the owner.
fn parse_authorize(value: &Value) -> Result<Value, String> {
    let object = record(Some(value), "Authorize response was not an object")?;
    let call_ref = require_string(object.get("callRef"), "callRef")?;
    let status = require_string(object.get("status"), "status")?;
    match status.as_str() {
        "allowed" => {
            let reservation = record(object.get("reservation"), "reservation must be an object")?;
            Ok(json!({
                "status": status,
                "callRef": call_ref,
                "reservation": {
                    "held": parse_money(reservation.get("held"), "reservation.held")?,
                    "expiresAt": require_string(
                        reservation.get("expiresAt"),
                        "reservation.expiresAt",
                    )?,
                },
            }))
        }
        "refused" => Ok(json!({
            "status": status,
            "callRef": call_ref,
            "reason": require_one_of(SERVER_REFUSAL_REASONS, object.get("reason"), "reason")?,
            "message": require_string(object.get("message"), "message")?,
        })),
        "waiting" => {
            let approval = record(object.get("approval"), "approval must be an object")?;
            Ok(json!({
                "status": status,
                "callRef": call_ref,
                "message": require_string(object.get("message"), "message")?,
                "approval": {
                    "reference": require_string(approval.get("reference"), "approval.reference")?,
                    "expiresAt": require_string(approval.get("expiresAt"), "approval.expiresAt")?,
                },
                "retryAfterSeconds": require_integer(
                    object.get("retryAfterSeconds"),
                    "retryAfterSeconds",
                )?,
            }))
        }
        other => Err(format!(
            "Authorize status \"{other}\" is not allowed, refused or waiting"
        )),
    }
}

/// How SolvaPay settled a call.
fn parse_complete(value: &Value) -> Result<Value, String> {
    let object = record(Some(value), "Complete response was not an object")?;
    Ok(json!({
        "callRef": require_string(object.get("callRef"), "callRef")?,
        "settled": require_boolean(object.get("settled"), "settled")?,
        "source": require_one_of(COMPLETE_SOURCES, object.get("source"), "source")?,
        "amount": parse_money(object.get("amount"), "amount")?,
        "duplicate": require_boolean(object.get("duplicate"), "duplicate")?,
    }))
}

/// One call of a usage report, as SolvaPay reconciled it.
fn parse_reconciled_call(value: &Value) -> Result<Value, String> {
    let object = record(Some(value), "Usage report result was not an object")?;
    let result = require_one_of(RECONCILIATION_RESULTS, object.get("result"), "result")?;
    let mut out = Map::new();
    let present = |field: &str| object.get(field).filter(|raw| !raw.is_null());
    if let Some(raw) = present("callRef") {
        out.insert(
            "callRef".to_owned(),
            Value::String(require_string(Some(raw), "callRef")?),
        );
    }
    out.insert("result".to_owned(), Value::String(result));
    if let Some(raw) = present("reason") {
        out.insert(
            "reason".to_owned(),
            Value::String(require_one_of(RECONCILIATION_REASONS, Some(raw), "reason")?),
        );
    }
    for field in [
        "reported",
        "bookedPolicy",
        "bookedCredit",
        "policyDelta",
        "creditDelta",
    ] {
        if let Some(raw) = present(field) {
            out.insert(
                field.to_owned(),
                Value::String(require_string(Some(raw), field)?),
            );
        }
    }
    Ok(Value::Object(out))
}

/// SolvaPay's record of a usage report.
fn parse_usage_report(value: &Value) -> Result<Value, String> {
    let object = record(Some(value), "Usage report response was not an object")?;
    let results = object
        .get("results")
        .and_then(Value::as_array)
        .ok_or_else(|| "Usage report results must be a list".to_owned())?;
    let untagged = record(
        object.get("untagged"),
        "Usage report untagged must be an object",
    )?;
    let reference = require_string(object.get("reference"), "reference")?;
    let currency = require_string(object.get("currency"), "currency")?;
    let duplicate = require_boolean(object.get("duplicate"), "duplicate")?;
    let results = results
        .iter()
        .map(parse_reconciled_call)
        .collect::<Result<Vec<_>, _>>()?;
    Ok(json!({
        "reference": reference,
        "currency": currency,
        "duplicate": duplicate,
        "results": results,
        "untagged": {
            "total": require_string(untagged.get("total"), "untagged.total")?,
            "beforePolicy": require_string(untagged.get("beforePolicy"), "untagged.beforePolicy")?,
            "flagged": require_boolean(untagged.get("flagged"), "untagged.flagged")?,
        },
    }))
}

/// Read one agent API answer, typed for Rust callers.
///
/// `kind` is `verifiedAgentKey`, `authorize`, `complete` or `usageReport`.
///
/// # Errors
///
/// The sentence naming the first field that did not read.
pub fn parse_agent_response_typed(kind: &str, value: &Value) -> Result<Value, String> {
    match kind {
        "verifiedAgentKey" => parse_verified_agent_key(value),
        "authorize" => parse_authorize(value),
        "complete" => parse_complete(value),
        "usageReport" => parse_usage_report(value),
        other => Err(format!("Unknown agent response kind \"{other}\"")),
    }
}

/// Read one agent API answer strictly.
///
/// Returns `{ ok: true, value }` with unknown fields dropped, or
/// `{ ok: false, error }` naming the first field that did not read.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 151
)]
#[must_use]
pub fn parse_agent_response(kind: &str, value: &Value) -> Value {
    match parse_agent_response_typed(kind, value) {
        Ok(parsed) => json!({ "ok": true, "value": parsed }),
        Err(message) => failure(message),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn error_of(kind: &str, value: Value) -> String {
        parse_agent_response(kind, &value)["error"]
            .as_str()
            .unwrap_or_default()
            .to_owned()
    }

    #[test]
    fn authorize_allowed_keeps_the_reservation_and_drops_extras() {
        let parsed = parse_agent_response(
            "authorize",
            &json!({
                "status": "allowed",
                "callRef": "call_1",
                "extra": true,
                "reservation": {
                    "held": { "amount": "0.25", "currency": "USD", "x": 1 },
                    "expiresAt": "2026-01-01T00:00:00Z",
                },
            }),
        );
        assert_eq!(
            parsed,
            json!({
                "ok": true,
                "value": {
                    "status": "allowed",
                    "callRef": "call_1",
                    "reservation": {
                        "held": { "amount": "0.25", "currency": "USD" },
                        "expiresAt": "2026-01-01T00:00:00Z",
                    },
                },
            })
        );
    }

    #[test]
    fn authorize_refused_needs_a_known_reason() {
        assert_eq!(
            error_of(
                "authorize",
                json!({ "status": "refused", "callRef": "call_1", "reason": "nope", "message": "m" }),
            ),
            "reason must be one of customer_not_linked, ask, deny, topup_required, \
             approval_declined, approval_expired, got \"nope\""
        );
    }

    #[test]
    fn authorize_waiting_needs_an_integer_retry() {
        let waiting = json!({
            "status": "waiting",
            "callRef": "call_1",
            "message": "Waiting",
            "approval": { "reference": "apr_1", "expiresAt": "2026-01-01T00:00:00Z" },
            "retryAfterSeconds": 1.5,
        });
        assert_eq!(
            error_of("authorize", waiting),
            "retryAfterSeconds must be an integer"
        );
    }

    #[test]
    fn authorize_rejects_an_unknown_status_and_a_missing_money_currency() {
        assert_eq!(
            error_of(
                "authorize",
                json!({ "status": "maybe", "callRef": "call_1" })
            ),
            "Authorize status \"maybe\" is not allowed, refused or waiting"
        );
        assert_eq!(
            error_of(
                "authorize",
                json!({
                    "status": "allowed",
                    "callRef": "call_1",
                    "reservation": { "held": { "amount": "1" }, "expiresAt": "x" },
                }),
            ),
            "reservation.held.currency must be a non-empty string"
        );
        assert_eq!(
            error_of("authorize", json!([])),
            "Authorize response was not an object"
        );
    }

    #[test]
    fn complete_reads_every_field() {
        let body = json!({
            "callRef": "call_1",
            "settled": true,
            "source": "reported",
            "amount": { "amount": "0.1", "currency": "USD" },
            "duplicate": false,
        });
        assert_eq!(parse_agent_response("complete", &body)["value"], body);
        assert_eq!(
            error_of("complete", json!({ "callRef": "call_1", "settled": "yes" })),
            "settled must be a boolean"
        );
    }

    #[test]
    fn usage_report_keeps_only_present_optionals() {
        let parsed = parse_agent_response(
            "usageReport",
            &json!({
                "reference": "urp_1",
                "currency": "USD",
                "duplicate": false,
                "results": [
                    { "result": "ignored", "callRef": null },
                    { "callRef": "call_1", "result": "adjusted", "reason": "cost_differs", "reported": "1" },
                ],
                "untagged": { "total": "0", "beforePolicy": "0", "flagged": false },
            }),
        );
        assert_eq!(
            parsed["value"]["results"],
            json!([
                { "result": "ignored" },
                { "callRef": "call_1", "result": "adjusted", "reason": "cost_differs", "reported": "1" },
            ])
        );
    }

    #[test]
    fn usage_report_names_the_field_that_failed() {
        assert_eq!(
            error_of("usageReport", json!({ "results": {}, "untagged": {} })),
            "Usage report results must be a list"
        );
        assert_eq!(
            error_of(
                "usageReport",
                json!({
                    "reference": "urp_1",
                    "currency": "USD",
                    "duplicate": false,
                    "results": [],
                    "untagged": { "total": "0", "beforePolicy": "0", "flagged": "no" },
                }),
            ),
            "untagged.flagged must be a boolean"
        );
    }

    #[test]
    fn verified_agent_key_needs_a_known_environment() {
        assert_eq!(
            error_of(
                "verifiedAgentKey",
                json!({ "agentRef": "agt_1", "principalRef": "ppl_1", "promptExcerpt": false }),
            ),
            "environment must be one of sandbox, live, got undefined"
        );
    }

    #[test]
    fn unknown_kind_fails() {
        assert_eq!(
            error_of("other", json!({})),
            "Unknown agent response kind \"other\""
        );
    }
}
