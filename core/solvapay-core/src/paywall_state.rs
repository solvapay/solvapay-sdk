//! Paywall state classification and gate/nudge copy (§6.3).
//!
//! Pure helpers formerly in the TypeScript paywall-state facade: classify a
//! limits response into a recovery-tool-specific [`PaywallState`], then produce
//! the frozen human-readable gate / nudge message strings.

use serde::{Deserialize, Serialize};

use crate::money_format::{format_grouped_major, format_money_intl};

/// How long a checkout session URL stays valid. Stated inline in gate copy.
/// Do not extend this TTL — the session id is a guardless bearer credential.
pub const CHECKOUT_SESSION_TTL_MINUTES: u32 = 15;

/// Trailing pointer at the overview resource on every gate / nudge line.
const DOCS_HINT: &str = "See docs://solvapay/overview.md.";

/// Discriminated paywall recovery path (`kind` on the wire).
///
/// `ReactivationRequired` is kept for parity with the TypeScript union but is
/// unreachable from [`classify_paywall_state`] under current backend behaviour.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PaywallState {
    /// No plan is live yet; primary recovery is `activate_plan`.
    ActivationRequired,
    /// Usage-based plan out of credits; primary recovery is `topup`.
    TopupRequired,
    /// Everything else (including null/degraded limits); primary recovery is `upgrade`.
    UpgradeRequired,
    /// Active plan at included cap (`plan` is a non-empty ref and `remaining <= 0`).
    LimitReached,
    /// Previous plan inactive (type-only; classifier never returns this today).
    ReactivationRequired,
}

/// Single primary recovery an agent should take after a gate.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaywallNextAction {
    /// Add prepaid credits.
    Topup,
    /// Open hosted checkout / switch plan.
    Checkout,
    /// Activate a specific plan.
    Activate,
    /// Inspect the account viewer.
    Account,
}

/// Coalesced credit-balance channels plus derived shortfall / remaining-call counts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreditSignals {
    /// Nested `balance.creditBalance` wins over the top-level field.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    /// Credits deducted per call (`balance.creditsPerUnit` ?? `creditsPerUnit`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_call: Option<f64>,
    /// `max(0, creditsPerCall - creditBalance)` when both are known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortfall_credits: Option<f64>,
    /// How many calls the current allowance or wallet still covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_calls: Option<f64>,
    /// True when either credit-balance channel or a per-call cost is present.
    pub is_credit_based: bool,
}

/// Per-provider auto-recharge snapshot on a limits / gate payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallAutoRecharge {
    /// Whether auto-recharge is enabled for this provider.
    pub enabled: bool,
    /// Stored auto-recharge status when a config exists.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub status: Option<String>,
}

/// Global recovery destinations. Per-plan URLs stay on `plans[].checkoutUrl`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallRecoveryLinks {
    /// Checkout URL when the classified state is [`PaywallState::TopupRequired`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub topup: Option<String>,
    /// Checkout URL when the classified state is not a top-up.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub checkout: Option<String>,
    /// Confirmation / manage URL.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub manage: Option<String>,
}

/// Minimal plan summary used by the classifier and the checkout ladder.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallPlanSummary {
    /// Plan reference matching [`PaywallLimits::plan`].
    #[serde(default)]
    pub reference: String,
    /// Plan type wire string (`usage-based`, `recurring`, …).
    #[serde(default, rename = "type")]
    pub plan_type: String,
    /// Display name used in the checkout ladder.
    #[serde(default)]
    pub name: Option<String>,
    /// Headline price in minor units; used to sort the ladder cheapest-first.
    #[serde(default)]
    pub price: Option<f64>,
    /// Per-plan hosted checkout deep link.
    #[serde(default)]
    pub checkout_url: Option<String>,
    /// Whether the plan requires payment (unused by classification; kept for DTO shape).
    #[serde(default)]
    pub requires_payment: Option<bool>,
    /// Included units on the active plan (`0` is the unlimited sentinel).
    #[serde(default)]
    pub free_units: Option<f64>,
    /// Per-unit charge in minor units on the active plan.
    #[serde(default)]
    pub per_unit_charge_minor: Option<f64>,
    /// ISO currency on the active plan.
    #[serde(default)]
    pub currency: Option<String>,
}

/// Nested balance block from newer backend responses.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallBalance {
    /// Credit balance in credits (nested channel).
    pub credit_balance: Option<f64>,
    /// Credits deducted per metered item.
    #[serde(default)]
    pub credits_per_unit: Option<f64>,
    /// How many metered items the credit balance still covers.
    #[serde(default)]
    pub remaining_units: Option<f64>,
    /// ISO currency on the nested balance block.
    #[serde(default)]
    pub currency: Option<String>,
}

