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
    billing_cycle, charges, counts_usage, credits_per_unit_from_balance, derive_active_products,
    derive_default_view, format_compact_credits, headline_charges, history_rows, included_units,
    meter_name, pegged_credits_per_unit, per_unit_charge, plan_consequence, plan_pricing_shape,
    resolve_account_state, resolve_display_mode, resolve_narrator_plan_shape, trial_days,
    usage_rate,
};
use wasm_bindgen::prelude::*;

use crate::args::{
    args_map, optional_f64, optional_string, optional_value, require_f64, result_as_value, to_value,
};
use crate::error::run_envelope_sync;
use serde_json::Value;

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

/// Binding for `countsUsage`.
#[wasm_bindgen(js_name = "countsUsage")]
pub fn counts_usage_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        Ok(Value::Bool(counts_usage(priced.as_ref())))
    })
}

/// Binding for `meterName`.
#[wasm_bindgen(js_name = "meterName")]
pub fn meter_name_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&meter_name(priced.as_ref()))
    })
}

/// Binding for `usageRate`.
#[wasm_bindgen(js_name = "usageRate")]
pub fn usage_rate_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        let meter = optional_string(&args, "meter")?;
        to_value(&usage_rate(priced.as_ref(), meter.as_deref()))
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

/// Binding for `planPricingShape`.
#[wasm_bindgen(js_name = "planPricingShape")]
pub fn plan_pricing_shape_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&plan_pricing_shape(priced.as_ref()))
    })
}

/// Binding for `resolvePlanShape`.
#[wasm_bindgen(js_name = "resolvePlanShape")]
pub fn resolve_plan_shape_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let priced = optional_value(&args, "priced");
        to_value(&resolve_narrator_plan_shape(priced.as_ref()))
    })
}

/// Binding for `resolveAccountState`.
#[wasm_bindgen(js_name = "resolveAccountState")]
pub fn resolve_account_state_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let input = optional_value(&args, "input");
        Ok(Value::String(resolve_account_state(input.as_ref())))
    })
}

/// Binding for `deriveDefaultView`.
#[wasm_bindgen(js_name = "deriveDefaultView")]
pub fn derive_default_view_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let input = optional_value(&args, "input");
        result_as_value(derive_default_view(input.as_ref()))
    })
}

/// Binding for `planConsequence`.
#[wasm_bindgen(js_name = "planConsequence")]
pub fn plan_consequence_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let plan = optional_value(&args, "plan");
        let locale = optional_string(&args, "locale")?;
        let balance = optional_value(&args, "balance");
        let merchant_name = optional_string(&args, "merchantName")?;
        result_as_value(plan_consequence(
            plan.as_ref(),
            locale.as_deref(),
            balance.as_ref(),
            merchant_name.as_deref(),
        ))
    })
}

/// Binding for `deriveActiveProducts`.
#[wasm_bindgen(js_name = "deriveActiveProducts")]
pub fn derive_active_products_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let purchases = optional_value(&args, "purchases");
        let product_ref = optional_string(&args, "productRef")?;
        to_value(&derive_active_products(
            purchases.as_ref(),
            product_ref.as_deref(),
        ))
    })
}

/// Binding for `historyRows`.
#[wasm_bindgen(js_name = "historyRows")]
pub fn history_rows_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let input = optional_value(&args, "input");
        result_as_value(history_rows(input.as_ref()))
    })
}

/// Binding for `resolveDisplayMode`.
#[wasm_bindgen(js_name = "resolveDisplayMode")]
pub fn resolve_display_mode_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let ctx = optional_value(&args, "ctx");
        to_value(&resolve_display_mode(ctx.as_ref()))
    })
}

/// Binding for `formatCompactCredits`.
#[wasm_bindgen(js_name = "formatCompactCredits")]
pub fn format_compact_credits_binding(args_json: String) -> String {
    run_envelope_sync(|| {
        let args = args_map(&args_json)?;
        let credits = require_f64(&args, "credits")?;
        result_as_value(format_compact_credits(credits))
    })
}
