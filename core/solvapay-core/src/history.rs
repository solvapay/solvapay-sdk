//! History driver — product-scoped charges plus account-wide credit activity.
//!
//! Hosts own HTTP and keep the two fetches parallel. This module owns
//! parameter checks and the `{ charges, creditActivity }` projection.

#![allow(clippy::missing_docs_in_private_items)]

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

use crate::helper_error::HelperErrorResult;
use crate::money_format::{format_grouped_major, format_price};
use crate::utc::{format_credit_when, format_since};

/// Driver state between history steps.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetHistoryState {
    /// Product whose purchases become `charges`.
    pub product_ref: String,
    /// Backend customer ref for both fetches.
    pub customer_ref: String,
    /// Optional credit-activity page size.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<f64>,
    /// In-flight step the next host event must complete.
    pub pending: GetHistoryPending,
}

/// In-flight step the next host event must complete.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum GetHistoryPending {
    /// Terminal or short-circuit.
    #[default]
    None,
    /// Waiting for `results`.
    Fetch,
}

/// Next host action or a terminal resolve.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum GetHistoryAction {
    /// Host fetches `listPurchases` and `getCreditActivity` in parallel.
    #[serde(rename_all = "camelCase")]
    Fetch {
        /// `listPurchases` query.
        list_purchases: Value,
        /// `getCreditActivity` query.
        get_credit_activity: Value,
    },
    /// Terminal success.
    #[serde(rename_all = "camelCase")]
    Resolved {
        /// Product-scoped purchases.
        charges: Vec<Value>,
        /// Account-wide credit ledger page.
        credit_activity: Value,
    },
}

/// Driver output.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GetHistoryNextOutput {
    /// State to pass into the next call.
    pub state: GetHistoryState,
    /// Host action or terminal result.
    pub action: GetHistoryAction,
}

/// Advance history by one step.
///
/// # Arguments
///
/// * `state` - Previous [`GetHistoryNextOutput::state`], or `None` on `start`.
/// * `event` - Host event tagged with `kind`.
///
/// # Errors
///
/// [`HelperErrorResult`] when `productRef` is missing or the event is malformed.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "history",
    emit_order = 58
)]
pub fn get_history_next(
    state: Option<&Value>,
    event: Option<&Value>,
) -> Result<GetHistoryNextOutput, HelperErrorResult> {
    let event =
        event.ok_or_else(|| HelperErrorResult::transport("get_history_next event is required"))?;
    let kind = event
        .get("kind")
        .and_then(Value::as_str)
        .ok_or_else(|| HelperErrorResult::transport("get_history_next event.kind is required"))?;
    match kind {
        "start" => start(event),
        "results" => on_results(require_state(state)?, event),
        other => Err(HelperErrorResult::transport(format!(
            "get_history_next unknown event kind: {other}"
        ))),
    }
}

fn start(event: &Value) -> Result<GetHistoryNextOutput, HelperErrorResult> {
    let product_ref = event
        .get("productRef")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| HelperErrorResult::without_details("getHistory requires productRef", 400))?;
    let customer_ref = event
        .get("customerRef")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| HelperErrorResult::transport("get_history_next customerRef is required"))?;
    let limit = event.get("limit").and_then(Value::as_f64);
    let mut list_purchases = serde_json::Map::new();
    list_purchases.insert(
        "customerRef".to_owned(),
        Value::String(customer_ref.to_owned()),
    );
    list_purchases.insert(
        "productRef".to_owned(),
        Value::String(product_ref.to_owned()),
    );
    let mut get_credit_activity = serde_json::Map::new();
    get_credit_activity.insert(
        "customerRef".to_owned(),
        Value::String(customer_ref.to_owned()),
    );
    if let Some(limit) = limit {
        get_credit_activity.insert("limit".to_owned(), json!(limit));
    }
    Ok(GetHistoryNextOutput {
        state: GetHistoryState {
            product_ref: product_ref.to_owned(),
            customer_ref: customer_ref.to_owned(),
            limit,
            pending: GetHistoryPending::Fetch,
        },
        action: GetHistoryAction::Fetch {
            list_purchases: Value::Object(list_purchases),
            get_credit_activity: Value::Object(get_credit_activity),
        },
    })
}

