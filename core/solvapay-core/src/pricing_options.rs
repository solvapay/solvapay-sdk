//! Readers for the backend's composable `options[]` pricing model.
//!
//! Catalog plans, frozen `planSnapshot`s, and limits `plans[]` describe
//! pricing as an ordered list of options. These helpers read that list
//! structurally so an unknown option `kind` still contributes its charges.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::serde_util::{serialize_opt_whole_f64, serialize_whole_f64};

/// Which quantity the amount is charged against.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ChargePer {
    /// A single amount for the whole plan.
    Flat,
    /// Amount per metered unit.
    Unit,
    /// Amount per seat.
    Seat,
}

/// Recurring cadence of a billing cycle.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum BillingInterval {
    /// Weekly.
    Week,
    /// Monthly.
    Month,
    /// Yearly.
    Year,
}

impl std::fmt::Display for BillingInterval {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let label = match self {
            Self::Week => "week",
            Self::Month => "month",
            Self::Year => "year",
        };
        f.write_str(label)
    }
}

/// A charge option. `amount_minor` is in `currency`'s minor units.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Charge {
    /// Which quantity the amount is charged against.
    pub per: ChargePer,
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
    /// Recurring cadence of this cycle.
    pub interval: BillingInterval,
    /// Interval count when greater than 1; omitted for the default of 1.
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub count: Option<f64>,
}

/// Object entries of `priced.options`, skipping non-objects.
fn options_of(priced: Option<&Value>) -> Vec<&Value> {
    priced
        .and_then(|v| v.get("options"))
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter(|item| item.is_object()).collect())
        .unwrap_or_default()
}

/// True when `n` is a finite value strictly greater than zero (false for NaN).
fn is_strictly_positive(n: f64) -> bool {
    n.partial_cmp(&0.0) == Some(std::cmp::Ordering::Greater)
}

/// Parse charge fields (`per`, `amountMinor`, `currency`, …) without requiring `kind`.
fn as_charge_fields(option: &Value) -> Option<Charge> {
    let per: ChargePer = serde_json::from_value(option.get("per")?.clone()).ok()?;
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
        per,
        amount_minor,
        currency: currency.to_owned(),
        meter,
        one_time,
    })
}

/// Parse a `kind: charge` option; unknown `per` values are skipped.
fn as_charge(option: &Value) -> Option<Charge> {
    if option.get("kind").and_then(Value::as_str) != Some("charge") {
        return None;
    }
    as_charge_fields(option)
}

/// How a tier stack prices successive bands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TierMode {
    /// Each band is charged independently as usage crosses it.
    Graduated,
    /// The matching band's rate applies to every unit.
    Volume,
}

/// One band of a tiered price. `[from, to)` in metered units; `to: null` is unbounded.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Tier {
    /// Inclusive floor of this band, in metered units.
    #[serde(serialize_with = "serialize_whole_f64")]
    pub from: f64,
    /// Exclusive ceiling, or `None` for the unbounded top band.
    #[serde(serialize_with = "serialize_opt_whole_f64")]
    pub to: Option<f64>,
    /// Graduated vs volume pricing of this stack.
    pub mode: TierMode,
    /// Per-unit charge that prices units in this band.
    pub charge: Charge,
}

/// What one metered unit costs, and whether that rate is the first of several bands.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageRate {
    /// Which quantity the amount is charged against.
    pub per: ChargePer,
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
    /// True when `amount_minor` is the entry rate of a multi-band stack.
    pub tiered: bool,
}

impl UsageRate {
    /// Copy a charge into the usage-rate shape, marking whether it is tiered.
    ///
    /// # Arguments
    ///
    /// * `charge` - Source amount, currency, and meter.
    /// * `tiered` - True when `amount_minor` is the entry rate of a multi-band stack.
    ///
    /// # Returns
    ///
    /// A [`UsageRate`] with the same fields as `charge`.
    fn from_charge(charge: Charge, tiered: bool) -> Self {
        Self {
            per: charge.per,
            amount_minor: charge.amount_minor,
            currency: charge.currency,
            meter: charge.meter,
            one_time: charge.one_time,
            tiered,
        }
    }
}

