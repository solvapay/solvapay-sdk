//! Paywall state classification and gate/nudge copy (§6.3).
//!
//! Pure helpers formerly in the TypeScript paywall-state facade: classify a
//! limits response into a recovery-tool-specific [`PaywallState`], then produce
//! the frozen human-readable gate / nudge message strings.

use serde::{Deserialize, Serialize};

use crate::money_format::format_money_intl;

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

/// Minimal plan summary used by the classifier.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallPlanSummary {
    /// Plan reference matching [`PaywallLimits::plan`].
    pub reference: String,
    /// Plan type wire string (`usage-based`, `recurring`, …).
    #[serde(rename = "type")]
    pub plan_type: String,
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
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallBalance {
    /// Credit balance in credits (nested channel).
    pub credit_balance: Option<f64>,
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
    /// Active plan reference (matched against [`PaywallPlanSummary::reference`]).
    pub plan: Option<String>,
    /// Available plans on the product.
    pub plans: Option<Vec<PaywallPlanSummary>>,
    /// Structured balance block (presence is a usage-based proxy).
    pub balance: Option<PaywallBalance>,
    /// Top-level credit balance (older / alternate channel).
    pub credit_balance: Option<f64>,
    /// Remaining allowance (usage-based fallback when credit channels are absent).
    pub remaining: Option<f64>,
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
    /// Meter name used in included-usage copy.
    #[serde(default)]
    pub meter_name: Option<String>,
    /// Next-call unit price in minor units.
    #[serde(default)]
    pub unit_price_minor: Option<f64>,
    /// ISO currency for [`Self::unit_price_minor`] / top-up presets.
    #[serde(default)]
    pub currency: Option<String>,
    /// Included counters when the active plan has a finite `freeUnits`.
    #[serde(default)]
    pub included: Option<IncludedUsage>,
    /// Nested balance (currency fallback for PAYG-at-zero copy).
    #[serde(default)]
    pub balance: Option<PaywallBalance>,
}

/// Classify limits into a [`PaywallState`].
///
/// Precedence mirrors TypeScript `classifyPaywallState`:
/// 1. `activation_required == Some(true)` trumps everything.
/// 2. Authoritative `needs_top_up` / `needs_upgrade` when the backend sent
///    `Some(true)`. Prefer these over the credit-balance heuristic.
/// 3. Usage-based out of credits → `topup_required` (plan type, or balance-block
///    proxy; credit channels then `remaining === 0` fallback).
/// 4. Active plan at included cap (`plan` is a non-empty ref and
///    `remaining <= 0`) → `limit_reached`.
/// 5. Everything else (including `None` limits) → `upgrade_required`.
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

    if limits.activation_required == Some(true) {
        return PaywallState::ActivationRequired;
    }

    if limits.needs_top_up == Some(true) {
        return PaywallState::TopupRequired;
    }

    if limits.needs_upgrade == Some(true) {
        return PaywallState::UpgradeRequired;
    }

    let active_plan = limits.plans.as_ref().and_then(|plans| {
        plans
            .iter()
            .find(|p| Some(p.reference.as_str()) == limits.plan.as_deref())
    });
    // Presence of the balance block is an older-backend proxy for usage-based.
    // Note: serde Option collapses JSON `null` and absent to None (null ≡ absent);
    // TS `!== undefined` would treat explicit null as present — see unit test.
    let is_usage_based =
        active_plan.is_some_and(|p| p.plan_type == "usage-based") || limits.balance.is_some();
    // Nested credit wins when present (`??` parity).
    let credit_balance = limits
        .balance
        .as_ref()
        .and_then(|b| b.credit_balance)
        .or(limits.credit_balance);

    if is_usage_based {
        if credit_balance == Some(0.0) {
            return PaywallState::TopupRequired;
        }
        if credit_balance.is_none() && limits.remaining == Some(0.0) {
            return PaywallState::TopupRequired;
        }
    }

    let plan_ref = limits.plan.as_deref().unwrap_or("");
    if !plan_ref.is_empty() && limits.remaining.is_some_and(|remaining| remaining <= 0.0) {
        return PaywallState::LimitReached;
    }

    PaywallState::UpgradeRequired
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
            format!(
                "{used_line}{next_line}{} {DOCS_HINT}",
                recover_clause(url, "continue", "upgrade")
            )
        }
        PaywallState::ActivationRequired => format!(
            "Your plan needs activation.{} {DOCS_HINT}",
            recover_clause(url, "activate", "activate_plan")
        ),
        PaywallState::TopupRequired => {
            let currency = gate
                .currency
                .as_deref()
                .or_else(|| gate.balance.as_ref().and_then(|b| b.currency.as_deref()))
                .unwrap_or("USD");
            let presets = [1000.0, 2500.0, 5000.0, 10_000.0]
                .into_iter()
                .map(|m| format_money_intl(m, currency))
                .collect::<Vec<_>>()
                .join(" · ");
            format!(
                "You're out of credits. Top up first ({presets}).{} {DOCS_HINT}",
                recover_clause(url, "add credits", "topup")
            )
        }
        PaywallState::UpgradeRequired => format!(
            "You don't have an active plan for this tool.{} {DOCS_HINT}",
            recover_clause(url, "pick a plan", "upgrade")
        ),
        PaywallState::ReactivationRequired => format!(
            "Your previous plan is no longer active. Call the `manage_account` tool to reactivate it, or the `upgrade` tool to pick a new plan. {DOCS_HINT}"
        ),
    }
}