fn on_results(
    state: GetHistoryState,
    event: &Value,
) -> Result<GetHistoryNextOutput, HelperErrorResult> {
    if state.pending != GetHistoryPending::Fetch {
        return Err(HelperErrorResult::transport(
            "get_history_next results event without a pending fetch",
        ));
    }
    let purchases = event.get("purchases");
    let charges = match purchases {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items.clone(),
        Some(Value::Object(map)) => map
            .get("purchases")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
        Some(_) => {
            return Err(HelperErrorResult::transport(
                "get_history_next purchases must be an array or { purchases }",
            ))
        }
    };
    let credit_activity = event.get("creditActivity").cloned().unwrap_or(json!({}));
    Ok(GetHistoryNextOutput {
        state: GetHistoryState {
            pending: GetHistoryPending::None,
            ..state
        },
        action: GetHistoryAction::Resolved {
            charges,
            credit_activity,
        },
    })
}

fn require_state(state: Option<&Value>) -> Result<GetHistoryState, HelperErrorResult> {
    let Some(state) = state.filter(|v| !v.is_null()) else {
        return Err(HelperErrorResult::transport(
            "get_history_next state is required",
        ));
    };
    serde_json::from_value(state.clone()).map_err(|err| {
        HelperErrorResult::transport(format!("get_history_next state is invalid: {err}"))
    })
}

/// One charge table row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryChargeRow {
    /// Plan or product name plus qualifier.
    pub charge: String,
    /// UTC purchase date.
    pub date: String,
    /// Formatted amount.
    pub amount: String,
}

/// One credit-activity table row.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryCreditRow {
    /// Product name or type label.
    pub title: String,
    /// Humanized reason.
    pub subtitle: Option<String>,
    /// UTC day + time.
    pub when: String,
    /// Signed credit delta.
    pub credits: String,
    /// Running balance.
    pub balance: String,
}

/// Mapped history tables plus merchant chrome.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HistoryRows {
    /// Product-scoped charges.
    pub charges: Vec<HistoryChargeRow>,
    /// Account-wide credit activity.
    pub credit_activity: Vec<HistoryCreditRow>,
    /// City / state line.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub merchant_place: Option<String>,
    /// Website host without `www.`.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub website_host: Option<String>,
}

fn type_label(kind: &str) -> &'static str {
    match kind {
        "TOPUP" => "Top-up",
        "USAGE" => "Usage",
        "GRANT" => "Grant",
        "REFUND" => "Refund",
        "ADJUSTMENT" => "Adjustment",
        _ => "Usage",
    }
}

fn format_credit_activity_reason(reason: Option<&str>) -> Option<String> {
    let normalized = reason?
        .replace(['_', '-'], " ")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase();
    if normalized.is_empty() {
        return None;
    }
    let mut chars = normalized.chars();
    let first = chars.next()?.to_ascii_uppercase();
    Some(format!("{first}{}", chars.as_str()))
}

fn format_signed_credits(amount: f64) -> String {
    let formatted = format_grouped_major(amount.abs(), 0);
    if amount > 0.0 {
        format!("+{formatted}")
    } else if amount < 0.0 {
        format!("\u{2212}{formatted}")
    } else {
        formatted
    }
}

fn credit_entries(input: Option<&Value>) -> Vec<&Value> {
    match input {
        Some(Value::Array(items)) => items.iter().collect(),
        Some(Value::Object(map)) => map
            .get("entries")
            .or_else(|| map.get("items"))
            .and_then(Value::as_array)
            .map(|items| items.iter().collect())
            .unwrap_or_default(),
        _ => Vec::new(),
    }
}

fn map_credit_row(entry: &Value) -> Result<HistoryCreditRow, HelperErrorResult> {
    let timestamp = entry
        .get("timestamp")
        .and_then(Value::as_str)
        .ok_or_else(|| HelperErrorResult::transport("credit activity row has no timestamp"))?;
    let when = format_credit_when(timestamp).ok_or_else(|| {
        HelperErrorResult::transport(format!("Invalid credit activity timestamp: {timestamp}"))
    })?;
    let title = entry
        .get("productName")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .map(str::to_owned)
        .unwrap_or_else(|| {
            type_label(entry.get("type").and_then(Value::as_str).unwrap_or("")).to_owned()
        });
    Ok(HistoryCreditRow {
        title,
        subtitle: format_credit_activity_reason(entry.get("reason").and_then(Value::as_str)),
        when,
        credits: format_signed_credits(entry.get("amount").and_then(Value::as_f64).unwrap_or(0.0)),
        balance: format_grouped_major(
            entry.get("balance").and_then(Value::as_f64).unwrap_or(0.0),
            0,
        ),
    })
}

