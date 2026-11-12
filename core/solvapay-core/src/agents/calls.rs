//! One agent's paid call, start to finish, whatever the protocol.
//!
//! SolvaPay decides everything: `authorize` before the upstream call finds the
//! customer, checks the spend policy, holds the estimate against the budget
//! and the balance, and waits for the owner when they must approve.
//! `complete` after it settles at the cost the upstream reported. This file
//! decides what the merchant does next between those requests. The requests,
//! the clock and the sleep belong to the caller.

use serde_json::{json, Map, Value};

use super::parse::parse_agent_response_typed;
use super::{str_field, AGENT_REQUEST_TIMEOUT_MS, AUTHORIZE_WAIT_MAX_SECONDS};

/// Sentence for an agent SolvaPay did not accept.
const NOT_ACCEPTED: &str = "SolvaPay did not accept this agent (revoked or not for this merchant).";
/// Sentence for an authorize that could not be made.
const UNAVAILABLE: &str =
    "SolvaPay could not be reached to authorize this call. Try again shortly.";

/// Digits kept after the decimal point of an amount.
const AMOUNT_PLACES: usize = 8;

/// Add one unit in the last place of a string of ASCII digits. `true` on carry out.
fn increment(digits: &mut [u8]) -> bool {
    for digit in digits.iter_mut().rev() {
        if *digit == b'9' {
            *digit = b'0';
        } else {
            *digit += 1;
            return false;
        }
    }
    true
}

/// An amount as a decimal string with up to 8 places, trailing zeros trimmed.
///
/// Rounds half away from zero at the eighth place, as the TypeScript SDK does.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 162
)]
#[must_use]
pub fn agent_amount_string(amount: f64) -> String {
    if amount.is_nan() {
        return "NaN".to_owned();
    }
    if amount.is_infinite() {
        return if amount > 0.0 {
            "Infinity"
        } else {
            "-Infinity"
        }
        .to_owned();
    }
    // Forty places hold the whole tail of any f64 that ties at the eighth.
    let expanded = format!("{:.40}", amount.abs());
    let (whole, fraction) = expanded.split_once('.').unwrap_or((&expanded, ""));
    let mut whole = whole.as_bytes().to_vec();
    let mut kept = fraction.as_bytes()[..AMOUNT_PLACES.min(fraction.len())].to_vec();
    let round_up = fraction
        .as_bytes()
        .get(AMOUNT_PLACES)
        .is_some_and(|digit| *digit >= b'5');
    if round_up && increment(&mut kept) && increment(&mut whole) {
        whole.insert(0, b'1');
    }
    while kept.last() == Some(&b'0') {
        kept.pop();
    }
    let mut out = String::from_utf8_lossy(&whole).into_owned();
    if !kept.is_empty() {
        out.push('.');
        out.push_str(&String::from_utf8_lossy(&kept));
    }
    let is_zero = out.bytes().all(|byte| byte == b'0' || byte == b'.');
    if amount < 0.0 && !is_zero {
        out.insert(0, '-');
    }
    out
}

/// Whole milliseconds read from a JSON number.
fn millis(value: Option<&Value>) -> Option<i64> {
    let float = value.and_then(Value::as_f64)?;
    if !float.is_finite() {
        return None;
    }
    #[allow(clippy::cast_possible_truncation)]
    Some(float.floor() as i64)
}

/// The authorize request body for `call`, holding for `wait` seconds.
fn authorize_body(call: &Value, wait: i64) -> Value {
    let mut body = Map::new();
    for field in ["agentToken", "requestId", "item", "estimate"] {
        if let Some(value) = call.get(field).filter(|value| !value.is_null()) {
            body.insert(field.to_owned(), value.clone());
        }
    }
    if let Some(facts) = call.get("prompt").filter(|facts| facts.is_object()) {
        body.insert(
            "promptHash".to_owned(),
            facts.get("promptHash").cloned().unwrap_or(Value::Null),
        );
        body.insert(
            "toolError".to_owned(),
            facts.get("toolError").cloned().unwrap_or(Value::Null),
        );
        // Only when the token SolvaPay minted says the owner opted in.
        let opted_in = call
            .get("agent")
            .and_then(|agent| agent.get("promptExcerpt"))
            .and_then(Value::as_bool)
            .unwrap_or(false);
        if opted_in {
            body.insert(
                "promptExcerpt".to_owned(),
                facts.get("excerpt").cloned().unwrap_or(Value::Null),
            );
        }
    }
    body.insert("wait".to_owned(), json!(wait));
    Value::Object(body)
}

