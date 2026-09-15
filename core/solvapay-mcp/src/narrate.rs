//! Intent-tool narration (`mcpNarrate`) — byte-parity with TypeScript `narrate.ts`.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use solvapay_core::{
    billing_cycle, credit_signals, credits_per_unit_from_balance, credits_to_display_minor_units,
    format_major_fixed, headline_charges, included_units, is_zero_decimal_currency, meter_name,
    resolve_account_state, resolve_narrator_plan_shape, select_active_plan_purchase,
    to_major_units, trial_days, usage_rate, CreditsToDisplayInput, NarratorPlanShape,
    PaywallLimits,
};

/// Input for [`mcp_narrate`].
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NarrateInput {
    /// Intent tool name.
    pub tool: String,
    /// Bootstrap payload.
    pub payload: Value,
    /// `placeholder` selects [`ui_placeholder`] instead of a full narrator.
    #[serde(default)]
    pub kind: Option<String>,
    /// When set, emit a [`narrated_tool_result`] envelope.
    #[serde(default)]
    pub mode: Option<String>,
    /// Base `_meta` stamped onto narrated envelopes.
    #[serde(default)]
    pub meta: Option<Value>,
}

fn product_name(data: &Value) -> String {
    data.pointer("/product/name")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("SolvaPay")
        .to_owned()
}

fn is_zero(currency: &str) -> bool {
    is_zero_decimal_currency(currency)
}

fn group_int(n: i64) -> String {
    let sign = if n < 0 { "-" } else { "" };
    let digits: Vec<char> = n.abs().to_string().chars().collect();
    let mut grouped = String::new();
    for (i, ch) in digits.iter().enumerate() {
        if i > 0 && (digits.len() - i).is_multiple_of(3) {
            grouped.push(',');
        }
        grouped.push(*ch);
    }
    format!("{sign}{grouped}")
}

fn format_grouped_number(value: f64) -> String {
    if value.fract() == 0.0 {
        group_int(value as i64)
    } else {
        format!("{value}")
    }
}

fn format_major(major: f64, currency: &str, fraction: usize) -> String {
    format_major_fixed(major, currency, fraction)
}

fn format_money(amount_minor: Option<f64>, currency: Option<&str>) -> Option<String> {
    let amount = amount_minor?;
    let currency = currency.filter(|c| !c.is_empty())?;
    let zero = is_zero(currency);
    let major = to_major_units(amount, currency);
    Some(format_major(major, currency, if zero { 0 } else { 2 }))
}

fn format_short_date(iso: Option<&str>) -> Option<String> {
    let iso = iso.filter(|s| s.len() >= 10)?;
    let m: u32 = iso.get(5..7)?.parse().ok()?;
    let d: u32 = iso.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    Some(format!("{} {}", months[(m - 1) as usize], d))
}

fn active_purchase(data: &Value) -> Option<Value> {
    select_active_plan_purchase(
        data.pointer("/customer/purchase/purchases"),
        data.get("productRef").and_then(Value::as_str),
    )
}

fn balance_row(customer: Option<&Value>) -> Option<String> {
    let balance = customer?.get("balance")?;
    if balance.is_null() {
        return None;
    }
    let credits = balance
        .get("credits")
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let currency = balance.get("displayCurrency").and_then(Value::as_str);
    let credits_per_minor = balance.get("creditsPerMinorUnit").and_then(Value::as_f64);
    let display_minor = match (currency, credits_per_minor) {
        (Some(currency), Some(rate)) if rate > 0.0 => {
            credits_to_display_minor_units(&CreditsToDisplayInput {
                credits,
                credits_per_minor_unit: rate,
                display_exchange_rate: balance
                    .get("displayExchangeRate")
                    .and_then(Value::as_f64)
                    .unwrap_or(1.0),
                display_currency: currency.to_owned(),
            })
        }
        _ => None,
    };
    let money = format_money(display_minor.map(|n| n as f64), currency);
    let fmt = format_grouped_number(credits);
    let mut row = match money {
        Some(money) => format!("Balance: {fmt} credits (~{money})"),
        None => format!("Balance: {fmt} credits"),
    };
    if let Some(shortfall) = customer_shortfall_credits(customer) {
        if shortfall > 0.0 {
            row.push_str(&format!(" — {} short", format_grouped_number(shortfall)));
        }
    }
    Some(row)
}

/// Credit signals from a bootstrap customer object, including shortfall.
fn customer_credit_signals(customer: Option<&Value>) -> Option<solvapay_core::CreditSignals> {
    let customer = customer?;
    let limits = serde_json::from_value::<PaywallLimits>(customer.clone()).ok();
    let from_customer = limits.as_ref().map(|limits| credit_signals(Some(limits)));
    if from_customer
        .as_ref()
        .is_some_and(|signals| signals.shortfall_credits.is_some())
    {
        return from_customer;
    }
    let credits = customer
        .pointer("/balance/credits")
        .and_then(Value::as_f64)
        .or_else(|| customer.get("creditBalance").and_then(Value::as_f64));
    let cost = customer
        .get("creditsPerCall")
        .and_then(Value::as_f64)
        .or_else(|| {
            customer
                .pointer("/balance/creditsPerUnit")
                .and_then(Value::as_f64)
        });
    match (credits, cost) {
        (Some(balance), Some(per_call)) => Some(credit_signals(Some(&PaywallLimits {
            credit_balance: Some(balance),
            credits_per_unit: Some(per_call),
            ..PaywallLimits::default()
        }))),
        _ => from_customer,
    }
}

/// Shortfall from an explicit customer field, else derived credit signals.
fn customer_shortfall_credits(customer: Option<&Value>) -> Option<f64> {
    customer
        .and_then(|value| value.get("shortfallCredits"))
        .and_then(Value::as_f64)
        .or_else(|| customer_credit_signals(customer)?.shortfall_credits)
}

/// Human-readable balance summary used by the `'ui'` mode placeholder.
#[must_use]
pub fn balance_summary(customer: Option<&Value>) -> Option<String> {
    balance_row(customer).map(|row| row.replacen("Balance: ", "", 1))
}

fn is_free_plan(plan: &Value) -> bool {
    plan.get("requiresPayment") == Some(&Value::Bool(false))
}

