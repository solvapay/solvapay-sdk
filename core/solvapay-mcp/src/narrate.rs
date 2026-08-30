//! Intent-tool narration (`mcpNarrate`) — byte-parity with TypeScript `narrate.ts`.

use serde::Deserialize;
use serde_json::{json, Map, Value};
use solvapay_core::{
    billing_cycle, credits_per_unit_from_balance, credits_to_display_minor_units,
    format_major_fixed, headline_charges, is_zero_decimal_currency, meter_name, to_major_units,
    trial_days, usage_rate, CreditsToDisplayInput,
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

fn format_date(iso: Option<&str>) -> Option<String> {
    let iso = iso.filter(|s| s.len() >= 10)?;
    let y: i32 = iso.get(0..4)?.parse().ok()?;
    let m: u32 = iso.get(5..7)?.parse().ok()?;
    let d: u32 = iso.get(8..10)?.parse().ok()?;
    if !(1..=12).contains(&m) {
        return None;
    }
    let months = [
        "Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
    ];
    Some(format!("{} {}, {}", months[(m - 1) as usize], d, y))
}

fn is_plan_purchase(purchase: &Value) -> bool {
    purchase
        .get("planSnapshot")
        .is_some_and(|snap| !snap.is_null())
        && purchase
            .pointer("/metadata/purpose")
            .and_then(Value::as_str)
            != Some("credit_topup")
}

fn active_purchase(customer: Option<&Value>) -> Option<&Value> {
    let list = customer?.pointer("/purchase/purchases")?.as_array()?;
    list.iter().find(|item| is_plan_purchase(item))
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
    Some(match money {
        Some(money) => format!("Balance: {fmt} credits (~{money})"),
        None => format!("Balance: {fmt} credits"),
    })
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
            parts.join(" · ")
        })
        .collect()
}

fn commands_line(commands: &[&str]) -> String {
    format!(
        "Commands: {}",
        commands
            .iter()
            .map(|c| format!("`/{c}`"))
            .collect::<Vec<_>>()
            .join(" ")
    )
}