/// Minimal deserializable limits input for classification and nudge copy.
///
/// Typed DTOs arrive at step 15; this mirrors the fields the TS helpers read.
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallLimits {
    /// Explicit backend flag that no plan is live yet.
    pub activation_required: Option<bool>,
    /// Authoritative backend paywall classification (`activation_required` / `topup_required`).
    #[serde(default)]
    pub paywall_reason: Option<String>,
    /// Deprecated active-plan alias. The backend never sends this; prefer [`Self::plan_ref`].
    pub plan: Option<String>,
    /// Active plan reference when the customer already holds a purchase.
    #[serde(default)]
    pub plan_ref: Option<String>,
    /// Active purchase reference when the customer already holds a purchase.
    #[serde(default)]
    pub purchase_ref: Option<String>,
    /// Display name of the active or default plan.
    #[serde(default)]
    pub plan_name: Option<String>,
    /// Available plans on the product.
    pub plans: Option<Vec<PaywallPlanSummary>>,
    /// Structured balance block (presence is a usage-based proxy).
    pub balance: Option<PaywallBalance>,
    /// Top-level credit balance (older / alternate channel).
    pub credit_balance: Option<f64>,
    /// Top-level credits deducted per metered item.
    #[serde(default)]
    pub credits_per_unit: Option<f64>,
    /// Remaining allowance (usage-based fallback when credit channels are absent).
    pub remaining: Option<f64>,
    /// Consumed usage units this period when the backend measured a finite cap.
    #[serde(default)]
    pub used: Option<f64>,
    /// Effective finite cap when the backend measured one.
    #[serde(default)]
    pub limit: Option<f64>,
    /// Checkout URL inlined into nudge copy when non-empty.
    pub checkout_url: Option<String>,
    /// Authoritative backend deny reason: prepaid top-up required.
    #[serde(default)]
    pub needs_top_up: Option<bool>,
    /// Authoritative backend deny reason: auto-upgrade required.
    #[serde(default)]
    pub needs_upgrade: Option<bool>,
    /// Meter name used in user-facing included-usage copy.
    #[serde(default)]
    pub meter_name: Option<String>,
    /// Product-level currency when the active plan does not carry one.
    #[serde(default)]
    pub currency: Option<String>,
    /// Per-provider auto-recharge snapshot.
    #[serde(default)]
    pub auto_recharge: Option<PaywallAutoRecharge>,
}

/// Included-usage counters emitted on gates when `freeUnits` is a positive cap.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IncludedUsage {
    /// Included units for the period (`freeUnits`).
    pub total: f64,
    /// Derived as `max(0, total - remaining)`.
    pub used: f64,
    /// Remaining included units from the limits response.
    pub remaining: f64,
}

/// Gate structured-content fields read by [`build_gate_message`].
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateContent {
    /// Checkout URL inlined into gate copy when non-empty.
    pub checkout_url: Option<String>,
    /// Active plan reference (dropped from the checkout ladder).
    #[serde(default)]
    pub plan_ref: Option<String>,
    /// Display name of the active or default plan.
    #[serde(default)]
    pub plan_name: Option<String>,
    /// Product plans used to build the cheapest-first checkout ladder.
    #[serde(default)]
    pub plans: Option<Vec<PaywallPlanSummary>>,
    /// Meter name used in included-usage copy.
    #[serde(default)]
    pub meter_name: Option<String>,
    /// Next-call unit price in minor units.
    #[serde(default)]
    pub unit_price_minor: Option<f64>,
    /// ISO currency for [`Self::unit_price_minor`].
    #[serde(default)]
    pub currency: Option<String>,
    /// Included counters when the active plan has a finite cap.
    #[serde(default)]
    pub included: Option<IncludedUsage>,
    /// Nested balance (currency fallback).
    #[serde(default)]
    pub balance: Option<PaywallBalance>,
    /// Coalesced credit balance.
    #[serde(default)]
    pub credit_balance: Option<f64>,
    /// Credits deducted per call.
    #[serde(default)]
    pub credits_per_call: Option<f64>,
    /// `max(0, creditsPerCall - creditBalance)` when both are known.
    #[serde(default)]
    pub shortfall_credits: Option<f64>,
    /// How many calls the current allowance or wallet still covers.
    #[serde(default)]
    pub remaining_calls: Option<f64>,
    /// Active purchase reference.
    #[serde(default)]
    pub purchase_ref: Option<String>,
    /// Per-provider auto-recharge snapshot.
    #[serde(default)]
    pub auto_recharge: Option<PaywallAutoRecharge>,
}