fn plan_type_label(plan: &Value) -> &'static str {
    if is_free_plan(plan) {
        return "no payment required";
    }
    match plan.get("type").and_then(Value::as_str) {
        Some("usage-based") => "pay as you go",
        Some("hybrid") => "subscription + usage",
        Some("one-time") => "one-time",
        _ => "recurring",
    }
}

fn format_cycle(plan: &Value) -> String {
    match billing_cycle(Some(plan)) {
        Some(cycle) => match cycle.count {
            Some(count) if count > 1.0 => format!("/{} {}s", count as i64, cycle.interval),
            _ => format!("/{}", cycle.interval),
        },
        None => String::new(),
    }
}

fn format_plan_prices(plan: &Value) -> String {
    let charges = headline_charges(Some(plan));
    if !charges.is_empty() {
        return charges
            .into_iter()
            .filter_map(|charge| format_money(Some(charge.amount_minor), Some(&charge.currency)))
            .collect::<Vec<_>>()
            .join(" · ");
    }

    // No flat charge: a pay-as-you-go plan, priced per unit or in bands. Its
    // derived top-level `price` is 0, so falling straight through to it
    // announced a paid plan as free. Lead with the rate instead, marked as a
    // floor when the plan prices in bands.
    if let Some(rate) = usage_rate(Some(plan), None) {
        if rate.amount_minor > 0.0 {
            if let Some(money) = format_money(Some(rate.amount_minor), Some(&rate.currency)) {
                let fallback = meter_name(Some(plan));
                let unit = rate
                    .meter
                    .as_deref()
                    .or(fallback.as_deref())
                    .unwrap_or("unit");
                let prefix = if rate.tiered { "from " } else { "" };
                return format!("{prefix}{money} / {unit}");
            }
        }
    }

    format_money(
        plan.get("price").and_then(Value::as_f64),
        plan.get("currency").and_then(Value::as_str),
    )
    .into_iter()
    .collect::<Vec<_>>()
    .join(" · ")
}

fn plans_list_lines(plans: &[Value]) -> Vec<String> {
    plans
        .iter()
        .map(|plan| {
            let name = plan.get("name").and_then(Value::as_str).unwrap_or("Plan");
            let mut parts = vec![name.to_owned(), plan_type_label(plan).to_owned()];
            let price = format_plan_prices(plan);
            if !price.is_empty() && !is_free_plan(plan) {
                parts.push(format!("{price}{}", format_cycle(plan)));
            }
            if let Some(trial) = trial_days(Some(plan)).filter(|d| *d != 0) {
                parts.push(format!("{trial}-day trial"));
            }
            if let Some(reference) = plan
                .get("reference")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
            {
                parts.push(format!("planRef: {reference}"));
            }
            parts.join(" · ")
        })
        .collect()
}

const CHECKOUT_SESSION_TTL_MINUTES: u32 = 15;

fn http_url<'a>(data: &'a Value, key: &str) -> Option<&'a str> {
    let url = data.get(key).and_then(Value::as_str)?;
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(url)
    } else {
        None
    }
}

fn checkout_link_label(data: &Value) -> &'static str {
    let url = data
        .get("checkoutUrl")
        .and_then(Value::as_str)
        .unwrap_or("");
    if url.contains("/checkout/topup")
        || data.get("checkoutPurpose").and_then(Value::as_str) == Some("credit_topup")
    {
        "Add credits"
    } else {
        "Open checkout"
    }
}

fn checkout_line(data: &Value) -> Option<String> {
    let url = http_url(data, "checkoutUrl")?;
    let label = checkout_link_label(data);
    Some(format!(
        "Checkout: [{label}]({url}) (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes)"
    ))
}

fn hosted_checkout_link(data: &Value) -> Option<Value> {
    let url = http_url(data, "checkoutUrl")?;
    Some(json!({ "uri": url, "name": checkout_link_label(data) }))
}

fn manage_row(data: &Value) -> Option<String> {
    let url = http_url(data, "portalUrl")?;
    Some(format!(
        "Manage: [Manage account]({url}) (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes)"
    ))
}

fn recovery_line(views: &[&str]) -> String {
    let calls: Vec<String> = views
        .iter()
        .map(|view| format!("`account` with view: \"{view}\""))
        .collect();
    format!("To continue, call {}.", calls.join(" or "))
}

fn meter_unit(meter: Option<&str>, count: f64) -> String {
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

fn join_or(parts: &[String]) -> String {
    match parts.len() {
        0 => String::new(),
        1 => parts[0].clone(),
        2 => format!("{}, or {}", parts[0], parts[1]),
        n => format!("{}, or {}", parts[..n - 1].join(", "), parts[n - 1]),
    }
}

fn prefer_limits_plan(purchase: Option<&Value>, limits: Option<&Value>) -> bool {
    let Some(limits_ref) = limits.and_then(|l| l.get("planRef").and_then(Value::as_str)) else {
        return false;
    };
    let purchase_ref = purchase
        .and_then(|p| p.get("planRef").and_then(Value::as_str))
        .or_else(|| {
            purchase
                .and_then(|p| p.pointer("/planSnapshot/reference"))
                .and_then(Value::as_str)
        });
    Some(limits_ref) != purchase_ref
}

fn find_catalog_plan<'a>(
    plans: &'a [Value],
    snapshot: Option<&Value>,
    plan_ref: Option<&str>,
) -> Option<&'a Value> {
    let reference = snapshot
        .and_then(|s| s.get("reference").and_then(Value::as_str))
        .or(plan_ref)?;
    plans
        .iter()
        .find(|plan| plan.get("reference").and_then(Value::as_str) == Some(reference))
}

fn format_compact_money(amount_minor: Option<f64>, currency: Option<&str>) -> Option<String> {
    format_money(amount_minor, currency).map(|money| money.replace(".00", ""))
}

fn interval_phrase(plan: Option<&Value>) -> Option<String> {
    let cycle = billing_cycle(plan)?;
    let count = cycle.count.unwrap_or(1.0);
    if (count - 1.0).abs() < f64::EPSILON {
        Some(format!("a {}", cycle.interval))
    } else {
        Some(format!("every {} {}s", count as i64, cycle.interval))
    }
}