fn charge_qualifier(purchase: &Value) -> String {
    if purchase.get("isRecurring") != Some(&Value::Bool(true)) {
        return "one time".to_owned();
    }
    purchase
        .get("billingCycle")
        .and_then(Value::as_str)
        .filter(|s| !s.is_empty())
        .unwrap_or("monthly")
        .to_owned()
}

fn map_charge_row(purchase: &Value) -> Result<HistoryChargeRow, HelperErrorResult> {
    let name = purchase
        .get("planSnapshot")
        .and_then(|s| s.get("name"))
        .and_then(Value::as_str)
        .or_else(|| purchase.get("productName").and_then(Value::as_str))
        .filter(|s| !s.is_empty())
        .ok_or_else(|| {
            let reference = purchase
                .get("reference")
                .and_then(Value::as_str)
                .unwrap_or("unknown");
            HelperErrorResult::transport(format!(
                "Charge row {reference} has no plan or product name"
            ))
        })?;
    let date_iso = purchase
        .get("paidAt")
        .or_else(|| purchase.get("createdAt"))
        .or_else(|| purchase.get("startDate"))
        .and_then(Value::as_str);
    let date = date_iso.and_then(format_since).ok_or_else(|| {
        let reference = purchase
            .get("reference")
            .and_then(Value::as_str)
            .unwrap_or("unknown");
        HelperErrorResult::transport(format!("Charge row {reference} has no usable date"))
    })?;
    let amount = purchase
        .get("originalAmount")
        .or_else(|| purchase.get("amount"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let currency = purchase
        .get("currency")
        .and_then(Value::as_str)
        .unwrap_or("USD");
    Ok(HistoryChargeRow {
        charge: format!("{name} · {}", charge_qualifier(purchase)),
        date,
        amount: format_price(amount, currency, None, None, Some(""), None),
    })
}

fn format_merchant_place(merchant: Option<&Value>) -> Option<String> {
    let merchant = merchant.filter(|v| v.is_object())?;
    let city = merchant
        .get("city")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    let state = merchant
        .get("stateOrCounty")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty());
    match (city, state) {
        (Some(city), Some(state)) => Some(format!("{city}, {state}")),
        (Some(city), None) => Some(city.to_owned()),
        (None, Some(state)) => Some(state.to_owned()),
        (None, None) => None,
    }
}

fn website_host_label(url: &str) -> Result<String, HelperErrorResult> {
    let rest = url
        .split_once("://")
        .map_or(url, |(_, rest)| rest)
        .split(['/', '?'])
        .next()
        .unwrap_or("")
        .split(':')
        .next()
        .unwrap_or("")
        .trim();
    let host = rest.strip_prefix("www.").unwrap_or(rest);
    if host.is_empty() || !host.contains('.') {
        return Err(HelperErrorResult::transport(format!(
            "Invalid merchant website URL: {url}"
        )));
    }
    Ok(host.to_owned())
}

/// Map `get_history` rows onto the designed fullscreen tables.
///
/// # Errors
///
/// [`HelperErrorResult`] when a charge or credit row is missing required fields.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "none",
    section = "history",
    emit_order = 59
)]
pub fn history_rows(input: Option<&Value>) -> Result<HistoryRows, HelperErrorResult> {
    let input = input
        .filter(|v| !v.is_null())
        .ok_or_else(|| HelperErrorResult::transport("history_rows input is required"))?;
    let charges = match input.get("charges") {
        None | Some(Value::Null) => Vec::new(),
        Some(Value::Array(items)) => items
            .iter()
            .map(map_charge_row)
            .collect::<Result<Vec<_>, _>>()?,
        Some(_) => {
            return Err(HelperErrorResult::transport(
                "history_rows charges must be an array",
            ))
        }
    };
    let credit_activity = credit_entries(input.get("creditActivity"))
        .into_iter()
        .map(map_credit_row)
        .collect::<Result<Vec<_>, _>>()?;
    let merchant = input.get("merchant");
    let website_host = merchant
        .and_then(|m| m.get("websiteUrl"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(website_host_label)
        .transpose()?;
    Ok(HistoryRows {
        charges,
        credit_activity,
        merchant_place: format_merchant_place(merchant),
        website_host,
    })
}
