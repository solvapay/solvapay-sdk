//! Top-up payment-intent process driver.
//!
//! Hosts own `syncCustomer`, `getCustomerBalance`, `processPaymentIntent`,
//! and `sleep`. This module owns validation, the decision to skip polling,
//! and the two soft-success policies (missing baseline / exhausted poll).

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::balance_poll::{evaluate_balance_observation, BalancePollPolicy};
use crate::helper_error::HelperErrorResult;
use crate::payment::{project_topup_process_outcome, validate_attach_business_details_params};

/// Driver state between top-up process steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupProcessState {
    /// Processor payment intent id.
    pub payment_intent_id: String,
    /// Synced customer ref, once known.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub customer_ref: Option<String>,
    /// Host can call `getCustomerBalance`.
    pub can_get_balance: bool,
    /// Baseline credits captured before `/process`. Absent means skip polling.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub baseline_credits: Option<f64>,
    /// Zero-based poll attempt index into [`BalancePollPolicy::topup`].
    pub poll_attempt: u32,
    /// Which result event the driver is waiting for.
    pub pending: TopupPending,
}

/// In-flight step the next host event must complete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum TopupPending {
    /// Terminal.
    #[default]
    None,
    /// Waiting for `syncCustomerResult`.
    SyncCustomer,
    /// Waiting for the baseline `balanceResult`.
    BaselineBalance,
    /// Waiting for `processPaymentResult`.
    ProcessPayment,
    /// Waiting for `sleepDone` before the next poll.
    Sleep,
    /// Waiting for a poll `balanceResult`.
    PollBalance,
}

/// Next host action or a terminal resolve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum TopupProcessAction {
    /// Host calls `syncCustomer`.
    SyncCustomer,
    /// Host calls `getCustomerBalance` (baseline or poll).
    #[serde(rename_all = "camelCase")]
    GetCustomerBalance {
        /// Synced customer ref.
        customer_ref: String,
    },
    /// Host calls `processPaymentIntent`.
    #[serde(rename_all = "camelCase")]
    ProcessPaymentIntent {
        /// Processor payment intent id.
        payment_intent_id: String,
        /// Synced customer ref.
        customer_ref: String,
    },
    /// Host sleeps `ms` then sends `sleepDone`.
    Sleep {
        /// Delay in milliseconds.
        ms: u64,
    },
    /// Terminal outcome. Host returns this to the caller.
    #[serde(rename_all = "camelCase")]
    Resolved {
        /// Narrowed process status.
        status: String,
        /// Timeout message (skip-absent).
        #[serde(skip_serializing_if = "Option::is_none")]
        message: Option<String>,
        /// Observed credit delta (skip-absent).
        #[serde(skip_serializing_if = "Option::is_none")]
        credits_added: Option<f64>,
    },
}

/// Driver output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TopupProcessNextOutput {
    /// State to pass into the next call.
    pub state: TopupProcessState,
    /// Host action or terminal result.
    pub action: TopupProcessAction,
}

/// Advance top-up processing by one step.
///
/// # Arguments
///
/// * `state` - Previous state, or `None` on `start`.
/// * `event` - Host event tagged with `kind`.
///
/// # Errors
///
/// [`HelperErrorResult`] on missing payment intent id or malformed events.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "payment",
    emit_order = 16
)]
pub fn topup_process_next(
    state: Option<&Value>,
    event: Option<&Value>,
) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    let event = event
        .ok_or_else(|| HelperErrorResult::transport("topup_process_next event is required"))?;
    let kind = event
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| HelperErrorResult::transport("topup_process_next event.kind is required"))?;
    match kind {
        "start" => start(event),
        "syncCustomerResult" => on_sync_customer(require_state(state)?, event),
        "balanceResult" => on_balance_result(require_state(state)?, event),
        "processPaymentResult" => on_process_payment(require_state(state)?, event),
        "sleepDone" => on_sleep_done(require_state(state)?),
        other => Err(HelperErrorResult::transport(format!(
            "topup_process_next unknown event kind: {other}"
        ))),
    }
}

fn start(event: &Value) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    let payment_intent_id = event
        .get("paymentIntentId")
        .and_then(Value::as_str)
        .unwrap_or("");
    if let Some(err) = validate_attach_business_details_params(Some(payment_intent_id)) {
        return Err(err);
    }
    Ok(TopupProcessNextOutput {
        state: TopupProcessState {
            payment_intent_id: payment_intent_id.to_owned(),
            customer_ref: None,
            can_get_balance: false,
            baseline_credits: None,
            poll_attempt: 0,
            pending: TopupPending::SyncCustomer,
        },
        action: TopupProcessAction::SyncCustomer,
    })
}