fn plan_price_phrase(plan: Option<&Value>) -> Option<String> {
    let list = headline_charges(plan);
    if !list.is_empty() {
        let prices: Vec<String> = list
            .into_iter()
            .filter_map(|charge| {
                format_compact_money(Some(charge.amount_minor), Some(&charge.currency))
            })
            .collect();
        if !prices.is_empty() {
            return Some(prices.join(" · "));
        }
    }
    format_compact_money(
        plan.and_then(|p| p.get("price").and_then(Value::as_f64)),
        plan.and_then(|p| p.get("currency").and_then(Value::as_str)),
    )
}

fn plan_price_bit(plan: Option<&Value>) -> String {
    let price = plan_price_phrase(plan);
    let cycle = interval_phrase(plan);
    if billing_cycle(plan).is_none() {
        return price.map(|p| format!(", {p} once")).unwrap_or_default();
    }
    match (price, cycle) {
        (Some(price), Some(cycle)) => format!(", {price} {cycle}"),
        (Some(price), None) => format!(", {price}"),
        _ => String::new(),
    }
}

fn credits_rate_phrase(plan: Option<&Value>, customer: Option<&Value>) -> Option<String> {
    let rate = usage_rate(plan, None)?;
    if rate.amount_minor <= 0.0 {
        return None;
    }
    let credits =
        credits_per_unit_from_balance(plan, customer.and_then(|c| c.get("balance")), None);
    if let Some(credits) = credits {
        let prefix = if rate.tiered { "from " } else { "" };
        return Some(format!(
            "{prefix}{} credits per call",
            format_grouped_number(credits as f64)
        ));
    }
    let money = format_compact_money(Some(rate.amount_minor), Some(&rate.currency))?;
    let unit = meter_unit(rate.meter.as_deref().or(meter_name(plan).as_deref()), 1.0);
    let prefix = if rate.tiered { "from " } else { "" };
    Some(format!("{prefix}{money} per {unit}"))
}

fn remaining_of_total(usage: Option<&Value>) -> Option<String> {
    let usage = usage?;
    let remaining = usage.get("remaining").and_then(Value::as_f64)?;
    let total = usage.get("total").and_then(Value::as_f64)?;
    if remaining < 0.0 {
        return None;
    }
    let noun = meter_unit(usage.get("meterRef").and_then(Value::as_str), total);
    Some(format!(
        "{} of {} {noun}",
        format_grouped_number(remaining),
        format_grouped_number(total)
    ))
}

fn used_of_total(usage: Option<&Value>) -> Option<String> {
    let usage = usage?;
    let used = usage.get("used").and_then(Value::as_f64)?;
    let total = usage.get("total").and_then(Value::as_f64)?;
    let noun = meter_unit(usage.get("meterRef").and_then(Value::as_str), total);
    Some(format!(
        "{} of {} {noun}",
        format_grouped_number(used),
        format_grouped_number(total)
    ))
}

fn claimable_free_plan(plans: &[Value]) -> Option<&Value> {
    plans.iter().find(|plan| {
        plan.get("requiresPayment") == Some(&Value::Bool(false))
            && included_units(Some(plan), None).is_some_and(|cap| cap > 0)
    })
}

fn catalog_fragment(plan: &Value, customer: Option<&Value>) -> String {
    let name = plan.get("name").and_then(Value::as_str).unwrap_or("Plan");
    let cap = included_units(Some(plan), None);
    let cycle = interval_phrase(Some(plan));
    let price = plan_price_phrase(Some(plan));
    let rate = credits_rate_phrase(Some(plan), customer);
    let shape = resolve_narrator_plan_shape(Some(plan));
    let trial = trial_days(Some(plan));
    let paid = plan.get("requiresPayment") != Some(&Value::Bool(false));
    let mut core = if shape == Some(NarratorPlanShape::Free)
        || (!paid && shape != Some(NarratorPlanShape::Trial))
    {
        if let Some(cap) = cap.filter(|c| *c > 0) {
            let unit = meter_unit(meter_name(Some(plan)).as_deref(), cap as f64);
            let cycle_bit = cycle.map(|c| format!(" {c}")).unwrap_or_default();
            format!(
                "{name} gives {} {unit}{cycle_bit}",
                format_grouped_number(cap as f64)
            )
        } else {
            format!("{name} requires no payment")
        }
    } else if shape == Some(NarratorPlanShape::UsageBased) {
        rate.map_or_else(
            || format!("{name} is pay as you go"),
            |rate| format!("{name} is {rate}"),
        )
    } else if billing_cycle(Some(plan)).is_none() {
        let allowance = match cap {
            Some(0) | None => " for unlimited".to_owned(),
            Some(cap) => format!(
                " for {} {}",
                format_grouped_number(cap as f64),
                meter_unit(meter_name(Some(plan)).as_deref(), cap as f64)
            ),
        };
        price.map_or_else(
            || format!("{name} is one-time"),
            |price| format!("{name} is {price} once{allowance}"),
        )
    } else {
        let allowance = match cap {
            Some(0) => " for unlimited".to_owned(),
            Some(cap) if cap > 0 => format!(
                " for {} {}",
                format_grouped_number(cap as f64),
                meter_unit(meter_name(Some(plan)).as_deref(), cap as f64)
            ),
            _ => String::new(),
        };
        match (price, cycle) {
            (Some(price), Some(interval)) => format!("{name} is {price} {interval}{allowance}"),
            (Some(price), None) => format!("{name} is {price}{allowance}"),
            (None, Some(interval)) => format!("{name} is {interval}"),
            _ => name.to_owned(),
        }
    };
    if let Some(trial) = trial.filter(|d| *d != 0) {
        core.push_str(&format!(" · {trial}-day trial"));
    }
    if let Some(reference) = plan.get("reference").and_then(Value::as_str) {
        core.push_str(&format!(" · planRef: {reference}"));
    }
    core
}