/// Classify limits into a [`PaywallState`].
///
/// Precedence mirrors TypeScript `classifyPaywallState`:
/// 1. `activation_required == Some(true)` **or** `paywall_reason == "activation_required"`.
/// 2. `paywall_reason == "topup_required"` — backend stays authoritative for
///    credit-based denials (same rule as Managed MCP).
/// 3. Authoritative `needs_top_up` / `needs_upgrade` when the backend sent
///    `Some(true)`.
/// 4. Credit-field presence **and** a real shortfall (`balance < cost`), then
///    `balance == 0`, then `cost` unknown && `remaining == 0`.
/// 5. `(purchase_ref || active_plan_ref)` && `remaining <= 0` → `limit_reached`.
/// 6. Floor: never `upgrade_required` when credit fields or a purchase are
///    present. Everything else (including `None` limits) → `upgrade_required`.
///
/// # Arguments
///
/// * `limits` - Limits response, or `None` on degraded paths (`null` in JSON).
///
/// # Returns
///
/// Recovery-tool-specific state. Never returns [`PaywallState::ReactivationRequired`].
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall state / gate / payload",
    emit_order = 36
)]
pub fn classify_paywall_state(limits: Option<&PaywallLimits>) -> PaywallState {
    let Some(limits) = limits else {
        return PaywallState::UpgradeRequired;
    };

    if limits.activation_required == Some(true)
        || limits.paywall_reason.as_deref() == Some("activation_required")
    {
        return PaywallState::ActivationRequired;
    }

    if limits.paywall_reason.as_deref() == Some("topup_required") {
        return PaywallState::TopupRequired;
    }

    if limits.needs_top_up == Some(true) {
        return PaywallState::TopupRequired;
    }

    if limits.needs_upgrade == Some(true) {
        return PaywallState::UpgradeRequired;
    }

    let signals = credit_signals(Some(limits));
    if signals.is_credit_based {
        if let (Some(balance), Some(cost)) = (signals.credit_balance, signals.credits_per_call) {
            if balance < cost {
                return PaywallState::TopupRequired;
            }
        }
        if signals.credit_balance == Some(0.0) {
            return PaywallState::TopupRequired;
        }
        if signals.credits_per_call.is_none() && limits.remaining == Some(0.0) {
            return PaywallState::TopupRequired;
        }
    }

    let active_ref = active_plan_ref_of(limits);
    let has_purchase = limits
        .purchase_ref
        .as_deref()
        .is_some_and(|value| !value.is_empty());
    if (has_purchase || active_ref.is_some())
        && limits.remaining.is_some_and(|remaining| remaining <= 0.0)
    {
        return PaywallState::LimitReached;
    }

    if signals.is_credit_based {
        return PaywallState::TopupRequired;
    }
    if has_purchase {
        return PaywallState::LimitReached;
    }

    PaywallState::UpgradeRequired
}

/// Active plan reference: `plan_ref` wins over deprecated `plan`; empty → `None`.
fn active_plan_ref_of(limits: &PaywallLimits) -> Option<&str> {
    let reference = limits
        .plan_ref
        .as_deref()
        .or(limits.plan.as_deref())
        .filter(|value| !value.is_empty())?;
    Some(reference)
}

/// Coalesce the two credit-balance channels and derive shortfall / remaining-call counts.
///
/// Nested `balance` wins when present. `remainingCalls` prefers
/// `balance.remainingUnits`, then `floor(balance / cost)`, then `remaining`
/// when it is `>= 0`.
///
/// # Arguments
///
/// * `limits` - Limits response, or `None` when no check has run.
///
/// # Returns
///
/// Credit signals. `is_credit_based` is `false` when both channels are absent.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall",
    emit_order = 42
)]
pub fn credit_signals(limits: Option<&PaywallLimits>) -> CreditSignals {
    let Some(limits) = limits else {
        return CreditSignals {
            credit_balance: None,
            credits_per_call: None,
            shortfall_credits: None,
            remaining_calls: None,
            is_credit_based: false,
        };
    };
    let credit_balance = limits
        .balance
        .as_ref()
        .and_then(|balance| balance.credit_balance)
        .or(limits.credit_balance);
    let credits_per_call = limits
        .balance
        .as_ref()
        .and_then(|balance| balance.credits_per_unit)
        .or(limits.credits_per_unit);
    let is_credit_based = credit_balance.is_some() || credits_per_call.is_some();
    let shortfall_credits = match (credit_balance, credits_per_call) {
        (Some(balance), Some(cost)) => Some((cost - balance).max(0.0)),
        _ => None,
    };
    let remaining_calls = if let Some(units) = limits
        .balance
        .as_ref()
        .and_then(|balance| balance.remaining_units)
    {
        Some(units)
    } else if let (Some(balance), Some(cost)) = (credit_balance, credits_per_call) {
        if cost > 0.0 {
            Some((balance / cost).floor())
        } else {
            remaining_from_allowance(limits.remaining)
        }
    } else {
        remaining_from_allowance(limits.remaining)
    };
    CreditSignals {
        credit_balance,
        credits_per_call,
        shortfall_credits,
        remaining_calls,
        is_credit_based,
    }
}