/// Markdown link for a pasteable checkout URL.
fn named_checkout_markdown(url: &str) -> String {
    format!("[Open checkout]({url})")
}

/// URL + TTL clause, or a tool-only fallback when no checkout URL exists.
fn recover_clause(url: Option<&str>, verb: &str, tool: &str) -> String {
    match url {
        Some(url) => format!(
            " {} to {verb} (expires in {CHECKOUT_SESSION_TTL_MINUTES} minutes), or call the `{tool}` tool.",
            named_checkout_markdown(url)
        ),
        None => format!(" Call the `{tool}` tool."),
    }
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
        format!(", or {}", named_checkout_markdown(u))
    });

    match state {
        PaywallState::TopupRequired => format!(
            "Heads up — running low on credits. Call the `topup` tool to add more{visit_clause}."
        ),
        PaywallState::UpgradeRequired | PaywallState::LimitReached => format!(
            "Heads up — approaching your plan's limit this period. Call the `upgrade` tool for more headroom{visit_clause}."
        ),
        PaywallState::ActivationRequired => format!(
            "Heads up — this plan still needs activation. Call the `activate_plan` tool{visit_clause}."
        ),
        PaywallState::ReactivationRequired => format!(
            "Heads up — your plan is no longer active. Call the `manage_account` tool to reactivate it{visit_clause}."
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
            free_units: None,
            per_unit_charge_minor: None,
            currency: None,
        }
    }

    fn recurring_plan(reference: &str) -> PaywallPlanSummary {
        PaywallPlanSummary {
            reference: reference.to_owned(),
            plan_type: "recurring".to_owned(),
            requires_payment: Some(true),
            free_units: None,
            per_unit_charge_minor: None,
            currency: None,
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
            }),
            plans: Some(vec![usage_plan("pl_pro")]),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
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
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
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
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
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
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
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
                currency: None,
            }),
            credit_balance: None,
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
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
        // Without balance block and with no credit channels, remaining===0 on a
        // usage-based plan still tops up via the remaining fallback.
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
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
            }),
            credit_balance: Some(100.0),
            checkout_url: None,
            needs_top_up: None,
            needs_upgrade: None,
            meter_name: None,
            currency: None,
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
            "Your plan needs activation. [Open checkout](https://pay.test/x) to activate (expires in 15 minutes), or call the `activate_plan` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::ActivationRequired, &empty_url),
            "Your plan needs activation. Call the `activate_plan` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &with_url),
            "You're out of credits. Top up first ($10.00 · $25.00 · $50.00 · $100.00). [Open checkout](https://pay.test/x) to add credits (expires in 15 minutes), or call the `topup` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &no_url),
            "You're out of credits. Top up first ($10.00 · $25.00 · $50.00 · $100.00). Call the `topup` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &with_url),
            "You don't have an active plan for this tool. [Open checkout](https://pay.test/x) to pick a plan (expires in 15 minutes), or call the `upgrade` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &empty_url),
            "You don't have an active plan for this tool. Call the `upgrade` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::LimitReached, &at_cap),
            "You've used 3 of 3 included merchant lookups this period. The next call is $0.02. [Open checkout](https://pay.test/x) to continue (expires in 15 minutes), or call the `upgrade` tool. See docs://solvapay/overview.md."
        );
        assert_eq!(
            build_gate_message(&PaywallState::ReactivationRequired, &with_url),
            "Your previous plan is no longer active. Call the `manage_account` tool to reactivate it, or the `upgrade` tool to pick a new plan. See docs://solvapay/overview.md."
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
            "Heads up — running low on credits. Call the `topup` tool to add more, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&no_url)),
            "Heads up — running low on credits. Call the `topup` tool to add more."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::UpgradeRequired, Some(&with_url)),
            "Heads up — approaching your plan's limit this period. Call the `upgrade` tool for more headroom, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::UpgradeRequired, None),
            "Heads up — approaching your plan's limit this period. Call the `upgrade` tool for more headroom."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ActivationRequired, Some(&empty_url)),
            "Heads up — this plan still needs activation. Call the `activate_plan` tool."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ActivationRequired, Some(&with_url)),
            "Heads up — this plan still needs activation. Call the `activate_plan` tool, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&with_url)),
            "Heads up — your plan is no longer active. Call the `manage_account` tool to reactivate it, or [Open checkout](https://pay.test/x)."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&no_url)),
            "Heads up — your plan is no longer active. Call the `manage_account` tool to reactivate it."
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