fn carry_on_fragment(plan: &Value, customer: Option<&Value>) -> String {
    let name = plan.get("name").and_then(Value::as_str).unwrap_or("Plan");
    let mut core = if resolve_narrator_plan_shape(Some(plan)) == Some(NarratorPlanShape::UsageBased)
    {
        let credits = customer
            .and_then(|c| c.pointer("/balance/credits"))
            .and_then(Value::as_f64);
        if credits.is_some_and(|c| c > 0.0) {
            format!(
                "{name} starts now using your existing {} credits",
                format_grouped_number(credits.unwrap_or(0.0))
            )
        } else {
            format!("{name} starts now")
        }
    } else {
        let price = plan_price_phrase(Some(plan));
        let cycle = interval_phrase(Some(plan));
        if billing_cycle(Some(plan)).is_none() {
            price.map_or_else(
                || name.to_owned(),
                |price| format!("{name} is {price} once"),
            )
        } else {
            match (price, cycle) {
                (Some(price), Some(cycle)) => format!("{name} is {price} {cycle}"),
                _ => name.to_owned(),
            }
        }
    };
    if let Some(reference) = plan.get("reference").and_then(Value::as_str) {
        core.push_str(&format!(" · planRef: {reference}"));
    }
    core
}

fn recovery_for_state(state: &str, free_plan_ref: Option<&str>) -> String {
    match state {
        "A" => recovery_line(&["checkout"]),
        "B" => recovery_line(&["topup"]),
        "C" | "E" | "F" | "I" => recovery_line(&["checkout"]),
        "D" => recovery_line(&["topup", "checkout"]),
        "H" => free_plan_ref.map_or_else(
            || recovery_line(&["checkout"]),
            |plan_ref| format!("To continue, call `activate_plan` with planRef: \"{plan_ref}\"."),
        ),
        "J" => recovery_line(&["account"]),
        _ => recovery_line(&["checkout"]),
    }
}