/// Parse a `kind: tier` option; malformed bands are skipped.
fn as_tier(option: &Value) -> Option<Tier> {
    if option.get("kind").and_then(Value::as_str) != Some("tier") {
        return None;
    }
    let from = option.get("from").and_then(Value::as_f64)?;
    let to = match option.get("to") {
        Some(Value::Null) => None,
        Some(value) => Some(value.as_f64()?),
        None => return None,
    };
    let mode: TierMode = serde_json::from_value(option.get("mode")?.clone()).ok()?;
    let charge = option.get("charge").filter(|value| value.is_object())?;
    Some(Tier {
        from,
        to,
        mode,
        charge: as_charge_fields(charge)?,
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
        .filter(|charge| charge.per == ChargePer::Flat)
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
        .filter(|charge| charge.per == ChargePer::Unit)
        .collect();
    if let Some(meter_name) = meter.filter(|name| !name.is_empty()) {
        return unit
            .into_iter()
            .find(|charge| charge.meter.as_deref() == Some(meter_name));
    }
    unit.into_iter().next()
}

/// The tier bands a plan prices `meter` with, ordered by band floor.
///
/// Without a `meter` this returns the first tiered meter's stack — never a mix
/// of two meters' bands. The wire is a flat list of `tier` options with no
/// grouping or ordering guarantee.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 53
)]
pub fn tier_bands(priced: Option<&Value>, meter: Option<&str>) -> Vec<Tier> {
    let all: Vec<Tier> = options_of(priced).into_iter().filter_map(as_tier).collect();
    let Some(first) = all.first() else {
        return Vec::new();
    };
    let owned_target = meter
        .filter(|name| !name.is_empty())
        .map(str::to_owned)
        .or_else(|| first.charge.meter.clone());
    let mut bands: Vec<Tier> = all
        .into_iter()
        .filter(|tier| match owned_target.as_deref() {
            None => true,
            Some(name) => tier.charge.meter.as_deref() == Some(name),
        })
        .collect();
    bands.sort_by(|a, b| {
        a.from
            .partial_cmp(&b.from)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    bands
}

/// Every meter the plan prices with tier bands, in first-seen order.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 54
)]
pub fn tier_meters(priced: Option<&Value>) -> Vec<String> {
    let mut seen = Vec::new();
    for option in options_of(priced) {
        if let Some(meter) = as_tier(option)
            .and_then(|tier| tier.charge.meter)
            .filter(|name| !name.is_empty())
        {
            if !seen.contains(&meter) {
                seen.push(meter);
            }
        }
    }
    seen
}

/// The rate a plan charges for one metered unit — a standalone per-unit
/// charge, else the first priced band of the meter's tier stack.
///
/// A zero-rate per-unit charge does not price the meter (it anchors an
/// allowance), so it does not short-circuit the bands. A stack that opens
/// with a free band still leads with the first band that charges.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 55
)]
pub fn usage_rate(priced: Option<&Value>, meter: Option<&str>) -> Option<UsageRate> {
    let charge = per_unit_charge(priced, meter);
    if let Some(charge) = charge
        .as_ref()
        .filter(|row| is_strictly_positive(row.amount_minor))
    {
        return Some(UsageRate::from_charge(charge.clone(), false));
    }

    let priced_bands: Vec<Tier> = tier_bands(priced, meter)
        .into_iter()
        .filter(|band| is_strictly_positive(band.charge.amount_minor))
        .collect();
    if let Some(band) = priced_bands.first() {
        return Some(UsageRate::from_charge(
            band.charge.clone(),
            priced_bands.len() > 1,
        ));
    }
    charge.map(|row| UsageRate::from_charge(row, false))
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
        let interval: BillingInterval =
            match serde_json::from_value(option.get("interval")?.clone()) {
                Ok(value) => value,
                Err(_) => continue,
            };
        let count = option
            .get("count")
            .and_then(Value::as_f64)
            .filter(|n| *n > 1.0);
        return Some(BillingCycle { interval, count });
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
pub fn included_units(priced: Option<&Value>, meter: Option<&str>) -> Option<i64> {
    first_limit(priced, meter).map(|limit| limit.cap)
}

/// The meter a plan counts against: per-unit charge, else first tier, else first limit.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 51
)]
pub fn meter_name(priced: Option<&Value>) -> Option<String> {
    if let Some(meter) = per_unit_charge(priced, None)
        .and_then(|charge| charge.meter)
        .filter(|name| !name.is_empty())
    {
        return Some(meter);
    }
    if let Some(meter) = tier_meters(priced).into_iter().next() {
        return Some(meter);
    }
    first_limit(priced, None).and_then(|limit| limit.meter)
}