/// `{ kind: "refused", reason, message, log }`.
fn refuse(reason: &str, message: &str, log: Value) -> Value {
    json!({ "kind": "refused", "reason": reason, "message": message, "log": log })
}

/// What an authorize answer means for a call that may still be waiting.
fn after_answer(input: &Value, answer: &Value, now_ms: i64, deadline_ms: i64) -> Value {
    let call = input.get("call").unwrap_or(&Value::Null);
    let call_ref = answer.get("callRef").cloned().unwrap_or(Value::Null);
    match answer.get("status").and_then(Value::as_str) {
        Some("allowed") => json!({
            "kind": "allow",
            "callRef": call_ref,
            "item": call.get("item").cloned().unwrap_or(Value::Null),
            "estimate": call.get("estimate").cloned().unwrap_or(Value::Null),
            "reservation": answer.get("reservation").cloned().unwrap_or(Value::Null),
        }),
        Some("refused") => refuse(
            str_field(answer, "reason").unwrap_or_default(),
            str_field(answer, "message").unwrap_or_default(),
            json!({ "callRef": call_ref }),
        ),
        _ => {
            let message = str_field(answer, "message").unwrap_or_default();
            let held = json!({
                "callRef": call_ref,
                "approvalRef": answer
                    .get("approval")
                    .and_then(|approval| approval.get("reference"))
                    .cloned()
                    .unwrap_or(Value::Null),
            });
            let max_wait = input
                .get("maxWaitSeconds")
                .and_then(Value::as_f64)
                .unwrap_or(0.0);
            if max_wait == 0.0 {
                return refuse("ask", message, held);
            }
            if input.get("aborted").and_then(Value::as_bool) == Some(true) {
                return refuse("approval_client_closed", message, held);
            }
            if now_ms >= deadline_ms {
                return refuse("approval_timed_out", message, held);
            }
            let retry_seconds = millis(answer.get("retryAfterSeconds")).unwrap_or(0);
            json!({
                "kind": "sleep",
                "ms": retry_seconds.saturating_mul(1000),
                "deadlineMs": deadline_ms,
                "log": held,
            })
        }
    }
}

/// The next move of a paid call.
///
/// `input` carries `call` (`requestId`, `agentToken`, `agent`, `item`,
/// `estimate`, `prompt`), `maxWaitSeconds` and `nowMs`. Echo `deadlineMs` from
/// the previous step. After an authorize, add its raw `answer`, or `failure`
/// (`status`, `error`) when it could not be made; add `aborted: true` once the
/// caller has gone away.
///
/// Returns one of:
/// - `{ kind: "authorize", body, timeoutMs, deadlineMs }`: send the request.
/// - `{ kind: "sleep", ms, deadlineMs, log }`: the owner is deciding; wait, then step again with no answer.
/// - `{ kind: "allow", callRef, item, estimate, reservation }`: run the call.
/// - `{ kind: "refused", reason, message, log }`: `message` is the sentence for the human.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 163
)]
#[must_use]
pub fn agent_call_step(input: &Value) -> Value {
    let now_ms = millis(input.get("nowMs")).unwrap_or(0);
    let max_wait_ms = input
        .get("maxWaitSeconds")
        .and_then(Value::as_f64)
        .filter(|seconds| seconds.is_finite() && *seconds > 0.0)
        .map_or(0.0, |seconds| seconds * 1000.0);
    #[allow(clippy::cast_possible_truncation)]
    let deadline_ms = millis(input.get("deadlineMs"))
        .unwrap_or_else(|| now_ms.saturating_add(max_wait_ms as i64));

    if let Some(failure) = input.get("failure").filter(|failure| !failure.is_null()) {
        let status = failure.get("status").and_then(Value::as_i64);
        let log = json!({
            "status": status,
            "error": failure.get("error").cloned().unwrap_or(Value::Null),
        });
        // SolvaPay verifies the token again: a revoked agent, or one for another merchant.
        return if matches!(status, Some(401 | 403)) {
            refuse("agent_not_accepted", NOT_ACCEPTED, log)
        } else {
            refuse("unavailable", UNAVAILABLE, log)
        };
    }

    if let Some(raw) = input.get("answer").filter(|answer| !answer.is_null()) {
        return match parse_agent_response_typed("authorize", raw) {
            Ok(answer) => after_answer(input, &answer, now_ms, deadline_ms),
            // A misread answer never lets a call through.
            Err(error) => refuse(
                "unavailable",
                UNAVAILABLE,
                json!({ "status": Value::Null, "error": error }),
            ),
        };
    }

    let remaining_seconds = deadline_ms.saturating_sub(now_ms).div_euclid(1000);
    let wait = remaining_seconds.clamp(0, AUTHORIZE_WAIT_MAX_SECONDS);
    json!({
        "kind": "authorize",
        "body": authorize_body(input.get("call").unwrap_or(&Value::Null), wait),
        // A held request answers when the owner does or its wait ends.
        "timeoutMs": wait * 1000 + AGENT_REQUEST_TIMEOUT_MS,
        "deadlineMs": deadline_ms,
    })
}

