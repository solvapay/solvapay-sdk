//! Readers for the backend's composable `options[]` pricing model.
//!
//! Catalog plans, frozen `planSnapshot`s, and limits `plans[]` describe
//! pricing as an ordered list of options. These helpers read that list
//! structurally so an unknown option `kind` still contributes its charges.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::{serialize_opt_whole_f64, serialize_whole_f64};

/// A charge option. `amount_minor` is in `currency`'s minor units.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Charge {
    /// `flat`, `unit`, or `seat`.
    pub per: String,
    /// Amount in the charge currency's minor units.
    #[serde(serialize_with = "serialize_whole_f64")]
    pub amount_minor: f64,
    /// ISO currency code as shipped on the wire (not normalised).
    pub currency: String,
    /// Meter name when `per` is `unit`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub meter: Option<String>,
    /// Setup-fee flag; omitted unless `true`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub one_time: Option<bool>,
}

/// A billing-cycle option — present only on recurring plans.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BillingCycle {
    /// `week`, `month`, or `year`.
    pub interval: String,
    /// Interval count when greater than 1; omitted for the default of 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub count: Option<f64>,
}

fn options_of(priced: Option<&Value>) -> Vec<&Value> {
    priced
        .and_then(|v| v.get("options"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter(|item| item.is_object()).collect())
        .unwrap_or_default()
}

fn as_charge(option: &Value) -> Option<Charge> {
    if option.get("kind").and_then(Value::as_str) != Some("charge") {
        return None;
    }
    let per = option.get("per").and_then(Value::as_str)?;
    if per != "flat" && per != "unit" && per != "seat" {
        return None;
    }
    let amount_minor = option.get("amountMinor").and_then(Value::as_f64)?;
    let currency = option.get("currency").and_then(Value::as_str)?;
    let meter = option
        .get("meter")
        .and_then(Value::as_str)
        .map(str::to_owned);
    let one_time = option
        .get("oneTime")
        .and_then(Value::as_bool)
        .filter(|flag| *flag)
        .map(|_| true);
    Some(Charge {
        per: per.to_owned(),
        amount_minor,
        currency: currency.to_owned(),
        meter,
        one_time,
    })
}

/// Every charge option on the plan, in wire order.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 43
)]
pub fn charges(priced: Option<&Value>) -> Vec<Charge> {
    options_of(priced)
        .into_iter()
        .filter_map(as_charge)
        .collect()
}

/// The recurring or one-time flat charge in each currency, first-seen order.
///
/// Setup fees (`oneTime` alongside a base charge) are excluded.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 44
)]
pub fn headline_charges(priced: Option<&Value>) -> Vec<Charge> {
    let flat: Vec<Charge> = charges(priced)
        .into_iter()
        .filter(|charge| charge.per == "flat")
        .collect();
    let base: Vec<Charge> = flat
        .iter()
        .filter(|charge| charge.one_time != Some(true))
        .cloned()
        .collect();
    let source = if base.is_empty() { flat } else { base };
    let mut seen = std::collections::HashSet::new();
    source
        .into_iter()
        .filter(|charge| seen.insert(charge.currency.to_ascii_uppercase()))
        .collect()
}

/// The plan's metered charge — the first `per: unit` charge, optionally scoped.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 45
)]
pub fn per_unit_charge(priced: Option<&Value>, meter: Option<&str>) -> Option<Charge> {
    let unit: Vec<Charge> = charges(priced)
        .into_iter()
        .filter(|charge| charge.per == "unit")
        .collect();
    if let Some(meter_name) = meter.filter(|name| !name.is_empty()) {
        return unit
            .into_iter()
            .find(|charge| charge.meter.as_deref() == Some(meter_name));
    }
    unit.into_iter().next()
}

/// The plan's billing cycle, or `None` for a one-time or pure usage-based plan.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 46
)]
pub fn billing_cycle(priced: Option<&Value>) -> Option<BillingCycle> {
    for option in options_of(priced) {
        if option.get("kind").and_then(Value::as_str) != Some("billingCycle") {
            continue;
        }
        let interval = match option.get("interval").and_then(Value::as_str) {
            Some(value) if value == "week" || value == "month" || value == "year" => value,
            _ => continue,
        };
        let count = option
            .get("count")
            .and_then(Value::as_f64)
            .filter(|n| *n > 1.0);
        return Some(BillingCycle {
            interval: interval.to_owned(),
            count,
        });
    }
    None
}

/// Free trial length in days, or `None` when the plan has no trial.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 47
)]
#[allow(clippy::cast_possible_truncation)]
pub fn trial_days(priced: Option<&Value>) -> Option<i64> {
    for option in options_of(priced) {
        if option.get("kind").and_then(Value::as_str) != Some("trial") {
            continue;
        }
        if let Some(days) = option
            .get("days")
            .and_then(Value::as_f64)
            .filter(|n| *n > 0.0)
        {
            return Some(days as i64);
        }
    }
    None
}

