//! A/F ladder copy — what happens at the limit, and whether a card is needed.

#![allow(clippy::missing_docs_in_private_items)]

use serde_json::Value;

use crate::helper_error::HelperErrorResult;
use crate::mcp::account_state::{resolve_narrator_plan_shape, NarratorPlanShape};
use crate::money_format::format_grouped_major;
use crate::pricing_options::{
    billing_cycle, credits_per_unit_from_balance, included_units, meter_name,
};

/// Display noun for an allowance meter. `requests` reads as "calls".
fn allowance_meter_unit(meter: Option<&str>, count: f64) -> String {
    match meter {
        Some(name) if name != "requests" => {
            if (count - 1.0).abs() < f64::EPSILON && name.ends_with('s') {
                name[..name.len() - 1].to_owned()
            } else {
                name.to_owned()
            }
        }
        _ if (count - 1.0).abs() < f64::EPSILON => "call".to_owned(),
        _ => "calls".to_owned(),
    }
}

fn is_one_time(plan: Option<&Value>) -> bool {
    billing_cycle(plan).is_none()
        && resolve_narrator_plan_shape(plan) != Some(NarratorPlanShape::UsageBased)
}

/// Ladder consequence line for a catalog plan or frozen snapshot.
///
/// # Errors
///
/// [`HelperErrorResult`] when a free/trial plan has no finite cap.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "mcp-account",
    emit_order = 64
)]
pub fn plan_consequence(
    plan: Option<&Value>,
    locale: Option<&str>,
    balance: Option<&Value>,
    merchant_name: Option<&str>,
) -> Result<String, HelperErrorResult> {
    let _locale = locale;
    let shape = resolve_narrator_plan_shape(plan);
    let meter = meter_name(plan);
    let interval = billing_cycle(plan)
        .map(|cycle| cycle.interval.to_string())
        .unwrap_or_else(|| "month".to_owned());

    if shape == Some(NarratorPlanShape::UsageBased) {
        return Ok(payg_consequence(plan, balance, merchant_name));
    }

    let cap = included_units(plan, None).map(|n| n as f64);
    let finite = cap.is_some_and(|n| n > 0.0);
    let unit = allowance_meter_unit(
        meter.as_deref(),
        if finite { cap.unwrap_or(2.0) } else { 2.0 },
    );

    if matches!(
        shape,
        Some(NarratorPlanShape::Free | NarratorPlanShape::Trial)
    ) {
        let Some(cap) = cap.filter(|n| *n > 0.0) else {
            let name = plan
                .and_then(|p| p.get("reference").or_else(|| p.get("name")))
                .and_then(Value::as_str)
                .unwrap_or("plan");
            return Err(HelperErrorResult::transport(format!(
                "Free/trial plan {name} has no finite cap"
            )));
        };
        let total = format_grouped_major(cap, 0);
        return Ok(format!(
            "{total} {unit} per {interval}, then calls fail. No card needed."
        ));
    }

    if finite {
        let total = format_grouped_major(cap.unwrap_or(0.0), 0);
        return Ok(format!(
            "{total} {unit} per {interval}. No credits used. Cancel any time."
        ));
    }

    if is_one_time(plan) {
        return Ok(format!(
            "Unlimited {unit}, one time. No credits used, no renewal."
        ));
    }

    Ok(format!(
        "Unlimited {unit}. No credits used. Cancel any time."
    ))
}

fn payg_consequence(
    plan: Option<&Value>,
    balance: Option<&Value>,
    merchant_name: Option<&str>,
) -> String {
    let across = merchant_name
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(|name| format!(" Credits work across every {name} product."))
        .unwrap_or_default();
    match credits_per_unit_from_balance(plan, balance, None) {
        None => format!("Drawn from your credit balance.{across}"),
        Some(credits) => format!(
            "From {} credits per call, drawn from your credit balance.{across}",
            format_grouped_major(credits as f64, 0)
        ),
    }
}