fn hosted_portal_link(data: &Value) -> Option<Value> {
    let url = data.get("portalUrl").and_then(Value::as_str)?;
    if url.starts_with("http://") || url.starts_with("https://") {
        Some(json!({ "uri": url, "name": "Open hosted portal" }))
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

/// Narrate `manage_account`.
#[must_use]
pub fn narrate_manage_account(data: &Value) -> Value {
    let customer = data.get("customer");
    let active = active_purchase(customer);
    let name = product_name(data);
    let mut lines: Vec<String> = Vec::new();
    match active {
        None => {
            lines.push(format!("**Welcome to {name}**"));
            lines.push(String::new());
            if let Some(bal) = balance_row(customer) {
                lines.push(bal);
            }
            let plans = data
                .get("plans")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            if plans.is_empty() {
                lines.push("No active plan.".to_owned());
            } else {
                lines.push("No active plan. Plans available:".to_owned());
                lines.extend(plans_list_lines(&plans));
            }
            lines.push(String::new());
            lines.push(commands_line(&["activate_plan", "upgrade"]));
        }
        Some(active) => {
            lines.push(format!("**{name} — your account**"));
            lines.push(String::new());
            if let Some(plan) = active.get("planSnapshot").filter(|s| !s.is_null()) {
                let plan_name = plan.get("name").and_then(Value::as_str).unwrap_or("Plan");
                let price = format_money(
                    plan.get("price").and_then(Value::as_f64),
                    plan.get("currency").and_then(Value::as_str),
                );
                let cycle = active
                    .get("billingCycle")
                    .and_then(Value::as_str)
                    .map(|c| format!("/{c}"))
                    .unwrap_or_default();
                let end = format_date(active.get("endDate").and_then(Value::as_str));
                let mut parts = vec![plan_name.to_owned()];
                if let Some(price) = price {
                    parts.push(format!("{price}{cycle}"));
                }
                if let Some(end) = end {
                    parts.push(format!("renews {end}"));
                }
                lines.push(format!("Plan: {}", parts.join(" · ")));
            }
            if let Some(bal) = balance_row(customer) {
                lines.push(bal);
            }
            if active.pointer("/planSnapshot/isMetered") == Some(&Value::Bool(true)) {
                if let Some(credits) = credits_per_unit_from_balance(
                    active.get("planSnapshot"),
                    customer.and_then(|c| c.get("balance")),
                    None,
                ) {
                    let fmt = format_grouped_number(credits as f64);
                    lines.push(format!("Cost per call: {fmt} credits"));
                }
            }
            lines.push(String::new());
            lines.push(commands_line(&["topup", "upgrade"]));
        }
    }
    let mut links = Vec::new();
    if let Some(portal) = hosted_portal_link(data) {
        links.push(portal);
    }
    narrate_manage_output(lines.join("\n"), links)
}

/// Narrate `upgrade`.
#[must_use]
pub fn narrate_upgrade(data: &Value) -> Value {
    let mut lines = vec![
        format!("**Upgrade — {}**", product_name(data)),
        String::new(),
    ];
    let plans: Vec<Value> = data
        .get("plans")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default()
        .into_iter()
        .filter(|p| !is_free_plan(p))
        .collect();
    if plans.is_empty() {
        lines.push("No paid plans are configured on this product yet.".to_owned());
    } else {
        lines.push("Plans available:".to_owned());
        lines.extend(plans_list_lines(&plans));
    }
    lines.push(String::new());
    lines.push(commands_line(&["manage_account", "topup"]));
    narrator_output(lines.join("\n"), Vec::new())
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
    let currency = customer
        .and_then(|c| c.pointer("/balance/displayCurrency"))
        .and_then(Value::as_str)
        .unwrap_or("USD");
    let presets: Vec<String> = [1000.0, 2500.0, 5000.0, 10_000.0]
        .into_iter()
        .filter_map(|m| format_money(Some(m), Some(currency)))
        .collect();
    if !presets.is_empty() {
        lines.push(format!("Top-up presets: {}", presets.join(" · ")));
    }
    lines.push(String::new());
    lines.push(commands_line(&["manage_account"]));
    narrator_output(lines.join("\n"), Vec::new())
}

/// Narrate `activate_plan`.
#[must_use]
pub fn narrate_activate_plan(data: &Value) -> Value {
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
    lines.push(String::new());
    lines.push(commands_line(&["manage_account", "topup"]));
    narrator_output(lines.join("\n"), Vec::new())
}

fn opened_verb(tool: &str, name: &str) -> String {
    match tool {
        "topup" => format!("Opened {name} top-up."),
        "upgrade" => format!("Opened {name} upgrade."),
        "manage_account" => format!("Opened your {name} account."),
        "activate_plan" => format!("Opened {name} plan picker."),
        _ => format!("Opened {name}."),
    }
}

fn panel_shown(tool: &str) -> &'static str {
    match tool {
        "topup" => "Top-up options are shown in the panel.",
        "upgrade" => "Plans and checkout are shown in the panel.",
        "manage_account" => "Account details are shown in the panel.",
        "activate_plan" => "Plan options are shown in the panel.",
        _ => "",
    }
}

/// One-line UI placeholder.
#[must_use]
pub fn ui_placeholder(tool: &str, data: &Value) -> String {
    let name = product_name(data);
    let mut parts = vec![opened_verb(tool, &name)];
    if let Some(balance) = balance_summary(data.get("customer")) {
        parts.push(format!("Balance: {balance}."));
    }
    let panel = panel_shown(tool);
    if !panel.is_empty() {
        parts.push(panel.to_owned());
    }
    parts.join(" ")
}

fn narrator_for(tool: &str, data: &Value) -> Option<Value> {
    match tool {
        "upgrade" => Some(narrate_upgrade(data)),
        "manage_account" => Some(narrate_manage_account(data)),
        "topup" => Some(narrate_topup(data)),
        "activate_plan" => Some(narrate_activate_plan(data)),
        _ => None,
    }
}

/// Allocate a widget session id (UUID v4).
#[must_use]
pub fn new_widget_session_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// Parse `mode` (`ui` / `text` / `auto`); unknown values default to `ui`.
#[must_use]
pub fn parse_mode(raw: Option<&str>) -> &'static str {
    match raw {
        Some("ui") => "ui",
        Some("text") => "text",
        Some("auto") => "auto",
        _ => "ui",
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
        "annotations": { "audience": ["assistant"] },
    });
    let resource_links: Vec<Value> = links
        .into_iter()
        .map(|link| {
            json!({
                "type": "resource_link",
                "uri": link.get("uri"),
                "name": link.get("name"),
                "annotations": { "audience": ["user"] },
            })
        })
        .collect();
    let placeholder_block = json!({
        "type": "text",
        "text": ui_placeholder(tool, data),
    });
    let content = if mode == "text" {
        let mut blocks = vec![narrated_block];
        blocks.extend(resource_links);
        blocks
    } else {
        vec![placeholder_block, narrated_block]
    };
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
    fn upgrade_still_leads_recurring_with_flat_charge() {
        let text = upgrade_text(vec![
            json!({ "kind": "billingCycle", "interval": "month" }),
            json!({ "kind": "charge", "per": "flat", "amountMinor": 1900, "currency": "USD" }),
        ]);
        assert!(text.contains("$19"), "{text}");
    }
}
