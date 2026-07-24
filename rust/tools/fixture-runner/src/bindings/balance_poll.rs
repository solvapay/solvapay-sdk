//! Host-side `pollBalanceUntilIncreased` fixture adapter (Step 28).
//!
//! Uses [`solvapay_core::BalancePollPolicy`] / [`solvapay_core::evaluate_balance_observation`]
//! for delay selection and increase detection; timers and `getBalance` stay here
//! (no real sleep — delays are recorded only).

use serde_json::{json, Map, Number, Value};
use solvapay_core::{
    evaluate_balance_observation, BALANCE_RECONCILE_DELAYS_MS, TOPUP_BALANCE_POLL_DELAYS_MS,
};

use crate::model::FixtureInput;
use crate::runner::BindingError;

/// Runs a scripted balance-poll scenario from fixture args.
///
/// # Arguments
///
/// * `input` - Fixture input whose `args` describe baseline, observations, and delays.
///
/// # Returns
///
/// Observation JSON `{ delays, result }` on success.
///
/// # Errors
///
/// Returns [`BindingError::Harness`] when fixture args fail validation.
pub(super) fn invoke_poll_balance_until_increased(
    input: &FixtureInput,
) -> Result<Value, BindingError> {
    let scenario = parse_scenario(input)?;
    Ok(run_scenario(&scenario))
}

/// Binding for the `TOPUP_BALANCE_POLL_DELAYS_MS` constant fixture.
///
/// # Arguments
///
/// * `_input` - Unused; const fixtures take empty args.
///
/// # Returns
///
/// JSON array of top-up poll delays.
///
/// # Errors
///
/// Never fails.
pub(super) fn invoke_topup_delays(_input: &FixtureInput) -> Result<Value, BindingError> {
    Ok(json!(TOPUP_BALANCE_POLL_DELAYS_MS.as_slice()))
}

/// Binding for the `BALANCE_RECONCILE_DELAYS_MS` constant fixture.
///
/// # Arguments
///
/// * `_input` - Unused; const fixtures take empty args.
///
/// # Returns
///
/// JSON array of reconcile poll delays.
///
/// # Errors
///
/// Never fails.
pub(super) fn invoke_reconcile_delays(_input: &FixtureInput) -> Result<Value, BindingError> {
    Ok(json!(BALANCE_RECONCILE_DELAYS_MS.as_slice()))
}

/// One scripted balance observation in a poll fixture.
#[derive(Debug, Clone)]
enum ObservationSpec {
    /// Successful `getBalance` returning this credit count.
    Credits(f64),
    /// `getBalance` throws; host swallows and continues (message unused).
    Throw,
}

/// Parsed balance-poll fixture scenario.
#[derive(Debug)]
struct Scenario {
    /// Credits before polling began.
    baseline: f64,
    /// Ordered per-poll observations; exhausted calls are a harness error in TS,
    /// but the host loop stops when the delay table exhausts first.
    observations: Vec<ObservationSpec>,
    /// Delay policy (owned table for explicit arrays; static for named tables).
    delays: Vec<u64>,
}

/// Executes a parsed poll scenario, recording delays without sleeping.
///
/// # Arguments
///
/// * `scenario` - Parsed baseline, observations, and delay table.
///
/// # Returns
///
/// Observation JSON with `delays` and terminal `result` (`{ creditsAdded }` or `null`).
fn run_scenario(scenario: &Scenario) -> Value {
    let mut recorded_delays = Vec::new();
    let mut obs_index = 0usize;

    for &delay in &scenario.delays {
        recorded_delays.push(delay);

        match scenario.observations.get(obs_index) {
            Some(ObservationSpec::Throw) => {
                obs_index = obs_index.saturating_add(1);
                // Swallow — continue to next delay (mirrors TS empty catch).
            }
            Some(ObservationSpec::Credits(credits)) => {
                obs_index = obs_index.saturating_add(1);
                if let Some(delta) = evaluate_balance_observation(scenario.baseline, *credits) {
                    return observation_json(recorded_delays, Some(delta));
                }
            }
            None => {
                // No observation left; treat as continue (TS would throw from getBalance
                // and the empty catch would also continue). Keep looping.
            }
        }
    }

    observation_json(recorded_delays, None)
}

/// Builds the top-level observation object returned by the poll binding.
///
/// Whole-number `creditsAdded` values are emitted as JSON integers so
/// `serde_json::Value` deep equality matches TS fixture expects.
///
/// # Arguments
///
/// * `delays` - Recorded sleep durations in milliseconds.
/// * `credits_added` - Delta when an increase was observed; `None` → JSON `null`.
///
/// # Returns
///
/// JSON object with keys `delays` and `result`.
fn observation_json(delays: Vec<u64>, credits_added: Option<f64>) -> Value {
    let result = match credits_added {
        Some(delta) => json!({ "creditsAdded": whole_number_json(delta) }),
        None => Value::Null,
    };
    json!({
        "delays": delays,
        "result": result,
    })
}