fn narrate_account_body(
    state: &str,
    product: &str,
    plan: Option<&Value>,
    plan_shape: Option<NarratorPlanShape>,
    purchase: Option<&Value>,
    customer: Option<&Value>,
    plans: &[Value],
) -> String {
    let plan_name = plan
        .and_then(|p| p.get("name").and_then(Value::as_str))
        .unwrap_or("plan");
    let usage = customer.and_then(|c| c.get("usage"));
    let credits = customer
        .and_then(|c| c.pointer("/balance/credits"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);

    match state {
        "A" => {
            let fragments: Vec<String> = plans
                .iter()
                .map(|p| catalog_fragment(p, customer))
                .collect();
            let catalog = if fragments.is_empty() {
                String::new()
            } else {
                format!(" {}.", fragments.join(", "))
            };
            format!("{product} has no plan yet.{catalog} Reply with a plan name to activate it.")
        }
        "H" => {
            let free = claimable_free_plan(plans);
            let cap = free.and_then(|p| included_units(Some(p), None));
            let cycle = interval_phrase(free);
            let unit = meter_unit(
                meter_name(free).as_deref(),
                cap.filter(|c| *c > 0).unwrap_or(2) as f64,
            );
            let ready = if let Some(cap) = cap.filter(|c| *c > 0) {
                let cycle_bit = cycle.map(|c| format!(" {c}")).unwrap_or_default();
                format!(
                    "{} {unit}{cycle_bit}, no card",
                    format_grouped_number(cap as f64)
                )
            } else {
                "no card".to_owned()
            };
            format!(
                "{product} has a free plan ready: {ready}. Call `activate_plan` with a `planRef` to activate it."
            )
        }
        "B" => {
            let rate = credits_rate_phrase(plan, customer);
            let per_call =
                credits_per_unit_from_balance(plan, customer.and_then(|c| c.get("balance")), None);
            let runway = per_call
                .filter(|p| *p > 0)
                .map(|per| {
                    format!(
                        ", about {} calls",
                        format_grouped_number((credits / per as f64).floor())
                    )
                })
                .unwrap_or_default();
            let rate_bit = rate.map(|r| format!(", {r}")).unwrap_or_default();
            format!(
                "{product} is on {plan_name}{rate_bit}. Balance {} credits{runway}. Call `account` with view: 'topup' to add credits.",
                format_grouped_number(credits)
            )
        }
        "D" => {
            let per_call =
                credits_per_unit_from_balance(plan, customer.and_then(|c| c.get("balance")), None);
            let cost_bit = if let Some(per) = per_call.filter(|p| *p > 0) {
                let shortfall = (per as f64 - credits).max(0.0);
                format!(
                    "; this call costs {} credits — {} short",
                    format_grouped_number(per as f64),
                    format_grouped_number(shortfall)
                )
            } else {
                format!(" and {plan_name} needs credits")
            };
            format!(
                "{product} is on {plan_name}. Balance {} credits{cost_bit}. Call `account` with view: 'topup' to add credits, or with view: 'checkout' to switch to a plan that does not use credits.",
                format_grouped_number(credits)
            )
        }
        "C" => {
            let price_bit = plan_price_bit(plan);
            let one_time = billing_cycle(plan).is_none();
            let left = remaining_of_total(usage);
            let date = format_short_date(
                usage
                    .and_then(|u| u.get("periodEnd").and_then(Value::as_str))
                    .or_else(|| purchase.and_then(|p| p.get("endDate").and_then(Value::as_str))),
            );
            let unlimited = usage.and_then(|u| u.get("remaining").and_then(Value::as_f64))
                == Some(-1.0)
                || included_units(plan, None) == Some(0)
                || plan_shape == Some(NarratorPlanShape::RecurringUnlimited);
            let position = if let Some(left) = left {
                if one_time {
                    format!("{left} left")
                } else {
                    let renew = date
                        .as_deref()
                        .map(|d| format!(", renewing {d}"))
                        .unwrap_or_default();
                    format!("{left} left this period{renew}")
                }
            } else if unlimited {
                if one_time {
                    "Unlimited calls".to_owned()
                } else {
                    let renew = date
                        .as_deref()
                        .map(|d| format!(", renewing {d}"))
                        .unwrap_or_default();
                    format!("Unlimited calls{renew}")
                }
            } else if let Some(date) = date.as_deref().filter(|_| !one_time) {
                format!("Renews {date}")
            } else {
                "After your first call".to_owned()
            };
            let limits = customer.and_then(|c| c.get("limits"));
            let parsed =
                limits.and_then(|l| serde_json::from_value::<PaywallLimits>(l.clone()).ok());
            let credits_unused = !credit_signals(parsed.as_ref()).is_credit_based;
            let tail = if credits_unused {
                "Credits are not used on this plan. Call `account` with view: 'checkout' to switch."
            } else {
                "Call `account` with view: 'checkout' to switch."
            };
            format!("{product} is on {plan_name}{price_bit}. {position}. {tail}")
        }
        "E" => {
            let left = remaining_of_total(usage);
            let date =
                format_short_date(usage.and_then(|u| u.get("periodEnd").and_then(Value::as_str)));
            let interval = billing_cycle(plan)
                .map(cycle_interval)
                .unwrap_or_else(|| "period".to_owned());
            let left_bit = if let Some(left) = left {
                let reset = date
                    .as_deref()
                    .map(|d| format!(", resetting {d}"))
                    .unwrap_or_default();
                format!("{left} left this {interval}{reset}")
            } else if let Some(date) = date {
                format!("resets {date}")
            } else {
                "After your first call".to_owned()
            };
            format!(
                "{product} is on the free plan: {left_bit}. Credits are not used on {plan_name}. Call `account` with view: 'checkout' for more calls."
            )
        }
        "F" => {
            let cap = usage
                .and_then(|u| u.get("total").and_then(Value::as_f64))
                .or_else(|| included_units(plan, None).map(|n| n as f64));
            let unit = meter_unit(
                usage
                    .and_then(|u| u.get("meterRef").and_then(Value::as_str))
                    .or(meter_name(plan).as_deref()),
                cap.filter(|c| *c > 0.0).unwrap_or(2.0),
            );
            let date =
                format_short_date(usage.and_then(|u| u.get("periodEnd").and_then(Value::as_str)));
            let cap_bit = if let Some(cap) = cap.filter(|c| *c > 0.0) {
                format!("{} {unit} are used up", format_grouped_number(cap))
            } else {
                "allowance is used up".to_owned()
            };
            let consequence = if let Some(date) = date {
                format!(" Further calls fail until {date}")
            } else {
                " Further calls fail until the allowance resets".to_owned()
            };
            let plan_ref = plan
                .and_then(|p| p.get("reference").and_then(Value::as_str))
                .or_else(|| purchase.and_then(|p| p.get("planRef").and_then(Value::as_str)));
            let others: Vec<String> = plans
                .iter()
                .filter(|item| {
                    let item_ref = item.get("reference").and_then(Value::as_str);
                    if item_ref.is_some() && item_ref == plan_ref {
                        return false;
                    }
                    !matches!(
                        resolve_narrator_plan_shape(Some(item)),
                        Some(NarratorPlanShape::Free | NarratorPlanShape::Trial)
                    )
                })
                .map(|item| carry_on_fragment(item, customer))
                .collect();
            let carry_on = if others.is_empty() {
                String::new()
            } else {
                format!(" {}.", join_or(&others))
            };
            let anti_trap = if credits > 0.0 && plan_shape != Some(NarratorPlanShape::UsageBased) {
                format!(" Adding credits will not help, because {plan_name} does not spend them.")
            } else {
                String::new()
            };
            let price_bit = plan_price_bit(plan);
            format!(
                "{product} is on {plan_name}{price_bit}. {cap_bit}.{consequence}.{anti_trap}{carry_on} Call `account` with view: 'checkout' to switch plan."
            )
        }
        "I" => {
            let used_bit = used_of_total(usage)
                .map(|used| format!(": {used} used"))
                .unwrap_or_default();
            format!(
                "{product} is over its {plan_name} allowance{used_bit}. Calls still work. Call `account` with view: 'checkout' for a higher limit."
            )
        }
        _ => {
            let date =
                format_short_date(purchase.and_then(|p| p.get("endDate").and_then(Value::as_str)));
            let until = date
                .as_deref()
                .map(|d| format!("runs until {d}"))
                .unwrap_or_else(|| "is cancelled".to_owned());
            let left = remaining_of_total(usage);
            let left_bit = left
                .map(|left| format!(", with {left} left"))
                .unwrap_or_default();
            format!(
                "{product}'s {plan_name} plan is cancelled and {until}{left_bit}. Calls stop after that. Call `account` with view: 'account' to reactivate it."
            )
        }
    }
}

fn cycle_interval(cycle: solvapay_core::BillingCycle) -> String {
    cycle.interval.to_string()
}

/// Narrate `manage_account`.
#[must_use]
pub fn narrate_manage_account(data: &Value) -> Value {
    let customer = data.get("customer");
    let plans = data
        .get("plans")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let active = active_purchase(data);
    let limits = customer.and_then(|c| c.get("limits"));
    let use_limits = prefer_limits_plan(active.as_ref(), limits);
    let catalog = find_catalog_plan(
        &plans,
        if use_limits {
            None
        } else {
            active.as_ref().and_then(|p| p.get("planSnapshot"))
        },
        if use_limits {
            limits.and_then(|l| l.get("planRef").and_then(Value::as_str))
        } else {
            active
                .as_ref()
                .and_then(|p| p.get("planRef").and_then(Value::as_str))
        },
    );
    let merged = if use_limits {
        catalog.cloned().or_else(|| {
            Some(json!({
                "name": limits.and_then(|l| l.get("planName").and_then(Value::as_str)),
                "reference": limits.and_then(|l| l.get("planRef").and_then(Value::as_str)),
            }))
        })
    } else {
        solvapay_core::merge_plan(active.as_ref().and_then(|p| p.get("planSnapshot")), catalog)
    };
    let plan_shape = resolve_narrator_plan_shape(merged.as_ref());
    let state_input = json!({
        "purchase": active,
        "limits": limits,
        "planShape": plan_shape,
    });
    let state = resolve_account_state(Some(&state_input));
    let name = product_name(data);
    let free = claimable_free_plan(&plans);
    let mut lines: Vec<String> = Vec::new();
    if state == "A" || state == "H" {
        lines.push(format!("**Welcome to {name}**"));
    } else {
        lines.push(format!("**{name} — your account**"));
    }
    lines.push(String::new());
    lines.push(narrate_account_body(
        &state,
        &name,
        merged.as_ref(),
        plan_shape,
        active.as_ref(),
        customer,
        &plans,
    ));
    if state == "A" || state == "H" {
        if let Some(bal) = balance_row(customer) {
            lines.push(bal);
        }
    }
    if let Some(manage) = manage_row(data) {
        lines.push(manage);
    }
    if let Some(checkout) = checkout_line(data) {
        lines.push(checkout);
    }
    lines.push(String::new());
    lines.push(recovery_for_state(
        &state,
        free.and_then(|p| p.get("reference").and_then(Value::as_str)),
    ));
    narrate_manage_output(lines.join("\n"), recovery_links(data))
}

fn recovery_links(data: &Value) -> Vec<Value> {
    [hosted_checkout_link(data), hosted_portal_link(data)]
        .into_iter()
        .flatten()
        .collect()
}

fn hosted_portal_link(data: &Value) -> Option<Value> {
    let url = data.get("portalUrl").and_then(Value::as_str)?;
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(json!({ "uri": url, "name": "Manage account" }))
    } else {
        None
    }
}