/// Included units for a meter, from its limit option.
///
/// The backend uses `cap: 0` to mean unlimited; this preserves `0`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 48
)]
#[allow(clippy::cast_possible_truncation)]
pub fn included_units(priced: Option<&Value>, meter: Option<&str>) -> Option<i64> {
    for option in options_of(priced) {
        if option.get("kind").and_then(Value::as_str) != Some("limit") {
            continue;
        }
        if let Some(meter_name) = meter.filter(|name| !name.is_empty()) {
            if option.get("meter").and_then(Value::as_str) != Some(meter_name) {
                continue;
            }
        }
        if let Some(cap) = option.get("cap").and_then(Value::as_f64) {
            return Some(cap as i64);
        }
    }
    None
}

/// Credits consumed per metered unit for `charge_minor` in the charge currency.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 49
)]
pub fn pegged_credits_per_unit(
    charge_minor: f64,
    credits_per_minor_unit: f64,
    usd_to_charge_rate: Option<f64>,
) -> i64 {
    if !(charge_minor > 0.0) || !(credits_per_minor_unit > 0.0) {
        return 0;
    }
    let rate = usd_to_charge_rate.filter(|n| *n > 0.0).unwrap_or(1.0);
    #[allow(clippy::cast_possible_truncation)]
    let credits = ((charge_minor / rate) * credits_per_minor_unit).round() as i64;
    credits
}

