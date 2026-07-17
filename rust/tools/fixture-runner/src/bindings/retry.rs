//! Host-side `withRetry` fixture adapter (Step 11).
//!
//! Uses [`solvapay_core::RetryPolicy`] for delay computation; timers and
//! callbacks stay in this runner (no real sleep — delays are recorded only).
//! Non-`Error` throwable coercion (`String(error)`) is host-side only.

use serde_json::{json, Map, Value};
use solvapay_core::{Backoff, RetryPolicy};

use crate::model::FixtureInput;
use crate::runner::BindingError;

/// Runs a scripted `withRetry` scenario from fixture args.
///
/// Produces the observation JSON (`delays`, `events`, `outcome`) expected by the golden-fixture contract.
/// Uses [`solvapay_core::RetryPolicy`] for delay computation; no real timers are used.
///
/// # Arguments
///
/// * `input` - Fixture input whose `args` describe attempts, optional `options`, `shouldRetry`, and `onRetry`.
///
/// # Returns
///
/// Observation JSON on success.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when fixture args fail validation.
pub(super) fn invoke_with_retry(input: &FixtureInput) -> Result<Value, BindingError> {
    let scenario = parse_scenario(input)?;
    Ok(run_scenario(&scenario))
}

/// One scripted attempt outcome in a `withRetry` fixture.
#[derive(Debug, Clone)]
enum AttemptSpec {
    /// Attempt resolves successfully with this JSON value.
    Resolve(Value),
    /// Attempt throws an `Error` with this message string.
    Throw(String),
    /// Attempt throws a non-`Error` value coerced via [`js_string_coerce`].
    ThrowRaw(Value),
}

/// Optional `shouldRetry` callback behavior from fixture args.
#[derive(Debug, Clone)]
enum ShouldRetrySpec {
    /// Always allow retry after a failed attempt.
    Always,
    /// Never retry after a failed attempt.
    Never,
    /// Retry unless the current attempt index appears in `vetoAt`.
    VetoAt(Vec<u32>),
}

/// Parsed `withRetry` fixture scenario: attempt script, policy, and callback flags.
#[derive(Debug)]
struct Scenario {
    /// Ordered list of per-call outcomes; exhausted calls reject with a diagnostic message.
    attempts: Vec<AttemptSpec>,
    /// Delay policy from core (`maxRetries`, `initialDelay`, `backoffStrategy`).
    policy: RetryPolicy,
    /// Optional `shouldRetry` hook simulation.
    should_retry: Option<ShouldRetrySpec>,
    /// When true, records `onRetry:{attempt}` events before each sleep.
    on_retry: bool,
}

/// Executes a parsed retry scenario loop, recording delays and callback events.
///
/// No real sleep occurs — delays are recorded as millisecond values only.
///
/// # Arguments
///
/// * `scenario` - Parsed attempt script, retry policy, and optional callback flags.
///
/// # Returns
///
/// Observation JSON with `delays`, `events`, and `outcome` (`resolved` or `rejected`).
fn run_scenario(scenario: &Scenario) -> Value {
    let mut events = Vec::new();
    let mut delays = Vec::new();
    let mut call_index = 0usize;

    loop {
        let attempt = call_index as u32;
        events.push(format_call_event(attempt));

        let spec = scenario.attempts.get(call_index);
        call_index += 1;

        let error_message = match spec {
            Some(AttemptSpec::Resolve(value)) => {
                return observation(
                    delays,
                    events,
                    json!({ "type": "resolved", "value": value }),
                );
            }
            Some(AttemptSpec::Throw(message)) => message.clone(),
            Some(AttemptSpec::ThrowRaw(raw)) => js_string_coerce(raw),
            None => {
                let message = format!("withRetry scenario exhausted attempts at call:{attempt}");
                return observation(
                    delays,
                    events,
                    json!({ "type": "rejected", "name": "Error", "message": message }),
                );
            }
        };

        let Some(delay) = scenario.policy.next_delay(attempt) else {
            return observation(delays, events, rejected_error(&error_message));
        };

        if let Some(spec) = &scenario.should_retry {
            let allow = decide_should_retry(spec, attempt);
            events.push(format_should_retry_event(attempt, allow));
            if !allow {
                return observation(delays, events, rejected_error(&error_message));
            }
        }

        if scenario.on_retry {
            events.push(format_on_retry_event(attempt));
        }

        let delay_ms = u64::try_from(delay.as_millis()).unwrap_or(u64::MAX);
        delays.push(delay_ms);
        events.push(format_sleep_event(delay_ms));
    }
}