fn narrator_output(text: String, links: Vec<Value>) -> Value {
    if links.is_empty() {
        json!({ "text": text })
    } else {
        json!({ "text": text, "links": links })
    }
}

fn narrate_manage_output(text: String, links: Vec<Value>) -> Value {
    json!({ "text": text, "links": links })
}

/// Copy for `activate_plan` builtin status values.
#[must_use]
pub fn narrate_activate_plan_status(data: &Value) -> String {
    let status = data.get("status").and_then(Value::as_str).unwrap_or("");
    let plan_name = data
        .get("planName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let named = plan_name.unwrap_or("This plan");
    let checkout = data
        .get("checkoutUrl")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(|url| {
            let label = if url.contains("/checkout/topup") {
                "Add credits"
            } else {
                "Open checkout"
            };
            format!(" [{label}]({url}) (expires in 15 minutes), or")
        })
        .unwrap_or_default();
    match status {
        "activated" => plan_name.map_or_else(
            || "Plan activated. Paid tools are available now.".to_owned(),
            |name| format!("Activated {name}. Paid tools are available now."),
        ),
        "already_purchased" => {
            format!("{named} is already purchased. Call `account` with view: 'account' to manage it.")
        }
        "payment_required" => {
            format!("{named} requires payment.{checkout} Call `account` with view: 'checkout' to pay.")
        }
        "topup_required" => {
            format!("{named} needs credits before it can activate.{checkout} Call `account` with view: 'topup' to add credits.")
        }
        "invalid" => data
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .unwrap_or_else(|| {
                "That planRef is not valid for this product. Call `account` with view: 'checkout' to see plans.".to_owned()
            }),
        "already_active" => {
            let limits = serde_json::from_value::<PaywallLimits>(data.clone()).ok();
            let signals = credit_signals(limits.as_ref());
            if let (Some(balance), Some(cost)) = (signals.credit_balance, signals.credits_per_call) {
                let shortfall = (cost - balance).max(0.0);
                if shortfall > 0.0 {
                    return format!(
                        "{named} is already active. Balance {} credits; this call costs {} credits — {} short. Call the `account` tool with view: 'topup' to add credits.",
                        format_grouped_number(balance),
                        format_grouped_number(cost),
                        format_grouped_number(shortfall)
                    );
                }
            }
            if named == "This plan" {
                "This plan is already active.".to_owned()
            } else {
                format!("{named} is already active.")
            }
        }
        _ => "This plan is already active.".to_owned(),
    }
}

/// Copy for `activate_plan` when the backend reports `already_active`.
#[must_use]
pub fn narrate_already_active(data: &Value) -> String {
    let mut payload = data.clone();
    if payload.get("status").is_none() {
        if let Some(obj) = payload.as_object_mut() {
            obj.insert("status".to_owned(), json!("already_active"));
        }
    }
    narrate_activate_plan_status(&payload)
}

/// Narrate `upgrade`.
#[must_use]
pub fn narrate_upgrade(data: &Value) -> Value {
    let mut lines = vec![
        format!("**Upgrade — {}**", product_name(data)),
        String::new(),
    ];
    let has_active_purchase = active_purchase(data).is_some();
    let plans: Vec<Value> = data
        .get("plans")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !has_active_purchase || !is_free_plan(p))
        .collect();
    if plans.is_empty() {
        lines.push("No paid plans are configured on this product yet.".to_owned());
    } else {
        lines.push("Plans available:".to_owned());
        lines.extend(plans_list_lines(&plans));
    }
    if let Some(checkout) = checkout_line(data) {
        lines.push(checkout);
    }
    lines.push(recovery_line(&["account"]));
    narrator_output(lines.join("\n"), recovery_links(data))
}

/// Narrate the auto-recharge viewer.
#[must_use]
pub fn narrate_auto_recharge(data: &Value) -> Value {
    let mut lines = vec![
        format!("**Auto-recharge — {}**", product_name(data)),
        String::new(),
    ];
    let customer = data.get("customer");
    if let Some(bal) = balance_row(customer) {
        lines.push(bal);
    }
    let enabled =
        customer.and_then(|c| c.pointer("/autoRecharge/enabled")) == Some(&Value::Bool(true));
    let failed = customer.and_then(|c| c.pointer("/autoRecharge/status"))
        == Some(&Value::String("failed".to_owned()));
    if failed {
        lines.push("Auto-recharge failed — update your card to resume".to_owned());
    } else {
        lines.push(if enabled {
            "Auto-recharge is on. It tops your balance up automatically so calls do not fail."
                .to_owned()
        } else {
            "Auto-recharge is off. Turn it on from the link below — it stores a card and tops your balance up automatically so calls do not fail.".to_owned()
        });
    }
    let manage_url = http_url(data, "autoRechargeUrl").or_else(|| http_url(data, "portalUrl"));
    if let Some(url) = manage_url {
        lines.push(format!(
            "Manage: [Manage account]({url}) (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes)"
        ));
    }
    lines.push(String::new());
    lines.push(recovery_line(&["account"]));
    let mut links = Vec::new();
    if let Some(url) = manage_url {
        let name = if enabled {
            "Manage auto-recharge"
        } else {
            "Turn on auto-recharge"
        };
        links.push(json!({ "uri": url, "name": name }));
    }
    narrator_output(lines.join("\n"), links)
}