/// Credits per metered call for `priced`, priced against a customer's balance peg.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 50
)]
pub fn credits_per_unit_from_balance(
    priced: Option<&Value>,
    balance: Option<&Value>,
    meter: Option<&str>,
) -> Option<i64> {
    let charge = per_unit_charge(priced, meter)?;
    if !(charge.amount_minor > 0.0) {
        return None;
    }
    let display_currency = balance
        .and_then(|b| b.get("displayCurrency"))
        .and_then(Value::as_str)?;
    let credits_per_minor_unit = balance
        .and_then(|b| b.get("creditsPerMinorUnit"))
        .and_then(Value::as_f64)?;
    if !charge.currency.eq_ignore_ascii_case(display_currency) {
        return None;
    }
    let rate = balance
        .and_then(|b| b.get("displayExchangeRate"))
        .and_then(Value::as_f64);
    let credits = pegged_credits_per_unit(charge.amount_minor, credits_per_minor_unit, rate);
    (credits > 0).then_some(credits)
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

    fn free_plan() -> Value {
        json!({
            "type": "recurring",
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 0, "currency": "usd" },
                { "kind": "charge", "per": "unit", "amountMinor": 0, "currency": "usd", "meter": "requests" },
                { "kind": "limit", "cap": 3, "scope": "billing_period", "meter": "requests", "onExceed": "block" },
                { "kind": "autoAssigned" }
            ]
        })
    }

    fn pro_plan() -> Value {
        json!({
            "type": "recurring",
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 3000, "currency": "usd" }
            ]
        })
    }

    fn payg_plan() -> Value {
        json!({
            "type": "usage-based",
            "options": [
                { "kind": "charge", "per": "unit", "amountMinor": 2, "currency": "usd", "meter": "requests" },
                { "kind": "autoAssigned" }
            ]
        })
    }

    fn usd_balance() -> Value {
        json!({ "displayCurrency": "USD", "displayExchangeRate": 1, "creditsPerMinorUnit": 100 })
    }

    #[test]
    fn billing_cycle_reads_interval() {
        assert_eq!(
            billing_cycle(Some(&pro_plan())),
            Some(BillingCycle {
                interval: "month".into(),
                count: None
            })
        );
    }

    #[test]
    fn billing_cycle_null_when_absent() {
        assert_eq!(billing_cycle(Some(&payg_plan())), None);
    }

    #[test]
    fn billing_cycle_keeps_multi_interval_count() {
        let priced =
            json!({ "options": [{ "kind": "billingCycle", "interval": "month", "count": 3 }] });
        assert_eq!(
            billing_cycle(Some(&priced)),
            Some(BillingCycle {
                interval: "month".into(),
                count: Some(3.0)
            })
        );
    }

    #[test]
    fn billing_cycle_omits_count_of_one() {
        let priced =
            json!({ "options": [{ "kind": "billingCycle", "interval": "year", "count": 1 }] });
        assert_eq!(
            billing_cycle(Some(&priced)),
            Some(BillingCycle {
                interval: "year".into(),
                count: None
            })
        );
    }

    #[test]
    fn headline_single_currency() {
        let charges = headline_charges(Some(&pro_plan()));
        assert_eq!(charges.len(), 1);
        assert_eq!(charges[0].amount_minor, 3000.0);
        assert_eq!(charges[0].currency, "usd");
    }

    #[test]
    fn headline_multi_currency() {
        let priced = json!({
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 1000, "currency": "usd" },
                { "kind": "charge", "per": "flat", "amountMinor": 900, "currency": "eur" }
            ]
        });
        let rows: Vec<(String, f64)> = headline_charges(Some(&priced))
            .into_iter()
            .map(|c| (c.currency, c.amount_minor))
            .collect();
        assert_eq!(rows, vec![("usd".into(), 1000.0), ("eur".into(), 900.0)]);
    }

    #[test]
    fn headline_excludes_setup_fee() {
        let priced = json!({
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 2900, "currency": "usd" },
                { "kind": "charge", "per": "flat", "amountMinor": 5000, "currency": "usd", "oneTime": true }
            ]
        });
        let charges = headline_charges(Some(&priced));
        assert_eq!(charges.len(), 1);
        assert_eq!(charges[0].amount_minor, 2900.0);
        assert!(charges[0].one_time.is_none());
    }

    #[test]
    fn headline_empty_for_payg() {
        assert!(headline_charges(Some(&payg_plan())).is_empty());
    }

    #[test]
    fn per_unit_finds_metered_charge() {
        let charge = per_unit_charge(Some(&payg_plan()), None).unwrap();
        assert_eq!(charge.amount_minor, 2.0);
        assert_eq!(charge.meter.as_deref(), Some("requests"));
    }

    #[test]
    fn per_unit_null_when_unmetered() {
        assert!(per_unit_charge(Some(&pro_plan()), None).is_none());
    }

    #[test]
    fn per_unit_scopes_to_named_meter() {
        assert!(per_unit_charge(Some(&payg_plan()), Some("tokens")).is_none());
        assert_eq!(
            per_unit_charge(Some(&payg_plan()), Some("requests"))
                .unwrap()
                .amount_minor,
            2.0
        );
    }

    #[test]
    fn included_units_reads_cap() {
        assert_eq!(included_units(Some(&free_plan()), None), Some(3));
    }

    #[test]
    fn included_units_preserves_unlimited_zero() {
        let priced = json!({
            "options": [{ "kind": "limit", "cap": 0, "scope": "billing_period", "meter": "requests" }]
        });
        assert_eq!(included_units(Some(&priced), None), Some(0));
    }

    #[test]
    fn included_units_null_when_absent() {
        assert_eq!(included_units(Some(&pro_plan()), None), None);
    }

    #[test]
    fn trial_days_reads_option() {
        let priced = json!({ "options": [{ "kind": "trial", "days": 14, "onEnd": "convert" }] });
        assert_eq!(trial_days(Some(&priced)), Some(14));
    }

    #[test]
    fn trial_days_null_when_absent() {
        assert_eq!(trial_days(Some(&pro_plan())), None);
    }

    #[test]
    fn pegged_parity_and_fx() {
        assert_eq!(pegged_credits_per_unit(2.0, 100.0, Some(1.0)), 200);
        assert_eq!(pegged_credits_per_unit(100.0, 100.0, Some(9.46)), 1057);
        assert_eq!(pegged_credits_per_unit(0.0, 100.0, Some(1.0)), 0);
    }

    #[test]
    fn credits_from_matching_balance() {
        assert_eq!(
            credits_per_unit_from_balance(Some(&payg_plan()), Some(&usd_balance()), None),
            Some(200)
        );
    }

    #[test]
    fn credits_applies_exchange_rate() {
        let plan = json!({
            "options": [{ "kind": "charge", "per": "unit", "amountMinor": 100, "currency": "sek", "meter": "requests" }]
        });
        let balance = json!({
            "displayCurrency": "SEK",
            "displayExchangeRate": 9.46,
            "creditsPerMinorUnit": 100
        });
        assert_eq!(
            credits_per_unit_from_balance(Some(&plan), Some(&balance), None),
            Some(1057)
        );
    }

    #[test]
    fn credits_refuses_currency_mismatch() {
        let plan = json!({
            "options": [{ "kind": "charge", "per": "unit", "amountMinor": 2, "currency": "eur", "meter": "requests" }]
        });
        assert_eq!(
            credits_per_unit_from_balance(Some(&plan), Some(&usd_balance()), None),
            None
        );
    }

    #[test]
    fn credits_null_without_balance_or_meter() {
        assert_eq!(
            credits_per_unit_from_balance(Some(&payg_plan()), None, None),
            None
        );
        assert_eq!(
            credits_per_unit_from_balance(Some(&pro_plan()), Some(&usd_balance()), None),
            None
        );
        assert_eq!(
            credits_per_unit_from_balance(Some(&free_plan()), Some(&usd_balance()), None),
            None
        );
    }
}