/// Builds the top-level observation object returned by the `withRetry` binding.
///
/// # Arguments
///
/// * `delays` - Recorded sleep durations in milliseconds, in invocation order.
/// * `events` - Ordered callback and lifecycle event tokens.
/// * `outcome` - Final `resolved` or `rejected` outcome JSON.
///
/// # Returns
///
/// JSON object with keys `delays`, `events`, and `outcome`.
fn observation(delays: Vec<u64>, events: Vec<String>, outcome: Value) -> Value {
    json!({
        "delays": delays,
        "events": events,
        "outcome": outcome,
    })
}

/// Builds a JSON outcome for a rejected attempt.
///
/// # Arguments
///
/// * `message` - Human-readable rejection message (mirrors JS `Error.message`).
///
/// # Returns
///
/// JSON object with `type: "rejected"`, `name: "Error"`, and the given `message`.
fn rejected_error(message: &str) -> Value {
    json!({
        "type": "rejected",
        "name": "Error",
        "message": message,
    })
}

/// Evaluates the fixture `shouldRetry` spec for a zero-based attempt index.
///
/// # Arguments
///
/// * `spec` - Parsed `shouldRetry` callback behavior from fixture args.
/// * `attempt` - Zero-based index of the current failed attempt.
///
/// # Returns
///
/// `true` when another retry should proceed; `false` when the callback vetoes retry.
fn decide_should_retry(spec: &ShouldRetrySpec, attempt: u32) -> bool {
    match spec {
        ShouldRetrySpec::Always => true,
        ShouldRetrySpec::Never => false,
        ShouldRetrySpec::VetoAt(veto) => !veto.contains(&attempt),
    }
}

/// Formats the event token recorded at the start of each attempt.
///
/// # Arguments
///
/// * `attempt` - Zero-based attempt index.
///
/// # Returns
///
/// Event string of the form `call:{n}`.
fn format_call_event(attempt: u32) -> String {
    format!("call:{attempt}")
}

/// Formats the event token for a `shouldRetry` callback result.
///
/// # Arguments
///
/// * `attempt` - Zero-based attempt index.
/// * `result` - Whether the callback allowed another retry.
///
/// # Returns
///
/// Event string of the form `shouldRetry:{n}={bool}`.
fn format_should_retry_event(attempt: u32, result: bool) -> String {
    format!("shouldRetry:{attempt}={result}")
}

/// Formats the event token for an `onRetry` callback.
///
/// # Arguments
///
/// * `attempt` - Zero-based attempt index about to be retried.
///
/// # Returns
///
/// Event string of the form `onRetry:{n}`.
fn format_on_retry_event(attempt: u32) -> String {
    format!("onRetry:{attempt}")
}

/// Formats the event token for a recorded delay.
///
/// No real sleep occurs — this token records the policy-computed delay only.
///
/// # Arguments
///
/// * `ms` - Delay duration in milliseconds.
///
/// # Returns
///
/// Event string of the form `sleep:{ms}`.
fn format_sleep_event(ms: u64) -> String {
    format!("sleep:{ms}")
}

/// Parses `withRetry` fixture args into a runnable [`Scenario`].
///
/// # Arguments
///
/// * `input` - Fixture input whose `args` must include a non-empty `attempts` array.
///
/// # Returns
///
/// A [`Scenario`] ready for [`run_scenario`], or an error string when required fields are missing or invalid.
fn parse_scenario(input: &FixtureInput) -> Result<Scenario, String> {
    let attempts_val = input
        .args
        .get("attempts")
        .ok_or_else(|| "withRetry args.attempts is required".to_owned())?;
    let attempts_arr = attempts_val
        .as_array()
        .ok_or_else(|| "withRetry args.attempts must be an array".to_owned())?;
    if attempts_arr.is_empty() {
        return Err("withRetry args.attempts must be non-empty".to_owned());
    }

    let mut attempts = Vec::with_capacity(attempts_arr.len());
    for (i, item) in attempts_arr.iter().enumerate() {
        let obj = item
            .as_object()
            .ok_or_else(|| format!("withRetry args.attempts[{i}] must be an object"))?;
        attempts.push(parse_attempt(obj, i)?);
    }

    let policy = parse_policy(input.args.get("options"))?;
    let should_retry = parse_should_retry(input.args.get("shouldRetry"))?;
    let on_retry = match input.args.get("onRetry") {
        None => false,
        Some(Value::Bool(true)) => true,
        Some(_) => {
            return Err("withRetry args.onRetry must be true when present".to_owned());
        }
    };

    Ok(Scenario {
        attempts,
        policy,
        should_retry,
        on_retry,
    })
}

