//! Browser-only wasm-bindgen exports for public-safe plan-pricing readers.
//!
//! These helpers are pure JSON readers over a plan's `options[]`. They are
//! not secret-adjacent, but they live in the edge `decisions` artifact
//! because that is where dto-gen currently emits them. React's PlanSelector
//! and CheckoutSteps call them in the browser, so the browser WASM profile
//! has to expose the same envelopes — otherwise unifying `@solvapay/core` onto
//! one module instance throws `missing sync method: headlineCharges`.
//!
//! Keep this list in lock-step with the React checkout surface. Do not add
//! paywall / webhook / client symbols here.

#![cfg(feature = "browser")]

use solvapay_core::{
    billing_cycle, charges, credits_per_unit_from_balance, headline_charges, included_units,
    pegged_credits_per_unit, per_unit_charge, trial_days,
};
use wasm_bindgen::prelude::*;

use crate::args::{args_map, optional_f64, optional_string, optional_value, require_f64, to_value};
use crate::error::run_envelope_sync;

/// Binding for `charges`.
#[wasm_bindgen(js_name = "charges")]
pub fn charges_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&charges(priced.as_ref()))
    })
}

/// Binding for `headlineCharges`.
#[wasm_bindgen(js_name = "headlineCharges")]
pub fn headline_charges_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&headline_charges(priced.as_ref()))
    })
}

/// Binding for `perUnitCharge`.
#[wasm_bindgen(js_name = "perUnitCharge")]
pub fn per_unit_charge_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        let meter = optional_string(&args, "meter")?;
        to_value(&per_unit_charge(priced.as_ref(), meter.as_deref()))
    })
}

/// Binding for `billingCycle`.
#[wasm_bindgen(js_name = "billingCycle")]
pub fn billing_cycle_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&billing_cycle(priced.as_ref()))
    })
}

/// Binding for `trialDays`.
#[wasm_bindgen(js_name = "trialDays")]
pub fn trial_days_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&trial_days(priced.as_ref()))
    })
}

/// Binding for `includedUnits`.
#[wasm_bindgen(js_name = "includedUnits")]
pub fn included_units_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        let meter = optional_string(&args, "meter")?;
        to_value(&included_units(priced.as_ref(), meter.as_deref()))
    })
}

/// Binding for `peggedCreditsPerUnit`.
#[wasm_bindgen(js_name = "peggedCreditsPerUnit")]
pub fn pegged_credits_per_unit_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let charge_minor = require_f64(&args, "chargeMinor")?;
        let credits_per_minor_unit = require_f64(&args, "creditsPerMinorUnit")?;
        let usd_to_charge_rate = optional_f64(&args, "usdToChargeRate")?;
        to_value(&pegged_credits_per_unit(
            charge_minor,
            credits_per_minor_unit,
            usd_to_charge_rate,
        ))
    })
}

/// Binding for `creditsPerUnitFromBalance`.
#[wasm_bindgen(js_name = "creditsPerUnitFromBalance")]
pub fn credits_per_unit_from_balance_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        let balance = optional_value(&args, "balance");
        let meter = optional_string(&args, "meter")?;
        to_value(&credits_per_unit_from_balance(
            priced.as_ref(),
            balance.as_ref(),
            meter.as_deref(),
        ))
    })
}
