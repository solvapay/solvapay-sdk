//! MCP account widget state machine (states A–J) and default view.

#![allow(clippy::missing_docs_in_private_items)]

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::helper_error::HelperErrorResult;
use crate::pricing_options::{billing_cycle, charges, counts_usage, included_units, trial_days};
use crate::purchase::select_active_plan_purchase;
use crate::utc::rfc3339_utc_ms;

/// Narrator plan shape used by account-state precedence.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum NarratorPlanShape {
    /// Free trial.
    Trial,
    /// Free plan.
    Free,
    /// Recurring with a metered rate.
    #[serde(rename = "recurring-metered")]
    RecurringMetered,
    /// Recurring without a finite meter.
    #[serde(rename = "recurring-unlimited")]
    RecurringUnlimited,
    /// Usage-based / PAYG.
    #[serde(rename = "usage-based")]
    UsageBased,
    /// Paid plan whose options are not readable enough to classify further.
    #[serde(rename = "paid-unknown")]
    PaidUnknown,
}

/// Merge a live catalog plan over a frozen snapshot. `isMetered` comes
/// only from the snapshot — the catalog never carries it.
#[must_use]
pub fn merge_plan(snapshot: Option<&Value>, catalog: Option<&Value>) -> Option<Value> {
    let snapshot = snapshot.filter(|v| !v.is_null());
    let catalog = catalog.filter(|v| !v.is_null());
    match (snapshot, catalog) {
        (None, None) => None,
        (Some(snapshot), None) => Some(snapshot.clone()),
        (None, Some(catalog)) => Some(catalog.clone()),
        (Some(snapshot), Some(catalog)) => {
            let mut merged = catalog.clone();
            if let (Some(merged_obj), Some(snap_obj)) =
                (merged.as_object_mut(), snapshot.as_object())
            {
                if let Some(is_metered) = snap_obj.get("isMetered") {
                    merged_obj.insert("isMetered".to_owned(), is_metered.clone());
                } else {
                    merged_obj.remove("isMetered");
                }
            }
            Some(merged)
        }
    }
}

fn is_paid_plan(plan: &Value) -> bool {
    if plan.get("requiresPayment") == Some(&Value::Bool(false)) {
        return false;
    }
    if charges(Some(plan))
        .iter()
        .any(|charge| charge.amount_minor > 0.0)
    {
        return true;
    }
    plan.get("price").and_then(Value::as_f64).unwrap_or(0.0) > 0.0
}

fn has_readable_options(plan: &Value) -> bool {
    plan.get("options")
        .and_then(Value::as_array)
        .is_some_and(|opts| !opts.is_empty())
}

/// Resolve the narrator plan shape from a priced plan / snapshot.
#[must_use]
#[crate::solvapay_export(
    id = "resolvePlanShape",
    artifact = "decisions",
    catalog = "none",
    section = "mcp-account",
    emit_order = 60,
    rust_fn_name = "resolve_plan_shape_binding"
)]
pub fn resolve_narrator_plan_shape(priced: Option<&Value>) -> Option<NarratorPlanShape> {
    let priced = priced.filter(|v| !v.is_null())?;
    if priced.get("trialing") == Some(&Value::Bool(true))
        || trial_days(Some(priced)).is_some_and(|days| days > 0)
    {
        return Some(NarratorPlanShape::Trial);
    }
    if !is_paid_plan(priced) {
        return Some(NarratorPlanShape::Free);
    }
    let metered = priced.get("isMetered") == Some(&Value::Bool(true)) || counts_usage(Some(priced));
    let unlimited_cap = included_units(Some(priced), None) == Some(0);
    let readable = has_readable_options(priced);
    if billing_cycle(Some(priced)).is_some() {
        if metered && !unlimited_cap {
            return Some(NarratorPlanShape::RecurringMetered);
        }
        if unlimited_cap || (readable && !metered) {
            return Some(NarratorPlanShape::RecurringUnlimited);
        }
        return Some(NarratorPlanShape::PaidUnknown);
    }
    if metered && !unlimited_cap {
        return Some(NarratorPlanShape::UsageBased);
    }
    if unlimited_cap || (readable && !metered) {
        return Some(NarratorPlanShape::RecurringUnlimited);
    }
    Some(NarratorPlanShape::PaidUnknown)
}