/// Parses one attempt object from the `attempts` array.
///
/// Exactly one of `resolve`, `throw`, or `throwRaw` must be present.
///
/// # Arguments
///
/// * `obj` - JSON object for a single attempt entry.
/// * `index` - Zero-based index within `attempts`, used in error messages.
///
/// # Returns
///
/// An [`AttemptSpec`] describing the scripted outcome, or an error string when shape rules are violated.
fn parse_attempt(obj: &Map<String, Value>, index: usize) -> Result<AttemptSpec, String> {
    let has_resolve = obj.contains_key("resolve");
    let has_throw = obj.contains_key("throw");
    let has_throw_raw = obj.contains_key("throwRaw");
    let count = usize::from(has_resolve) + usize::from(has_throw) + usize::from(has_throw_raw);
    if count != 1 {
        return Err(format!(
            "withRetry args.attempts[{index}] must have exactly one of resolve, throw, throwRaw"
        ));
    }
    if has_resolve {
        return Ok(AttemptSpec::Resolve(obj["resolve"].clone()));
    }
    if has_throw {
        let message = obj["throw"]
            .as_str()
            .ok_or_else(|| format!("withRetry args.attempts[{index}].throw must be a string"))?;
        return Ok(AttemptSpec::Throw(message.to_owned()));
    }
    Ok(AttemptSpec::ThrowRaw(obj["throwRaw"].clone()))
}

/// Parses optional `options` into a [`RetryPolicy`].
///
/// Missing `options` yields SDK defaults (`maxRetries: 2`, `initialDelay: 500`, `backoffStrategy: fixed`).
///
/// # Arguments
///
/// * `options` - Optional JSON value from `args.options`; `None` selects defaults.
///
/// # Returns
///
/// A configured [`RetryPolicy`], or an error string when option types or enum values are invalid.
fn parse_policy(options: Option<&Value>) -> Result<RetryPolicy, String> {
    let mut policy = RetryPolicy::default();
    let Some(options) = options else {
        return Ok(policy);
    };
    let obj = options
        .as_object()
        .ok_or_else(|| "withRetry args.options must be an object".to_owned())?;

    if let Some(v) = obj.get("maxRetries") {
        let n = v.as_u64().ok_or_else(|| {
            "withRetry args.options.maxRetries must be a non-negative integer".to_owned()
        })?;
        policy.max_retries = u32::try_from(n)
            .map_err(|_| "withRetry args.options.maxRetries exceeds u32".to_owned())?;
    }
    if let Some(v) = obj.get("initialDelay") {
        policy.initial_delay_ms = v.as_u64().ok_or_else(|| {
            "withRetry args.options.initialDelay must be a non-negative integer".to_owned()
        })?;
    }
    if let Some(v) = obj.get("backoffStrategy") {
        let s = v
            .as_str()
            .ok_or_else(|| "withRetry args.options.backoffStrategy must be a string".to_owned())?;
        policy.backoff = match s {
            "fixed" => Backoff::Fixed,
            "linear" => Backoff::Linear,
            "exponential" => Backoff::Exponential,
            other => {
                return Err(format!(
                    "withRetry args.options.backoffStrategy must be fixed|linear|exponential, got {other}"
                ));
            }
        };
    }
    Ok(policy)
}

/// Parses the optional `shouldRetry` fixture argument.
///
/// # Arguments
///
/// * `value` - JSON value from `args.shouldRetry`, or `None` when the key is absent.
///
/// # Returns
///
/// `None` when the key is absent; `Some(ShouldRetrySpec)` when present, or an error string for unsupported shapes.
fn parse_should_retry(value: Option<&Value>) -> Result<Option<ShouldRetrySpec>, String> {
    let Some(value) = value else {
        return Ok(None);
    };
    match value {
        Value::String(s) if s == "always" => Ok(Some(ShouldRetrySpec::Always)),
        Value::String(s) if s == "never" => Ok(Some(ShouldRetrySpec::Never)),
        Value::Object(obj) => {
            let veto = obj
                .get("vetoAt")
                .ok_or_else(|| "withRetry args.shouldRetry object requires vetoAt".to_owned())?
                .as_array()
                .ok_or_else(|| "withRetry args.shouldRetry.vetoAt must be an array".to_owned())?;
            let mut attempts = Vec::with_capacity(veto.len());
            for (i, item) in veto.iter().enumerate() {
                let n = item.as_u64().ok_or_else(|| {
                    format!("withRetry args.shouldRetry.vetoAt[{i}] must be a non-negative integer")
                })?;
                attempts.push(
                    u32::try_from(n).map_err(|_| {
                        format!("withRetry args.shouldRetry.vetoAt[{i}] exceeds u32")
                    })?,
                );
            }
            Ok(Some(ShouldRetrySpec::VetoAt(attempts)))
        }
        _ => Err(
            "withRetry args.shouldRetry must be \"always\", \"never\", or { vetoAt: number[] }"
                .to_owned(),
        ),
    }
}