/// True when the plan counts usage: a per-unit charge, a limit, or a tier.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "coreHelper",
    section = "plans",
    emit_order = 52
)]
pub fn counts_usage(priced: Option<&Value>) -> bool {
    if per_unit_charge(priced, None).is_some() {
        return true;
    }
    if included_units(priced, None).is_some() {
        return true;
    }
    !tier_bands(priced, None).is_empty()
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
    if !is_strictly_positive(charge_minor) || !is_strictly_positive(credits_per_minor_unit) {
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
    let charge = usage_rate(priced, meter)?;
    if !is_strictly_positive(charge.amount_minor) {
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

/// First `kind: limit` option, optionally scoped to a meter.
struct LimitCap {
    /// Included-unit cap from the plan option.
    cap: i64,
    /// Meter name when the option is meter-scoped.
    meter: Option<String>,
}

/// Return the first matching limit option, optionally filtered by meter name.
#[allow(clippy::cast_possible_truncation)]
fn first_limit(priced: Option<&Value>, meter: Option<&str>) -> Option<LimitCap> {
    for option in options_of(priced) {
        if option.get("kind").and_then(Value::as_str) != Some("limit") {
            continue;
        }
        if let Some(meter_name) = meter.filter(|name| !name.is_empty()) {
            if option.get("meter").and_then(Value::as_str) != Some(meter_name) {
                continue;
            }
        }
        let Some(cap) = option.get("cap").and_then(Value::as_f64) else {
            continue;
        };
        let meter = option
            .get("meter")
            .and_then(Value::as_str)
            .filter(|name| !name.is_empty())
            .map(str::to_owned);
        return Some(LimitCap {
            cap: cap as i64,
            meter,
        });
    }
    None
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

    #[test]
    fn charge_per_round_trips_lowercase_wire_strings() {
        for (value, json) in [
            (ChargePer::Flat, "\"flat\""),
            (ChargePer::Unit, "\"unit\""),
            (ChargePer::Seat, "\"seat\""),
        ] {
            assert_eq!(serde_json::to_string(&value).expect("serialize"), json);
            assert_eq!(
                serde_json::from_str::<ChargePer>(json).expect("deserialize"),
                value
            );
        }
    }

    #[test]
    fn billing_interval_round_trips_lowercase_wire_strings() {
        for (value, json) in [
            (BillingInterval::Week, "\"week\""),
            (BillingInterval::Month, "\"month\""),
            (BillingInterval::Year, "\"year\""),
        ] {
            assert_eq!(serde_json::to_string(&value).expect("serialize"), json);
            assert_eq!(
                serde_json::from_str::<BillingInterval>(json).expect("deserialize"),
                value
            );
        }
    }

    #[test]
    fn unknown_per_yields_no_charge() {
        let priced = json!({
            "options": [
                { "kind": "charge", "per": "bogus", "amountMinor": 100, "currency": "usd" },
                { "kind": "charge", "per": "flat", "amountMinor": 50, "currency": "usd" }
            ]
        });
        let rows = charges(Some(&priced));
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].amount_minor, 50.0);
    }

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
                interval: BillingInterval::Month,
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
                interval: BillingInterval::Month,
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
                interval: BillingInterval::Year,
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
    fn meter_name_from_per_unit_charge() {
        assert_eq!(meter_name(Some(&payg_plan())).as_deref(), Some("requests"));
    }

    #[test]
    fn meter_name_falls_back_to_limit_without_per_unit() {
        let priced = json!({
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 0, "currency": "usd" },
                { "kind": "limit", "cap": 3, "scope": "billing_period", "meter": "tokens", "onExceed": "block" }
            ]
        });
        assert!(per_unit_charge(Some(&priced), None).is_none());
        assert_eq!(meter_name(Some(&priced)).as_deref(), Some("tokens"));
    }

    #[test]
    fn meter_name_null_when_no_option_names_a_meter() {
        assert_eq!(meter_name(Some(&pro_plan())), None);
    }

    #[test]
    fn counts_usage_from_per_unit_limit_or_tier() {
        let allowance_only = json!({
            "options": [
                { "kind": "billingCycle", "interval": "month" },
                { "kind": "charge", "per": "flat", "amountMinor": 0, "currency": "usd" },
                { "kind": "limit", "cap": 3, "scope": "billing_period", "meter": "tokens", "onExceed": "block" }
            ]
        });
        assert!(counts_usage(Some(&payg_plan())));
        assert!(counts_usage(Some(&free_plan())));
        assert!(counts_usage(Some(&allowance_only)));
        assert!(!counts_usage(Some(&pro_plan())));
        assert_eq!(meter_name(Some(&allowance_only)).as_deref(), Some("tokens"));
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

    fn band(from: f64, to: Option<f64>, amount_minor: f64, meter: &str, mode: &str) -> Value {
        json!({
            "kind": "tier",
            "from": from,
            "to": to,
            "mode": mode,
            "charge": { "per": "unit", "amountMinor": amount_minor, "currency": "USD", "meter": meter }
        })
    }

    fn two_meter_plan() -> Value {
        json!({
            "type": "usage-based",
            "price": 0,
            "currency": "USD",
            "options": [
                band(1000.0, None, 1.0, "requests", "graduated"),
                band(0.0, Some(500.0), 9.0, "tokens", "volume"),
                band(0.0, Some(1000.0), 2.0, "requests", "graduated"),
                band(500.0, None, 7.0, "tokens", "volume")
            ]
        })
    }

    #[test]
    fn tier_bands_group_by_meter_and_order_by_floor() {
        let requests: Vec<(f64, Option<f64>, f64)> =
            tier_bands(Some(&two_meter_plan()), Some("requests"))
                .into_iter()
                .map(|t| (t.from, t.to, t.charge.amount_minor))
                .collect();
        assert_eq!(
            requests,
            vec![(0.0, Some(1000.0), 2.0), (1000.0, None, 1.0)]
        );
        let tokens: Vec<(f64, Option<f64>, f64)> =
            tier_bands(Some(&two_meter_plan()), Some("tokens"))
                .into_iter()
                .map(|t| (t.from, t.to, t.charge.amount_minor))
                .collect();
        assert_eq!(tokens, vec![(0.0, Some(500.0), 9.0), (500.0, None, 7.0)]);
    }

    #[test]
    fn tier_bands_default_to_first_meter_without_mixing() {
        let meters: std::collections::HashSet<Option<String>> =
            tier_bands(Some(&two_meter_plan()), None)
                .into_iter()
                .map(|t| t.charge.meter)
                .collect();
        assert_eq!(meters.len(), 1);
    }

    #[test]
    fn tier_bands_empty_for_unknown_meter_or_flat_plan() {
        assert!(tier_bands(Some(&two_meter_plan()), Some("storage")).is_empty());
        assert!(tier_bands(Some(&pro_plan()), None).is_empty());
    }

    #[test]
    fn tier_meters_lists_each_meter_once() {
        assert_eq!(
            tier_meters(Some(&two_meter_plan())),
            vec!["requests".to_owned(), "tokens".to_owned()]
        );
        assert!(tier_meters(Some(&pro_plan())).is_empty());
    }

    #[test]
    fn tier_bands_ignore_malformed_bands() {
        let broken = json!({
            "options": [
                { "kind": "tier", "from": 0, "to": null, "mode": "sideways", "charge": { "per": "unit", "amountMinor": 5, "currency": "USD" } },
                { "kind": "tier", "from": 0, "to": null, "mode": "graduated" }
            ]
        });
        assert!(tier_bands(Some(&broken), None).is_empty());
    }

    #[test]
    fn meter_name_and_counts_usage_from_tier_only_plan() {
        assert!(per_unit_charge(Some(&two_meter_plan()), None).is_none());
        assert_eq!(
            meter_name(Some(&two_meter_plan())).as_deref(),
            Some("requests")
        );
        assert!(counts_usage(Some(&two_meter_plan())));
        assert!(!counts_usage(Some(&pro_plan())));
    }

    #[test]
    fn usage_rate_entry_band_and_floor_flag() {
        let rate = usage_rate(Some(&two_meter_plan()), None).unwrap();
        assert_eq!(rate.amount_minor, 2.0);
        assert_eq!(rate.meter.as_deref(), Some("requests"));
        assert!(rate.tiered);
        let tokens = usage_rate(Some(&two_meter_plan()), Some("tokens")).unwrap();
        assert_eq!(tokens.amount_minor, 9.0);
        assert!(tokens.tiered);
    }

    #[test]
    fn usage_rate_single_band_is_not_tiered() {
        let plan = json!({ "options": [band(0.0, None, 3.0, "requests", "graduated")] });
        let rate = usage_rate(Some(&plan), None).unwrap();
        assert_eq!(rate.amount_minor, 3.0);
        assert!(!rate.tiered);
    }

    #[test]
    fn usage_rate_prefers_standalone_per_unit() {
        assert!(!usage_rate(Some(&payg_plan()), None).unwrap().tiered);
    }

    #[test]
    fn usage_rate_ignores_zero_rate_charge() {
        let both = json!({
            "options": [
                { "kind": "charge", "per": "unit", "amountMinor": 0, "currency": "USD", "meter": "requests" },
                band(0.0, None, 4.0, "requests", "graduated")
            ]
        });
        let rate = usage_rate(Some(&both), None).unwrap();
        assert_eq!(rate.amount_minor, 4.0);
        assert!(!rate.tiered);
    }

    #[test]
    fn usage_rate_leads_with_first_priced_band() {
        let free_opening = json!({
            "options": [
                band(0.0, Some(1000.0), 0.0, "requests", "graduated"),
                band(1000.0, None, 3.0, "requests", "graduated")
            ]
        });
        let rate = usage_rate(Some(&free_opening), None).unwrap();
        assert_eq!(rate.amount_minor, 3.0);
        assert!(!rate.tiered);
    }

    #[test]
    fn usage_rate_null_when_unpriced() {
        assert!(usage_rate(Some(&pro_plan()), None).is_none());
    }

    #[test]
    fn credits_from_tiered_entry_band() {
        assert_eq!(
            credits_per_unit_from_balance(Some(&two_meter_plan()), Some(&usd_balance()), None),
            Some(200)
        );
    }
}