fn is_at_finite_cap(limits: Option<&Value>) -> bool {
    let Some(limits) = limits.filter(|v| !v.is_null()) else {
        return false;
    };
    if limits.get("withinLimits") != Some(&Value::Bool(false)) {
        return false;
    }
    let Some(remaining) = limits.get("remaining").and_then(Value::as_f64) else {
        return false;
    };
    remaining != -1.0 && remaining <= 0.0
}

fn is_cancelled_not_expired(purchase: Option<&Value>, now_ms: Option<f64>) -> bool {
    let Some(purchase) = purchase.filter(|v| !v.is_null()) else {
        return false;
    };
    if purchase
        .get("cancelledAt")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .is_none()
    {
        return false;
    }
    let Some(end_date) = purchase.get("endDate").and_then(Value::as_str) else {
        return false;
    };
    let Some(end) = rfc3339_utc_ms(end_date) else {
        return false;
    };
    let now = now_ms.unwrap_or(0.0);
    end > now
}

/// Resolve account state A–J.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-account",
    emit_order = 61
)]
pub fn resolve_account_state(input: Option<&Value>) -> String {
    let Some(input) = input.filter(|v| !v.is_null()) else {
        return "A".to_owned();
    };
    if input.get("loading") == Some(&Value::Bool(true)) {
        return "G".to_owned();
    }
    let limits = input.get("limits");
    if limits.and_then(|l| l.get("activationRequired")) == Some(&Value::Bool(true)) {
        return "H".to_owned();
    }
    let now_ms = input.get("nowMs").and_then(Value::as_f64);
    if is_cancelled_not_expired(input.get("purchase"), now_ms) {
        return "J".to_owned();
    }
    if limits.and_then(|l| l.get("overage")) == Some(&Value::Bool(true)) {
        return "I".to_owned();
    }
    if limits.and_then(|l| l.get("needsTopUp")) == Some(&Value::Bool(true)) {
        return "D".to_owned();
    }
    let shape = input
        .get("planShape")
        .and_then(|v| serde_json::from_value::<NarratorPlanShape>(v.clone()).ok())
        .or_else(|| {
            resolve_narrator_plan_shape(input.get("purchase").and_then(|p| p.get("planSnapshot")))
        });
    let has_purchase = input.get("purchase").is_some_and(|p| !p.is_null());
    if !has_purchase && shape.is_none() {
        return "A".to_owned();
    }
    let at_cap = is_at_finite_cap(limits);
    if shape == Some(NarratorPlanShape::UsageBased) {
        if at_cap || limits.and_then(|l| l.get("withinLimits")) == Some(&Value::Bool(false)) {
            return "D".to_owned();
        }
        return "B".to_owned();
    }
    if at_cap {
        return "F".to_owned();
    }
    if matches!(
        shape,
        Some(NarratorPlanShape::Free | NarratorPlanShape::Trial)
    ) {
        return "E".to_owned();
    }
    if matches!(
        shape,
        Some(
            NarratorPlanShape::RecurringMetered
                | NarratorPlanShape::RecurringUnlimited
                | NarratorPlanShape::PaidUnknown
        )
    ) || has_purchase
    {
        return "C".to_owned();
    }
    "A".to_owned()
}

/// Default MCP widget view from account facts and enabled views.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-account",
    emit_order = 62
)]
pub fn derive_default_view(input: Option<&Value>) -> Result<String, HelperErrorResult> {
    let input = input
        .filter(|v| !v.is_null())
        .ok_or_else(|| HelperErrorResult::transport("derive_default_view input is required"))?;
    let enabled = input
        .get("enabledViews")
        .and_then(Value::as_array)
        .map(|arr| {
            arr.iter()
                .filter_map(Value::as_str)
                .map(str::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_else(|| vec!["checkout".into(), "topup".into(), "account".into()]);
    let product_ref = input.get("productRef").and_then(Value::as_str);
    let has_active_plan = input
        .get("hasActivePlan")
        .and_then(Value::as_bool)
        .unwrap_or_else(|| {
            select_active_plan_purchase(input.get("purchases"), product_ref).is_some()
        });
    let preferred = if !has_active_plan {
        "checkout"
    } else if input.get("credits").and_then(Value::as_f64) == Some(0.0) {
        "topup"
    } else {
        "account"
    };
    let order = [preferred, "checkout", "topup", "account"];
    for view in order {
        if enabled.iter().any(|item| item == view) {
            return Ok(view.to_owned());
        }
    }
    Err(HelperErrorResult::without_details(
        "No MCP views are enabled",
        400,
    ))
}