/// The complete request body for how a call ended.
///
/// `result` is `{ status, cost, interrupted? }` with `cost` as
/// `{ amount, currency }` (a number amount) or null when none arrived. Pass
/// `{ release: reason }` for a call that never reached the upstream: it is
/// completed as an upstream failure, so nothing is charged.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "agents",
    emit_order = 164
)]
#[must_use]
pub fn agent_complete_body(result: &Value) -> Value {
    if let Some(reason) = result.get("release").and_then(Value::as_str) {
        return json!({ "status": 502, "cost": Value::Null, "interrupted": reason });
    }
    let cost = match result.get("cost").filter(|cost| cost.is_object()) {
        Some(cost) => {
            let amount = match cost.get("amount") {
                Some(Value::String(text)) => text.clone(),
                other => agent_amount_string(other.and_then(Value::as_f64).unwrap_or(f64::NAN)),
            };
            json!({
                "amount": amount,
                "currency": cost.get("currency").cloned().unwrap_or(Value::Null),
            })
        }
        None => Value::Null,
    };
    let mut body = Map::new();
    body.insert(
        "status".to_owned(),
        result.get("status").cloned().unwrap_or(Value::Null),
    );
    body.insert("cost".to_owned(), cost);
    if let Some(interrupted) = str_field(result, "interrupted") {
        body.insert("interrupted".to_owned(), json!(interrupted));
    }
    Value::Object(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn call(prompt_excerpt: bool) -> Value {
        json!({
            "requestId": "req_1",
            "agentToken": "tok",
            "agent": { "agentRef": "agt_1", "principalRef": "ppl_1", "promptExcerpt": prompt_excerpt },
            "item": "model-x",
            "estimate": { "amount": "0.25", "currency": "USD" },
            "prompt": { "promptHash": "sha256:abc", "toolError": false, "excerpt": "the end" },
        })
    }

    fn waiting() -> Value {
        json!({
            "status": "waiting",
            "callRef": "call_1",
            "message": "Waiting for your owner.",
            "approval": { "reference": "apr_1", "expiresAt": "2026-01-01T00:00:00Z" },
            "retryAfterSeconds": 2,
        })
    }

    #[test]
    fn amount_string_trims_and_rounds_half_up() {
        assert_eq!(agent_amount_string(0.0), "0");
        assert_eq!(agent_amount_string(1.0), "1");
        assert_eq!(agent_amount_string(0.25), "0.25");
        assert_eq!(agent_amount_string(1.234_567_891), "1.23456789");
        assert_eq!(agent_amount_string(0.000_000_004), "0");
        assert_eq!(agent_amount_string(0.000_000_006), "0.00000001");
        // 2^-9 is an exact tie at the eighth place.
        assert_eq!(agent_amount_string(0.001_953_125), "0.00195313");
        assert_eq!(agent_amount_string(0.999_999_999), "1");
        assert_eq!(agent_amount_string(9.999_999_999), "10");
        assert_eq!(agent_amount_string(-0.5), "-0.5");
    }

    #[test]
    fn first_step_authorizes_with_the_capped_wait() {
        let step =
            agent_call_step(&json!({ "call": call(false), "maxWaitSeconds": 120, "nowMs": 1000 }));
        assert_eq!(step["kind"], "authorize");
        assert_eq!(step["deadlineMs"], 121_000);
        assert_eq!(step["timeoutMs"], 65_000);
        assert_eq!(
            step["body"],
            json!({
                "agentToken": "tok",
                "requestId": "req_1",
                "item": "model-x",
                "estimate": { "amount": "0.25", "currency": "USD" },
                "promptHash": "sha256:abc",
                "toolError": false,
                "wait": 55,
            })
        );
    }

    #[test]
    fn excerpt_goes_only_when_the_owner_opted_in() {
        let step = agent_call_step(&json!({ "call": call(true), "maxWaitSeconds": 0, "nowMs": 0 }));
        assert_eq!(step["body"]["promptExcerpt"], "the end");
        assert_eq!(step["body"]["wait"], 0);
        assert_eq!(step["timeoutMs"], 10_000);
    }

    #[test]
    fn no_prompt_sends_no_prompt_fields() {
        let mut bare = call(true);
        bare["prompt"] = Value::Null;
        let step = agent_call_step(&json!({ "call": bare, "maxWaitSeconds": 0, "nowMs": 0 }));
        assert!(step["body"].get("promptHash").is_none());
        assert!(step["body"].get("promptExcerpt").is_none());
    }

    #[test]
    fn wait_shrinks_as_the_deadline_nears() {
        let step = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 120, "nowMs": 110_500, "deadlineMs": 121_000,
        }));
        assert_eq!(step["body"]["wait"], 10);
        let late = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 120, "nowMs": 130_000, "deadlineMs": 121_000,
        }));
        assert_eq!(late["body"]["wait"], 0);
    }

    #[test]
    fn allowed_answer_allows() {
        let step = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0,
            "answer": {
                "status": "allowed", "callRef": "call_1",
                "reservation": { "held": { "amount": "0.25", "currency": "USD" }, "expiresAt": "x" },
            },
        }));
        assert_eq!(
            step,
            json!({
                "kind": "allow",
                "callRef": "call_1",
                "item": "model-x",
                "estimate": { "amount": "0.25", "currency": "USD" },
                "reservation": { "held": { "amount": "0.25", "currency": "USD" }, "expiresAt": "x" },
            })
        );
    }

    #[test]
    fn refused_answer_carries_solvapays_sentence() {
        let step = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0,
            "answer": { "status": "refused", "callRef": "call_1", "reason": "deny", "message": "Over the cap." },
        }));
        assert_eq!(
            step,
            json!({ "kind": "refused", "reason": "deny", "message": "Over the cap.", "log": { "callRef": "call_1" } })
        );
    }

    #[test]
    fn waiting_refuses_at_once_when_the_merchant_does_not_wait() {
        let step = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0, "answer": waiting(),
        }));
        assert_eq!(step["reason"], "ask");
        assert_eq!(step["message"], "Waiting for your owner.");
        assert_eq!(
            step["log"],
            json!({ "callRef": "call_1", "approvalRef": "apr_1" })
        );
    }

    #[test]
    fn waiting_sleeps_then_times_out_or_notices_the_caller_left() {
        let base = json!({ "call": call(false), "maxWaitSeconds": 60, "deadlineMs": 60_000, "answer": waiting() });
        let mut early = base.clone();
        early["nowMs"] = json!(1000);
        assert_eq!(
            agent_call_step(&early),
            json!({
                "kind": "sleep", "ms": 2000, "deadlineMs": 60_000,
                "log": { "callRef": "call_1", "approvalRef": "apr_1" },
            })
        );
        let mut gone = early.clone();
        gone["aborted"] = json!(true);
        assert_eq!(agent_call_step(&gone)["reason"], "approval_client_closed");
        let mut late = base;
        late["nowMs"] = json!(60_000);
        assert_eq!(agent_call_step(&late)["reason"], "approval_timed_out");
    }

    #[test]
    fn failures_never_let_a_call_through() {
        let rejected = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0,
            "failure": { "status": 403, "error": "POST failed (403)" },
        }));
        assert_eq!(rejected["reason"], "agent_not_accepted");
        assert_eq!(rejected["message"], NOT_ACCEPTED);
        let down = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0,
            "failure": { "status": null, "error": "connect" },
        }));
        assert_eq!(down["reason"], "unavailable");
        assert_eq!(down["message"], UNAVAILABLE);
        let misread = agent_call_step(&json!({
            "call": call(false), "maxWaitSeconds": 0, "nowMs": 0,
            "answer": { "status": "allowed", "callRef": "call_1" },
        }));
        assert_eq!(misread["reason"], "unavailable");
        assert_eq!(misread["log"]["error"], "reservation must be an object");
    }

    #[test]
    fn complete_body_formats_the_cost() {
        assert_eq!(
            agent_complete_body(
                &json!({ "status": 200, "cost": { "amount": 0.1, "currency": "USD" } })
            ),
            json!({ "status": 200, "cost": { "amount": "0.1", "currency": "USD" } })
        );
        assert_eq!(
            agent_complete_body(
                &json!({ "status": 200, "cost": null, "interrupted": "client closed" })
            ),
            json!({ "status": 200, "cost": null, "interrupted": "client closed" })
        );
        assert_eq!(
            agent_complete_body(&json!({ "release": "upstream_unreachable" })),
            json!({ "status": 502, "cost": null, "interrupted": "upstream_unreachable" })
        );
    }
}