/// Keep a remaining-allowance count when the backend sent a non-negative value.
fn remaining_from_allowance(remaining: Option<f64>) -> Option<f64> {
    remaining.filter(|value| *value >= 0.0)
}

/// Map a classified paywall state to its single primary recovery action.
///
/// # Arguments
///
/// * `state` - Classified paywall state.
///
/// # Returns
///
/// The recovery action an agent should take next.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall",
    emit_order = 43
)]
pub fn next_action_for(state: &PaywallState) -> PaywallNextAction {
    match state {
        PaywallState::ActivationRequired => PaywallNextAction::Activate,
        PaywallState::TopupRequired => PaywallNextAction::Topup,
        PaywallState::UpgradeRequired | PaywallState::LimitReached => PaywallNextAction::Checkout,
        PaywallState::ReactivationRequired => PaywallNextAction::Account,
    }
}

/// Escape markdown link-label delimiters — plan names are provider-authored.
///
/// # Arguments
///
/// * `name` - Plan display name or reference.
///
/// # Returns
///
/// Label safe to embed in `[label](url)`.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall",
    emit_order = 44
)]
pub fn link_label(name: &str) -> String {
    let mut escaped = String::with_capacity(name.len());
    for ch in name.chars() {
        match ch {
            '[' => escaped.push_str("\\["),
            ']' => escaped.push_str("\\]"),
            other => escaped.push(other),
        }
    }
    escaped
}

/// Cheapest-first markdown checkout ladder from plans that carry a `checkoutUrl`.
///
/// Drops the active `gate.plan_ref`, sorts by `price` ascending, and takes 4.
///
/// # Arguments
///
/// * `gate` - Gate content carrying `plans` and the active `plan_ref`.
///
/// # Returns
///
/// Joined ` · ` markdown links, or `None` when no plan is linkable.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall",
    emit_order = 45
)]
pub fn plan_ladder(gate: &GateContent) -> Option<String> {
    let mut linkable = gate
        .plans
        .as_deref()
        .unwrap_or(&[])
        .iter()
        .filter(|plan| {
            plan.checkout_url
                .as_deref()
                .is_some_and(|url| !url.is_empty())
        })
        .filter(|plan| Some(plan.reference.as_str()) != gate.plan_ref.as_deref())
        .collect::<Vec<_>>();
    if linkable.is_empty() {
        return None;
    }
    linkable.sort_by(|a, b| a.price.unwrap_or(0.0).total_cmp(&b.price.unwrap_or(0.0)));
    linkable.truncate(4);
    let links = linkable
        .into_iter()
        .map(|plan| {
            let label = link_label(plan.name.as_deref().unwrap_or(plan.reference.as_str()));
            let url = plan.checkout_url.as_deref().unwrap_or_default();
            format!("[{label}]({url})")
        })
        .collect::<Vec<_>>()
        .join(" · ");
    Some(format!(
        "{links} (first link used closes the rest; links expire in {CHECKOUT_SESSION_TTL_MINUTES} minutes)"
    ))
}

/// Format a credit count with thousands grouping (`91,000`).
fn format_credits(value: f64) -> String {
    format_grouped_major(value, 0)
}

/// Non-empty checkout URL, or `None` when absent / empty string.
///
/// Matches TypeScript `url && url.length > 0`.
fn non_empty_url(url: Option<&str>) -> Option<&str> {
    url.filter(|u| !u.is_empty())
}