/// Mirrors JavaScript `String(value)` for JSON-representable throwables used by fixtures.
///
/// Arrays and objects coerce to `"[object Object]"` to match host-side behavior.
///
/// # Arguments
///
/// * `value` - JSON value thrown as a non-`Error` throwable in a fixture.
///
/// # Returns
///
/// The coerced string representation.
fn js_string_coerce(value: &Value) -> String {
    match value {
        Value::Null => "null".to_owned(),
        Value::Bool(b) => b.to_string(),
        Value::Number(n) => n.to_string(),
        Value::String(s) => s.clone(),
        Value::Array(_) | Value::Object(_) => "[object Object]".to_owned(),
    }
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;
    use crate::model::FixtureInput;
    use serde_json::json;
    use std::collections::BTreeMap;

    fn fixture_input(args: Value) -> FixtureInput {
        let map: BTreeMap<String, Value> = args
            .as_object()
            .expect("args object")
            .iter()
            .map(|(k, v)| (k.clone(), v.clone()))
            .collect();
        FixtureInput {
            fn_name: "withRetry".to_owned(),
            args: map,
            clock: None,
            rng_seed: None,
        }
    }

    fn invoke(args: Value) -> Value {
        invoke_with_retry(&fixture_input(args)).expect("invoke")
    }

    #[test]
    fn scenario_defaults_match_contract() {
        let scenario = parse_scenario(&fixture_input(json!({
            "attempts": [{ "throw": "boom" }]
        })))
        .unwrap();
        assert_eq!(scenario.policy.max_retries, 2);
        assert_eq!(scenario.policy.initial_delay_ms, 500);
        assert_eq!(scenario.policy.backoff, Backoff::Fixed);
        assert!(scenario.should_retry.is_none());
        assert!(!scenario.on_retry);
    }

    #[test]
    fn callback_order_should_retry_then_on_retry_then_sleep() {
        let result = invoke(json!({
            "attempts": [
                { "throw": "boom" },
                { "throw": "boom" },
                { "throw": "boom" }
            ],
            "options": { "maxRetries": 2 },
            "shouldRetry": "always",
            "onRetry": true
        }));
        assert_eq!(
            result["events"],
            json!([
                "call:0",
                "shouldRetry:0=true",
                "onRetry:0",
                "sleep:500",
                "call:1",
                "shouldRetry:1=true",
                "onRetry:1",
                "sleep:500",
                "call:2"
            ])
        );
    }

    #[test]
    fn last_attempt_omits_callbacks() {
        let result = invoke(json!({
            "attempts": [{ "throw": "boom" }, { "throw": "boom" }],
            "options": { "maxRetries": 1 },
            "shouldRetry": "always",
            "onRetry": true
        }));
        assert_eq!(
            result["events"],
            json!([
                "call:0",
                "shouldRetry:0=true",
                "onRetry:0",
                "sleep:500",
                "call:1"
            ])
        );
    }

    #[test]
    fn exhausted_scenario_records_diagnostic_rejection() {
        let result = invoke(json!({
            "attempts": [{ "throw": "boom" }],
            "options": { "maxRetries": 2 }
        }));
        // After first throw, policy allows retry but no attempt spec remains.
        assert_eq!(
            result["outcome"]["message"],
            "withRetry scenario exhausted attempts at call:1"
        );
        assert_eq!(result["events"], json!(["call:0", "sleep:500", "call:1"]));
    }

    #[test]
    fn raw_throwable_normalization() {
        assert_eq!(js_string_coerce(&json!("boom")), "boom");
        assert_eq!(js_string_coerce(&json!({})), "[object Object]");
        let result = invoke(json!({
            "attempts": [{ "throwRaw": {} }],
            "options": { "maxRetries": 0 }
        }));
        assert_eq!(result["outcome"]["message"], "[object Object]");
    }
}