fn on_sync_customer(
    mut state: TopupProcessState,
    event: &Value,
) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    require_pending(&state, TopupPending::SyncCustomer)?;
    let customer_ref = require_str(event, "customerRef")?;
    let can_get_balance = event
        .get("canGetBalance")
        .and_then(Value::as_bool)
        .unwrap_or(false);
    state.customer_ref = Some(customer_ref.clone());
    state.can_get_balance = can_get_balance;
    if can_get_balance {
        state.pending = TopupPending::BaselineBalance;
        Ok(TopupProcessNextOutput {
            action: TopupProcessAction::GetCustomerBalance { customer_ref },
            state,
        })
    } else {
        state.pending = TopupPending::ProcessPayment;
        process_action(state)
    }
}

fn on_balance_result(
    mut state: TopupProcessState,
    event: &Value,
) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    match state.pending {
        TopupPending::BaselineBalance => {
            state.baseline_credits = event.get("credits").and_then(Value::as_f64);
            state.pending = TopupPending::ProcessPayment;
            process_action(state)
        }
        TopupPending::PollBalance => {
            let baseline = state.baseline_credits.ok_or_else(|| {
                HelperErrorResult::transport("topup_process_next poll without baseline")
            })?;
            if let Some(credits) = event.get("credits").and_then(Value::as_f64) {
                if let Some(delta) = evaluate_balance_observation(baseline, credits) {
                    return Ok(resolved(state, "succeeded".to_owned(), None, Some(delta)));
                }
            }
            state.poll_attempt = state.poll_attempt.saturating_add(1);
            next_poll_or_soft_success(state)
        }
        other => Err(HelperErrorResult::transport(format!(
            "topup_process_next unexpected balanceResult (pending {other:?})"
        ))),
    }
}

fn on_process_payment(
    state: TopupProcessState,
    event: &Value,
) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    require_pending(&state, TopupPending::ProcessPayment)?;
    let status = event.get("status").and_then(Value::as_str);
    let message = event.get("message").and_then(Value::as_str);
    let outcome = project_topup_process_outcome(status, message);
    if outcome.status != "succeeded" {
        return Ok(resolved(state, outcome.status, outcome.message, None));
    }
    if state.baseline_credits.is_none() || !state.can_get_balance {
        return Ok(resolved(state, "succeeded".to_owned(), None, None));
    }
    next_poll_or_soft_success(state)
}

fn on_sleep_done(state: TopupProcessState) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    require_pending(&state, TopupPending::Sleep)?;
    let customer_ref = state.customer_ref.clone().ok_or_else(|| {
        HelperErrorResult::transport("topup_process_next sleepDone missing customerRef")
    })?;
    let mut state = state;
    state.pending = TopupPending::PollBalance;
    Ok(TopupProcessNextOutput {
        action: TopupProcessAction::GetCustomerBalance { customer_ref },
        state,
    })
}

fn next_poll_or_soft_success(
    mut state: TopupProcessState,
) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    match BalancePollPolicy::topup().next_delay(state.poll_attempt) {
        Some(ms) => {
            state.pending = TopupPending::Sleep;
            Ok(TopupProcessNextOutput {
                action: TopupProcessAction::Sleep { ms },
                state,
            })
        }
        None => Ok(resolved(state, "succeeded".to_owned(), None, None)),
    }
}

fn process_action(state: TopupProcessState) -> Result<TopupProcessNextOutput, HelperErrorResult> {
    let customer_ref = state.customer_ref.clone().ok_or_else(|| {
        HelperErrorResult::transport("topup_process_next process missing customerRef")
    })?;
    let payment_intent_id = state.payment_intent_id.clone();
    Ok(TopupProcessNextOutput {
        action: TopupProcessAction::ProcessPaymentIntent {
            payment_intent_id,
            customer_ref,
        },
        state,
    })
}

fn resolved(
    mut state: TopupProcessState,
    status: String,
    message: Option<String>,
    credits_added: Option<f64>,
) -> TopupProcessNextOutput {
    state.pending = TopupPending::None;
    TopupProcessNextOutput {
        action: TopupProcessAction::Resolved {
            status,
            message,
            credits_added,
        },
        state,
    }
}