/// Emit whole `f64` values as JSON integers for fixture parity.
///
/// # Arguments
///
/// * `value` - Numeric value to serialize.
///
/// # Returns
///
/// A JSON number (integer when `value` is whole).
fn whole_number_json(value: f64) -> Value {
    if value.is_finite() && value.fract() == 0.0 {
        // Safe: whole finite f64 in i64 range for credit deltas used by fixtures.
        if let Some(n) = Number::from_i128(value as i128) {
            return Value::Number(n);
        }
    }
    json!(value)
}

/// Parses `pollBalanceUntilIncreased` fixture args into a runnable [`Scenario`].
///
/// # Arguments
///
/// * `input` - Fixture input whose `args` must include `baseline` and `observations`.
///
/// # Returns
///
/// A [`Scenario`] ready for [`run_scenario`], or an error when fields are invalid.
fn parse_scenario(input: &FixtureInput) -> Result<Scenario, String> {
    let baseline = input
        .args
        .get("baseline")
        .and_then(Value::as_f64)
        .ok_or_else(|| "pollBalanceUntilIncreased args.baseline must be a number".to_owned())?;

    let observations_val = input
        .args
        .get("observations")
        .ok_or_else(|| "pollBalanceUntilIncreased args.observations is required".to_owned())?;
    let observations_arr = observations_val
        .as_array()
        .ok_or_else(|| "pollBalanceUntilIncreased args.observations must be an array".to_owned())?;

    let mut observations = Vec::with_capacity(observations_arr.len());
    for (i, item) in observations_arr.iter().enumerate() {
        let obj = item.as_object().ok_or_else(|| {
            format!("pollBalanceUntilIncreased args.observations[{i}] must be an object")
        })?;
        observations.push(parse_observation(obj, i)?);
    }

    let delays = parse_delays(input.args.get("delays"))?;

    Ok(Scenario {
        baseline,
        observations,
        delays,
    })
}

/// Parses one observation object from the `observations` array.
///
/// Exactly one of `credits` or `throw` must be present.
///
/// # Arguments
///
/// * `obj` - JSON object for a single observation entry.
/// * `index` - Zero-based index within `observations`, used in error messages.
///
/// # Returns
///
/// An [`ObservationSpec`], or an error string when shape rules are violated.
fn parse_observation(obj: &Map<String, Value>, index: usize) -> Result<ObservationSpec, String> {
    let has_credits = obj.contains_key("credits");
    let has_throw = obj.contains_key("throw");
    if has_credits == has_throw {
        return Err(format!(
            "pollBalanceUntilIncreased args.observations[{index}] must have exactly one of credits, throw"
        ));
    }
    if has_throw {
        let _message = obj["throw"].as_str().ok_or_else(|| {
            format!("pollBalanceUntilIncreased args.observations[{index}].throw must be a string")
        })?;
        return Ok(ObservationSpec::Throw);
    }
    let credits = obj["credits"].as_f64().ok_or_else(|| {
        format!("pollBalanceUntilIncreased args.observations[{index}].credits must be a number")
    })?;
    Ok(ObservationSpec::Credits(credits))
}

/// Parses optional `delays` into an owned millisecond table.
///
/// Missing `delays` selects the reconcile table (TS default).
/// `"topup"` / `"reconcile"` select named tables; arrays are copied verbatim.
///
/// # Arguments
///
/// * `delays` - Optional JSON value from `args.delays`.
///
/// # Returns
///
/// Owned delay table, or an error string for unsupported shapes.
fn parse_delays(delays: Option<&Value>) -> Result<Vec<u64>, String> {
    match delays {
        None => Ok(BALANCE_RECONCILE_DELAYS_MS.to_vec()),
        Some(Value::String(s)) if s == "topup" => Ok(TOPUP_BALANCE_POLL_DELAYS_MS.to_vec()),
        Some(Value::String(s)) if s == "reconcile" => Ok(BALANCE_RECONCILE_DELAYS_MS.to_vec()),
        Some(Value::Array(arr)) => {
            let mut out = Vec::with_capacity(arr.len());
            for (i, item) in arr.iter().enumerate() {
                let n = item.as_u64().ok_or_else(|| {
                    format!(
                        "pollBalanceUntilIncreased args.delays[{i}] must be a non-negative integer"
                    )
                })?;
                out.push(n);
            }
            Ok(out)
        }
        Some(_) => Err(
            "pollBalanceUntilIncreased args.delays must be \"topup\", \"reconcile\", or number[]"
                .to_owned(),
        ),
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
            fn_name: "pollBalanceUntilIncreased".to_owned(),
            args: map,
            clock: None,
            rng_seed: None,
        }
    }

    #[test]
    fn parse_default_delays_is_reconcile() {
        let scenario = parse_scenario(&fixture_input(json!({
            "baseline": 400,
            "observations": [{ "credits": 400 }]
        })))
        .unwrap();
        assert_eq!(scenario.delays, BALANCE_RECONCILE_DELAYS_MS.to_vec());
    }

    #[test]
    fn whole_number_emits_integer() {
        let result = observation_json(vec![500], Some(9600.0));
        assert_eq!(result["result"]["creditsAdded"], json!(9600));
        assert!(result["result"]["creditsAdded"].as_i64().is_some());
    }
}