/// Narrate `topup`.
#[must_use]
pub fn narrate_topup(data: &Value) -> Value {
    let mut lines = vec![
        format!("**Top up — {}**", product_name(data)),
        String::new(),
    ];
    let customer = data.get("customer");
    if let Some(bal) = balance_row(customer) {
        lines.push(bal);
    }
    if let Some(checkout) = checkout_line(data) {
        lines.push(checkout);
    }
    lines.push(recovery_line(&["account"]));
    narrator_output(lines.join("\n"), recovery_links(data))
}

/// Narrate the `activate_plan` viewer (plan picker).
#[must_use]
pub fn narrate_activate_plan_view(data: &Value) -> Value {
    let mut lines = vec![
        format!("**Activate a plan — {}**", product_name(data)),
        String::new(),
    ];
    let plans = data
        .get("plans")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    if plans.is_empty() {
        lines.push("No plans are configured on this product yet.".to_owned());
    } else {
        lines.push("Plans available:".to_owned());
        lines.extend(plans_list_lines(&plans));
    }
    if let Some(checkout) = checkout_line(data) {
        lines.push(checkout);
    }
    lines.push(recovery_line(&["account"]));
    narrator_output(lines.join("\n"), recovery_links(data))
}

fn opened_verb(view: &str, name: &str) -> String {
    match view {
        "topup" => format!("Opened {name} top-up."),
        "upgrade" | "checkout" => format!("Opened {name} upgrade."),
        "auto-recharge" => format!("Opened {name} auto-recharge."),
        "manage_account" | "account" => format!("Opened your {name} account."),
        "activate_plan" => format!("Opened {name} plan picker."),
        _ => format!("Opened {name}."),
    }
}

fn first_selectable_plan(data: &Value) -> Option<&Value> {
    let plans = data.get("plans").and_then(Value::as_array)?;
    plans
        .iter()
        .find(|plan| !is_free_plan(plan))
        .or_else(|| plans.first())
}

fn plan_for_placeholder(view: &str, data: &Value) -> Option<Value> {
    if view == "account" || view == "manage_account" {
        if let Some(purchase) = active_purchase(data) {
            if let Some(snap) = purchase.get("planSnapshot").filter(|snap| !snap.is_null()) {
                return Some(snap.clone());
            }
        }
    }
    first_selectable_plan(data).cloned()
}

/// One-line UI placeholder with plan, price, and checkout URL.
#[must_use]
pub fn ui_placeholder(view: &str, data: &Value) -> String {
    let name = product_name(data);
    let mut parts = vec![opened_verb(view, &name)];
    if let Some(plan) = plan_for_placeholder(view, data).as_ref() {
        let plan_name = plan.get("name").and_then(Value::as_str).unwrap_or("Plan");
        let price = format_plan_prices(plan);
        if price.is_empty() || is_free_plan(plan) {
            parts.push(format!("{plan_name}."));
        } else {
            parts.push(format!("{plan_name} · {price}."));
        }
    }
    if let Some(balance) = balance_summary(data.get("customer")) {
        parts.push(format!("Balance: {balance}."));
    }
    if let Some(url) = http_url(data, "checkoutUrl") {
        let label = checkout_link_label(data);
        parts.push(format!(
            "[{label}]({url}) (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes)."
        ));
    }
    parts.join(" ")
}

fn narrator_for(view: &str, data: &Value) -> Option<Value> {
    match view {
        "upgrade" | "checkout" => Some(narrate_upgrade(data)),
        "manage_account" | "account" => Some(narrate_manage_account(data)),
        "auto-recharge" => Some(narrate_auto_recharge(data)),
        "topup" => Some(narrate_topup(data)),
        "activate_plan" => Some(narrate_activate_plan_view(data)),
        "already_active" => Some(narrator_output(narrate_already_active(data), Vec::new())),
        "virtual_upgrade" => Some(narrate_virtual_upgrade(data)),
        "virtual_manage_account" => Some(narrate_virtual_manage_account(data)),
        _ => None,
    }
}

fn require_url(data: &Value, key: &str) -> String {
    data.get(key)
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned()
}

fn narrate_virtual_upgrade(data: &Value) -> Value {
    let checkout_url = require_url(data, "checkoutUrl");
    let plan_ref = data
        .get("planRef")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty());
    let text = if plan_ref.is_some() {
        format!(
            "## Upgrade\n\n\
             **[Click here to upgrade →]({checkout_url})**\n\n\
             After completing the checkout, your purchase will be activated immediately."
        )
    } else {
        format!(
            "## Upgrade Your Subscription\n\n\
             **[Click here to view pricing options and upgrade →]({checkout_url})**\n\n\
             You'll be able to compare options and select the one that's right for you."
        )
    };
    narrator_output(text, Vec::new())
}

fn narrate_virtual_manage_account(data: &Value) -> Value {
    let portal_url = require_url(data, "portalUrl");
    let text = format!(
        "## Manage Your Account\n\n\
         Access your account management portal to:\n\
         - View your current account status\n\
         - See billing history and invoices\n\
         - Update payment methods\n\
         - Cancel or modify your subscription\n\n\
         **[Open Account Portal →]({portal_url})**\n\n\
         This link is secure and will expire after a short period."
    );
    narrator_output(text, Vec::new())
}

/// Allocate a widget session id (UUID v4).
#[must_use]
pub fn new_widget_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Parse `mode` (`ui` / `text` / `auto`); unknown values default to `auto`.
#[must_use]
pub fn parse_mode(raw: Option<&str>) -> &'static str {
    match raw {
        Some("ui") => "ui",
        Some("text") => "text",
        Some("auto") => "auto",
        _ => "auto",
    }
}

/// Wrap payload as `{ content, structuredContent }` like TypeScript `toolResult`.
#[must_use]
pub fn tool_result(data: &Value) -> Value {
    json!({
        "content": [{ "type": "text", "text": data.to_string() }],
        "structuredContent": data,
    })
}

/// Error envelope like TypeScript `toolErrorResult`.
#[must_use]
pub fn tool_error_result(error: &str, status: u16, details: Option<&str>) -> Value {
    let text = details.unwrap_or(error);
    let mut structured = Map::new();
    structured.insert("error".to_owned(), Value::String(error.to_owned()));
    structured.insert("status".to_owned(), json!(status));
    if let Some(details) = details {
        structured.insert("details".to_owned(), Value::String(details.to_owned()));
    }
    json!({
        "isError": true,
        "content": [{ "type": "text", "text": text }],
        "structuredContent": structured,
    })
}