/// Produce the terminal-friendly gate message for `state`.
///
/// Inlines `gate.checkout_url` when non-empty, except for
/// [`PaywallState::ReactivationRequired`] which never inlines the URL.
///
/// # Arguments
///
/// * `state` - Classified paywall state.
/// * `gate` - Structured gate content (`checkout_url`, counters, price).
///
/// # Returns
///
/// Frozen copy string stating the block, reason, price, and recovery URL.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall state / gate / payload",
    emit_order = 37
)]
pub fn build_gate_message(state: &PaywallState, gate: &GateContent) -> String {
    let url = non_empty_url(gate.checkout_url.as_deref());
    let ladder = plan_ladder(gate);

    match state {
        PaywallState::LimitReached => {
            let price = unit_price_display(gate);
            let used_line = match &gate.included {
                Some(included) => format!(
                    "You've used {} of {} included {} this period.",
                    format_count(included.used),
                    format_count(included.total),
                    meter_label(gate.meter_name.as_deref())
                ),
                None => "You've reached the included usage for this period.".to_owned(),
            };
            let next_line = price.map_or(String::new(), |p| format!(" The next call is {p}."));
            let plan_name = gate.plan_name.as_deref().unwrap_or("This plan");
            let anti_trap = if gate.credit_balance.is_some_and(|balance| balance > 0.0)
                && gate.credits_per_call.is_none_or(|cost| cost == 0.0)
            {
                format!(" Adding credits will not help, because {plan_name} does not spend them.")
            } else {
                String::new()
            };
            let switch_line = match &ladder {
                Some(ladder) => format!(" Or switch plan: {ladder}."),
                None => recover_clause(url, "continue", Some("checkout"), "Open checkout"),
            };
            format!("{used_line}{next_line}{anti_trap}{switch_line} {DOCS_HINT}")
        }
        PaywallState::ActivationRequired => format!(
            "Your plan needs activation.{} Or call `activate_plan` with a `planRef`. {DOCS_HINT}",
            recover_clause(url, "activate", Some("checkout"), "Open checkout")
        ),
        PaywallState::TopupRequired => {
            let lead = match (
                gate.credit_balance,
                gate.credits_per_call,
                gate.shortfall_credits,
            ) {
                (Some(balance), Some(cost), Some(shortfall)) => format!(
                    "Out of credits for this call. Balance {} credits; this call costs {} credits — {} short.",
                    format_credits(balance),
                    format_credits(cost),
                    format_credits(shortfall)
                ),
                _ => "Included usage is exhausted.".to_owned(),
            };
            let topup = recover_clause(url, "add credits", Some("topup"), "Add credits");
            let auto = if gate
                .auto_recharge
                .as_ref()
                .is_some_and(|config| !config.enabled)
            {
                " Auto-recharge is off — turn it on from the account tool to avoid this next time."
            } else {
                ""
            };
            let switch_line = match &ladder {
                Some(ladder) => format!(" Or switch plan: {ladder}."),
                None => String::new(),
            };
            format!("{lead}{topup}{auto}{switch_line} {DOCS_HINT}")
        }
        PaywallState::UpgradeRequired => {
            if has_active_plan(gate) {
                let plan_name = gate.plan_name.as_deref().unwrap_or("This plan");
                let lead = format!(
                    "{plan_name} is active but its included usage is exhausted, and the automatic switch to the next plan did not complete."
                );
                return match &ladder {
                    Some(ladder) => format!("{lead} Switch here: {ladder}. {DOCS_HINT}"),
                    None => format!(
                        "{lead}{} {DOCS_HINT}",
                        recover_clause(url, "switch plan", Some("checkout"), "Open checkout")
                    ),
                };
            }
            match &ladder {
                Some(ladder) => format!(
                    "You don't have an active plan for this tool. Pick a plan to use this tool: {ladder}, or {}. {DOCS_HINT}",
                    call_viewer(Some("checkout"))
                ),
                None => format!(
                    "You don't have an active plan for this tool.{} {DOCS_HINT}",
                    recover_clause(url, "pick a plan", Some("checkout"), "Open checkout")
                ),
            }
        }
        PaywallState::ReactivationRequired => format!(
            "Your previous plan is no longer active. {} to reactivate it, or {} to pick a new plan. {DOCS_HINT}",
            capitalize_call(call_viewer(Some("account"))),
            call_viewer(Some("checkout"))
        ),
    }
}

/// Markdown link for a pasteable checkout URL.
fn named_checkout_markdown(url: &str, label: &str) -> String {
    format!("[{label}]({url})")
}

/// Built-in tool agents call to inspect account, checkout, or top-up views.
const VIEWER_TOOL: &str = "account";