fn require_state(state: Option<&Value>) -> Result<TopupProcessState, HelperErrorResult> {
    let value = state
        .ok_or_else(|| HelperErrorResult::transport("topup_process_next state is required"))?;
    serde_json::from_value(value.clone()).map_err(|err| {
        HelperErrorResult::transport(format!("topup_process_next invalid state: {err}"))
    })
}

fn require_pending(
    state: &TopupProcessState,
    expected: TopupPending,
) -> Result<(), HelperErrorResult> {
    if state.pending == expected {
        Ok(())
    } else {
        Err(HelperErrorResult::transport(format!(
            "topup_process_next expected pending {expected:?}, got {:?}",
            state.pending
        )))
    }
}

fn require_str(value: &Value, key: &str) -> Result<String, HelperErrorResult> {
    value
        .get(key)
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .ok_or_else(|| {
            HelperErrorResult::transport(format!("topup_process_next {key} is required"))
        })
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
    use serde_json::json;

    fn start_ok() -> TopupProcessNextOutput {
        topup_process_next(
            None,
            Some(&json!({ "kind": "start", "paymentIntentId": "pi_1" })),
        )
        .unwrap()
    }

    #[test]
    fn start_requests_sync() {
        match start_ok().action {
            TopupProcessAction::SyncCustomer => {}
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn start_missing_pi_fails() {
        let err = topup_process_next(None, Some(&json!({ "kind": "start" }))).unwrap_err();
        assert_eq!(err.error, "paymentIntentId is required");
        assert_eq!(err.status, 400);
    }

    #[test]
    fn no_balance_capability_skips_baseline() {
        let started = start_ok();
        let out = topup_process_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({
                "kind": "syncCustomerResult",
                "customerRef": "cus_1",
                "canGetBalance": false,
            })),
        )
        .unwrap();
        match out.action {
            TopupProcessAction::ProcessPaymentIntent { customer_ref, .. } => {
                assert_eq!(customer_ref, "cus_1");
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn succeeded_without_baseline_is_soft_success() {
        let started = start_ok();
        let synced = topup_process_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({
                "kind": "syncCustomerResult",
                "customerRef": "cus_1",
                "canGetBalance": true,
            })),
        )
        .unwrap();
        let after_baseline = topup_process_next(
            Some(&serde_json::to_value(&synced.state).unwrap()),
            Some(&json!({ "kind": "balanceResult" })),
        )
        .unwrap();
        let out = topup_process_next(
            Some(&serde_json::to_value(&after_baseline.state).unwrap()),
            Some(&json!({ "kind": "processPaymentResult", "status": "succeeded" })),
        )
        .unwrap();
        match out.action {
            TopupProcessAction::Resolved {
                status,
                credits_added,
                ..
            } => {
                assert_eq!(status, "succeeded");
                assert!(credits_added.is_none());
            }
            other => panic!("unexpected {other:?}"),
        }
    }

    #[test]
    fn poll_observes_delta() {
        let started = start_ok();
        let synced = topup_process_next(
            Some(&serde_json::to_value(&started.state).unwrap()),
            Some(&json!({
                "kind": "syncCustomerResult",
                "customerRef": "cus_1",
                "canGetBalance": true,
            })),
        )
        .unwrap();
        let after_baseline = topup_process_next(
            Some(&serde_json::to_value(&synced.state).unwrap()),
            Some(&json!({ "kind": "balanceResult", "credits": 100.0 })),
        )
        .unwrap();
        let after_process = topup_process_next(
            Some(&serde_json::to_value(&after_baseline.state).unwrap()),
            Some(&json!({ "kind": "processPaymentResult", "status": "succeeded" })),
        )
        .unwrap();
        match &after_process.action {
            TopupProcessAction::Sleep { ms } => assert_eq!(*ms, 500),
            other => panic!("unexpected {other:?}"),
        }
        let after_sleep = topup_process_next(
            Some(&serde_json::to_value(&after_process.state).unwrap()),
            Some(&json!({ "kind": "sleepDone" })),
        )
        .unwrap();
        let out = topup_process_next(
            Some(&serde_json::to_value(&after_sleep.state).unwrap()),
            Some(&json!({ "kind": "balanceResult", "credits": 250.0 })),
        )
        .unwrap();
        match out.action {
            TopupProcessAction::Resolved {
                status,
                credits_added,
                ..
            } => {
                assert_eq!(status, "succeeded");
                assert_eq!(credits_added, Some(150.0));
            }
            other => panic!("unexpected {other:?}"),
        }
    }
}