/// Mode-aware narrated tool result.
#[must_use]
pub fn narrated_tool_result(
    tool: &str,
    data: &Value,
    mode: &str,
    base_meta: Option<&Value>,
) -> Value {
    let Some(narrated) = narrator_for(tool, data) else {
        let mut fallback = tool_result(data);
        if mode == "text" {
            if let Some(meta) = strip_ui_meta(base_meta) {
                fallback
                    .as_object_mut()
                    .map(|obj| obj.insert("_meta".to_owned(), meta));
            }
        } else if let Some(meta) = base_meta {
            fallback
                .as_object_mut()
                .map(|obj| obj.insert("_meta".to_owned(), meta.clone()));
        }
        return fallback;
    };
    let text = narrated
        .get("text")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_owned();
    let links = narrated
        .get("links")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let narrated_block = json!({
        "type": "text",
        "text": text,
    });
    let resource_links: Vec<Value> = links
        .into_iter()
        .map(|link| {
            json!({
                "type": "resource_link",
                "uri": link.get("uri"),
                "name": link.get("name"),
            })
        })
        .collect();
    let placeholder_block = json!({
        "type": "text",
        "text": ui_placeholder(tool, data),
    });
    let mut content = if mode == "ui" {
        vec![placeholder_block, narrated_block]
    } else {
        vec![narrated_block]
    };
    content.extend(resource_links);
    let meta = if mode == "text" {
        strip_ui_meta(base_meta)
    } else {
        base_meta.cloned()
    };
    let mut out = json!({
        "content": content,
        "structuredContent": data,
    });
    if let Some(meta) = meta {
        out.as_object_mut()
            .map(|obj| obj.insert("_meta".to_owned(), meta));
    }
    out
}

fn strip_ui_meta(base_meta: Option<&Value>) -> Option<Value> {
    let obj = base_meta?.as_object()?;
    if !obj.contains_key("ui") {
        return Some(Value::Object(obj.clone()));
    }
    let rest: Map<String, Value> = obj
        .iter()
        .filter(|(k, _)| k.as_str() != "ui")
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Some(Value::Object(rest))
}

/// Dispatch narration / placeholder / mode envelope.
#[must_use]
pub fn mcp_narrate(input: &NarrateInput) -> Value {
    if input.kind.as_deref() == Some("placeholder") {
        return json!({ "text": ui_placeholder(&input.tool, &input.payload) });
    }
    if input.kind.as_deref() == Some("balanceSummary") {
        return match balance_summary(Some(&input.payload)) {
            Some(text) => json!({ "text": text }),
            None => json!({ "text": Value::Null }),
        };
    }
    if input.mode.is_some() {
        return narrated_tool_result(
            &input.tool,
            &input.payload,
            parse_mode(input.mode.as_deref()),
            input.meta.as_ref(),
        );
    }
    narrator_for(&input.tool, &input.payload).unwrap_or_else(|| json!({ "text": "", "links": [] }))
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

    fn band(from: f64, to: Option<f64>, amount_minor: f64, meter: &str) -> Value {
        json!({
            "kind": "tier",
            "from": from,
            "to": to,
            "mode": "graduated",
            "charge": { "per": "unit", "amountMinor": amount_minor, "currency": "USD", "meter": meter }
        })
    }

    fn payload(options: Vec<Value>) -> Value {
        json!({
            "product": { "name": "Wiki" },
            "plans": [{
                "reference": "pln_1",
                "name": "Scale",
                "type": "usage-based",
                "requiresPayment": true,
                "price": 0,
                "currency": "USD",
                "options": options
            }]
        })
    }

    fn upgrade_text(options: Vec<Value>) -> String {
        narrate_upgrade(&payload(options))
            .get("text")
            .and_then(Value::as_str)
            .unwrap()
            .to_owned()
    }

    #[test]
    fn upgrade_leads_tiered_plan_with_floor() {
        let text = upgrade_text(vec![
            band(0.0, Some(1000.0), 2.0, "requests"),
            band(1000.0, None, 1.0, "requests"),
        ]);
        assert!(text.contains("from $0.02 / requests"), "{text}");
        assert!(!text.contains("$0.00"), "{text}");
    }

    #[test]
    fn upgrade_states_single_band_plainly() {
        let text = upgrade_text(vec![band(0.0, None, 5.0, "requests")]);
        assert!(text.contains("$0.05 / requests"), "{text}");
        assert!(!text.contains("from "), "{text}");
    }

    #[test]
    fn upgrade_states_flat_per_unit_rate() {
        let text = upgrade_text(vec![json!({
            "kind": "charge",
            "per": "unit",
            "amountMinor": 3,
            "currency": "USD",
            "meter": "tokens"
        })]);
        assert!(text.contains("$0.03 / tokens"), "{text}");
    }

    #[test]
    fn already_active_is_terse_without_credit_cost() {
        assert_eq!(
            narrate_already_active(&json!({ "status": "already_active" })),
            "This plan is already active."
        );
    }

    #[test]
    fn already_active_names_shortfall_when_balance_and_cost_known() {
        let text = narrate_already_active(&json!({
            "status": "already_active",
            "creditBalance": 91_000.0,
            "creditsPerUnit": 100_000.0
        }));
        assert_eq!(
            text,
            "This plan is already active. Balance 91,000 credits; this call costs 100,000 credits — 9,000 short. Call the `account` tool with view: 'topup' to add credits."
        );
    }

    #[test]
    fn balance_row_names_shortfall() {
        let row = balance_row(Some(&json!({
            "balance": { "credits": 1000.0 },
            "creditsPerCall": 1500.0
        })))
        .unwrap();
        assert!(row.contains("1,000 credits"), "{row}");
        assert!(row.contains("500 short"), "{row}");
    }

    #[test]
    fn upgrade_still_leads_recurring_with_flat_charge() {
        let text = upgrade_text(vec![
            json!({ "kind": "billingCycle", "interval": "month" }),
            json!({ "kind": "charge", "per": "flat", "amountMinor": 1900, "currency": "USD" }),
        ]);
        assert!(text.contains("$19"), "{text}");
    }
}