/// Instruction to call the account tool, optionally pinned to a view.
fn call_viewer(view: Option<&str>) -> String {
    match view {
        Some(view) => format!("call the `{VIEWER_TOOL}` tool with view: '{view}'"),
        None => format!("call the `{VIEWER_TOOL}` tool"),
    }
}

/// Capitalize the first character so the clause can start a sentence.
fn capitalize_call(call: String) -> String {
    let mut chars = call.chars();
    match chars.next() {
        Some(first) => format!("{}{}", first.to_ascii_uppercase(), chars.as_str()),
        None => call,
    }
}

/// URL + TTL clause, or a tool-only fallback when no checkout URL exists.
fn recover_clause(url: Option<&str>, verb: &str, view: Option<&str>, label: &str) -> String {
    match url {
        Some(url) => format!(
            " {} to {verb} (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes), or {}.",
            named_checkout_markdown(url, label),
            call_viewer(view)
        ),
        None => format!(" {}.", capitalize_call(call_viewer(view))),
    }
}

/// True when the customer already holds a purchase or an active plan ref.
fn has_active_plan(gate: &GateContent) -> bool {
    gate.purchase_ref
        .as_deref()
        .is_some_and(|value| !value.is_empty())
        || gate
            .plan_ref
            .as_deref()
            .is_some_and(|value| !value.is_empty())
}

/// Human meter name, or `"units"` when the backend omitted one.
fn meter_label(meter_name: Option<&str>) -> String {
    meter_name.map_or_else(|| "units".to_owned(), |name| name.replace('_', " "))
}

/// Formatted per-unit price from gate recovery fields.
fn unit_price_display(gate: &GateContent) -> Option<String> {
    let amount = gate.unit_price_minor?;
    let currency = gate.currency.as_deref()?;
    Some(format_money_intl(amount, currency))
}

/// Integer-preferring count for included-usage copy.
fn format_count(value: f64) -> String {
    if value.fract() == 0.0 {
        format!("{}", value as i64)
    } else {
        value.to_string()
    }
}

/// Produce low-balance / approaching-cap nudge copy for `state`.
///
/// # Arguments
///
/// * `state` - Classified paywall state (as if the customer had tripped the gate).
/// * `limits` - Limits used only for optional `checkout_url` inlining.
///
/// # Returns
///
/// Frozen nudge string, byte-identical to the TypeScript helpers.
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall state / gate / payload",
    emit_order = 38
)]
pub fn build_nudge_message(state: &PaywallState, limits: Option<&PaywallLimits>) -> String {
    let url = limits.and_then(|l| non_empty_url(l.checkout_url.as_deref()));
    let visit_clause = url.map_or(String::new(), |u| {
        format!(", or {}", named_checkout_markdown(u, "Open checkout"))
    });
    let remaining = credit_signals(limits).remaining_calls;

    match state {
        PaywallState::TopupRequired => {
            if remaining == Some(0.0) {
                format!(
                    "Heads up — 0 calls left — the next call needs a top-up. {} to add more{visit_clause}.",
                    capitalize_call(call_viewer(Some("topup")))
                )
            } else {
                format!(
                    "Heads up — running low on credits. {} to add more{visit_clause}.",
                    capitalize_call(call_viewer(Some("topup")))
                )
            }
        }
        PaywallState::UpgradeRequired | PaywallState::LimitReached => {
            if remaining == Some(0.0) {
                format!(
                    "Heads up — 0 calls left — the next call needs a top-up. {} for more headroom{visit_clause}.",
                    capitalize_call(call_viewer(Some("checkout")))
                )
            } else {
                format!(
                    "Heads up — approaching your plan's limit this period. {} for more headroom{visit_clause}.",
                    capitalize_call(call_viewer(Some("checkout")))
                )
            }
        }
        PaywallState::ActivationRequired => format!(
            "Heads up — this plan still needs activation. Call the `activate_plan` tool with a `planRef`{visit_clause}."
        ),
        PaywallState::ReactivationRequired => format!(
            "Heads up — your plan is no longer active. {} to reactivate it{visit_clause}.",
            capitalize_call(call_viewer(Some("account")))
        ),
    }
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

    fn usage_plan(reference: &str) -> PaywallPlanSummary {
        PaywallPlanSummary {
            reference: reference.to_owned(),
            plan_type: "usage-based".to_owned(),
            requires_payment: Some(true),
            ..Default::default()
        }
    }

    fn recurring_plan(reference: &str) -> PaywallPlanSummary {
        PaywallPlanSummary {
            reference: reference.to_owned(),
            plan_type: "recurring".to_owned(),
            requires_payment: Some(true),
            ..Default::default()
        }
    }

    #[test]
    fn null_limits_is_upgrade() {
        assert_eq!(classify_paywall_state(None), PaywallState::UpgradeRequired);
    }

    #[test]
    fn activation_required_trumps_all() {
        let limits = PaywallLimits {
            activation_required: Some(true),
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            balance: Some(PaywallBalance {
                credit_balance: Some(0.0),
                currency: None,
                ..Default::default()
            }),
            plans: Some(vec![usage_plan("pl_pro")]),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::ActivationRequired
        );
    }

    #[test]
    fn usage_based_nested_credit_zero_is_topup() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(5.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: Some(PaywallBalance {
                credit_balance: Some(0.0),
                currency: None,
                ..Default::default()
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn usage_based_toplevel_credit_zero_is_topup() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(5.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: None,
            credit_balance: Some(0.0),
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn usage_based_remaining_zero_fallback_is_topup() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::LimitReached
        );
    }

    #[test]
    fn balance_block_presence_is_usage_based_proxy() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_other".into()),
            remaining: Some(5.0),
            plans: None,
            balance: Some(PaywallBalance {
                credit_balance: Some(0.0),
                currency: None,
                ..Default::default()
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn usage_based_nonzero_balance_is_limit_reached() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: Some(PaywallBalance {
                credit_balance: Some(100.0),
                credits_per_unit: Some(1.0),
                remaining_units: None,
                currency: None,
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..PaywallLimits::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::LimitReached
        );
    }

    #[test]
    fn usage_based_remaining_nonzero_without_credit_channels_is_upgrade() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(3.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
        );
    }

    #[test]
    fn recurring_at_cap_is_limit_reached() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![recurring_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::LimitReached
        );
    }

    #[test]
    fn plans_none_match_is_limit_reached() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_missing".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::LimitReached
        );
    }

    /// TS `limits.balance !== undefined` treats explicit `balance: null` as present,
    /// but serde `Option<PaywallBalance>` collapses JSON null and absent to `None`.
    /// No fixture covers explicit-null balance; we keep null ≡ absent.
    #[test]
    fn explicit_null_balance_treated_as_absent() {
        let limits: PaywallLimits = serde_json::from_value(serde_json::json!({
            "plan": "pl_pro",
            "remaining": 0,
            "plans": [{ "reference": "pl_pro", "type": "usage-based", "requiresPayment": true }],
            "balance": null
        }))
        .unwrap();
        assert!(limits.balance.is_none());
        // Credit-field absence + an active plan at cap is included-usage
        // exhaustion (row 7), not a top-up.
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::LimitReached
        );
    }

    #[test]
    fn nested_credit_wins_over_toplevel_when_present() {
        // Nested Some(0) wins via ?? semantics even if top-level is non-zero.
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(5.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: Some(PaywallBalance {
                credit_balance: Some(0.0),
                currency: None,
                ..Default::default()
            }),
            credit_balance: Some(100.0),
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn gate_messages_byte_exact() {
        let with_url = GateContent {
            checkout_url: Some("https://pay.test/x".into()),
            ..GateContent::default()
        };
        let empty_url = GateContent {
            checkout_url: Some(String::new()),
            ..GateContent::default()
        };
        let no_url = GateContent::default();
        let at_cap = GateContent {
            checkout_url: Some("https://pay.test/x".into()),
            meter_name: Some("merchant_lookups".into()),
            unit_price_minor: Some(2.0),
            currency: Some("usd".into()),
            included: Some(IncludedUsage {
                total: 3.0,
                used: 3.0,
                remaining: 0.0,
            }),
            ..GateContent::default()
        };

        assert_eq!(
            build_gate_message(&PaywallState::ActivationRequired, &with_url),
            "Your plan needs activation. [Open checkout](https://pay.test/x) to activate (expires in 15 minutes), or call the `account` tool with view: 'checkout'. Or call `activate_plan` with a `planRef`. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::ActivationRequired, &empty_url),
            "Your plan needs activation. Call the `account` tool with view: 'checkout'. Or call `activate_plan` with a `planRef`. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &with_url),
            "Included usage is exhausted. [Add credits](https://pay.test/x) to add credits (expires in 15 minutes), or call the `account` tool with view: 'topup'. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &no_url),
            "Included usage is exhausted. Call the `account` tool with view: 'topup'. See docs://solvapay/overview.md."
        );
        let shortfall = GateContent {
            checkout_url: Some("https://pay.test/x".into()),
            credit_balance: Some(91_000.0),
            credits_per_call: Some(100_000.0),
            shortfall_credits: Some(9_000.0),
            ..GateContent::default()
        };
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &shortfall),
            "Out of credits for this call. Balance 91,000 credits; this call costs 100,000 credits — 9,000 short. [Add credits](https://pay.test/x) to add credits (expires in 15 minutes), or call the `account` tool with view: 'topup'. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &with_url),
            "You don't have an active plan for this tool. [Open checkout](https://pay.test/x) to pick a plan (expires in 15 minutes), or call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &empty_url),
            "You don't have an active plan for this tool. Call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::LimitReached, &at_cap),
            "You've used 3 of 3 included merchant lookups this period. The next call is $0.02. [Open checkout](https://pay.test/x) to continue (expires in 15 minutes), or call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::ReactivationRequired, &with_url),
            "Your previous plan is no longer active. Call the `account` tool with view: 'account' to reactivate it, or call the `account` tool with view: 'checkout' to pick a new plan. See docs://solvapay/overview.md."
        );
    }

    #[test]
    fn nudge_messages_byte_exact() {
        let with_url = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(1.0),
            plans: None,
            balance: None,
            credit_balance: None,
            checkout_url: Some("https://pay.test/x".into()),
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
            ..Default::default()
        };
        let no_url = PaywallLimits {
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            ..with_url.clone()
        };
        let empty_url = PaywallLimits {
            checkout_url: Some(String::new()),
            ..with_url.clone()
        };

        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&with_url)),
            "Heads up — running low on credits. Call the `account` tool with view: 'topup' to add more, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&no_url)),
            "Heads up — running low on credits. Call the `account` tool with view: 'topup' to add more."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::UpgradeRequired, Some(&with_url)),
            "Heads up — approaching your plan's limit this period. Call the `account` tool with view: 'checkout' for more headroom, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::UpgradeRequired, None),
            "Heads up — approaching your plan's limit this period. Call the `account` tool with view: 'checkout' for more headroom."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ActivationRequired, Some(&empty_url)),
            "Heads up — this plan still needs activation. Call the `activate_plan` tool with a `planRef`."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ActivationRequired, Some(&with_url)),
            "Heads up — this plan still needs activation. Call the `activate_plan` tool with a `planRef`, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&with_url)),
            "Heads up — your plan is no longer active. Call the `account` tool with view: 'account' to reactivate it, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&no_url)),
            "Heads up — your plan is no longer active. Call the `account` tool with view: 'account' to reactivate it."
        );
        let zero_calls = PaywallLimits {
            remaining: Some(0.0),
            ..with_url.clone()
        };
        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&zero_calls)),
            "Heads up — 0 calls left — the next call needs a top-up. Call the `account` tool with view: 'topup' to add more, or [Open checkout](https://pay.test/x)."
        );
    }

    #[test]
    fn needs_top_up_flag_is_topup() {
        let limits = PaywallLimits {
            needs_top_up: Some(true),
            plan: Some("pl_pro".into()),
            remaining: Some(5.0),
            plans: Some(vec![recurring_plan("pl_pro")]),
            credit_balance: Some(100.0),
            ..PaywallLimits::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn needs_upgrade_flag_is_upgrade() {
        let limits = PaywallLimits {
            needs_upgrade: Some(true),
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            credit_balance: Some(0.0),
            ..PaywallLimits::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
        );
    }

    #[test]
    fn activation_trumps_needs_top_up() {
        let limits = PaywallLimits {
            activation_required: Some(true),
            needs_top_up: Some(true),
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            ..PaywallLimits::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::ActivationRequired
        );
    }

    #[test]
    fn needs_top_up_overrides_usage_based_heuristic() {
        let limits = PaywallLimits {
            needs_top_up: Some(true),
            plan: Some("pl_pro".into()),
            remaining: Some(5.0),
            plans: Some(vec![recurring_plan("pl_pro")]),
            credit_balance: Some(100.0),
            ..PaywallLimits::default()
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn paywall_state_serde_kind_tag() {
        let json = serde_json::to_value(PaywallState::TopupRequired).unwrap();
        assert_eq!(json, serde_json::json!({ "kind": "topup_required" }));
        let back: PaywallState = serde_json::from_value(json).unwrap();
        assert_eq!(back, PaywallState::TopupRequired);
    }
}
