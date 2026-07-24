//! Paywall state classification and gate/nudge copy (§6.3).
//!
//! Pure helpers from `packages/server/src/paywall-state.ts`: classify a limits
//! response into a recovery-tool-specific [`PaywallState`], then produce the
//! frozen human-readable gate / nudge message strings.

use serde::{Deserialize, Serialize};

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
}

/// Nested balance block from newer backend responses.
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallBalance {
    /// Credit balance in credits (nested channel).
    pub credit_balance: Option<f64>,
}

/// Minimal deserializable limits input for classification and nudge copy.
///
/// Typed DTOs arrive at step 15; this mirrors the fields the TS helpers read.
#[derive(Debug, Clone, PartialEq, Deserialize)]
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
}

/// Gate structured-content fields read by [`build_gate_message`].
#[derive(Debug, Clone, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GateContent {
    /// Checkout URL inlined into gate copy when non-empty.
    pub checkout_url: Option<String>,
}

/// Classify limits into a [`PaywallState`].
///
/// Precedence mirrors TypeScript `classifyPaywallState`:
/// 1. `activation_required == Some(true)` trumps everything.
/// 2. Usage-based out of credits → `topup_required` (plan type, or balance-block
///    proxy; credit channels then `remaining === 0` fallback).
/// 3. Everything else (including `None` limits) → `upgrade_required`.
///
/// # Arguments
///
/// * `limits` - Limits response, or `None` on degraded paths (`null` in JSON).
///
/// # Returns
///
/// Recovery-tool-specific state. Never returns [`PaywallState::ReactivationRequired`].
pub fn classify_paywall_state(limits: Option<&PaywallLimits>) -> PaywallState {
    let Some(limits) = limits else {
        return PaywallState::UpgradeRequired;
    };

    if limits.activation_required == Some(true) {
        return PaywallState::ActivationRequired;
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
/// * `gate` - Structured gate content (only `checkout_url` is read).
///
/// # Returns
///
/// Frozen copy string, byte-identical to the TypeScript helpers.
pub fn build_gate_message(state: &PaywallState, gate: &GateContent) -> String {
    let url = non_empty_url(gate.checkout_url.as_deref());
    let open_clause = url.map_or(String::new(), |u| format!(", or open {u} in a browser"));

    match state {
        PaywallState::ActivationRequired => format!(
            "Your plan needs activation before you can use this tool. Call the `activate_plan` tool to activate it{open_clause}."
        ),
        PaywallState::TopupRequired => {
            format!("You're out of credits. Call the `topup` tool to add more{open_clause}.")
        }
        PaywallState::UpgradeRequired => format!(
            "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan{open_clause}."
        ),
        PaywallState::ReactivationRequired => {
            "Your previous plan is no longer active. Call the `manage_account` tool to reactivate it, or the `upgrade` tool to pick a new plan."
                .to_owned()
        }
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
pub fn build_nudge_message(state: &PaywallState, limits: Option<&PaywallLimits>) -> String {
    let url = limits.and_then(|l| non_empty_url(l.checkout_url.as_deref()));
    let visit_clause = url.map_or(String::new(), |u| format!(", or visit {u}"));

    match state {
        PaywallState::TopupRequired => format!(
            "Heads up — running low on credits. Call the `topup` tool to add more{visit_clause}."
        ),
        PaywallState::UpgradeRequired => format!(
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
        }
    }

    fn recurring_plan(reference: &str) -> PaywallPlanSummary {
        PaywallPlanSummary {
            reference: reference.to_owned(),
            plan_type: "recurring".to_owned(),
            requires_payment: Some(true),
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
            }),
            plans: Some(vec![usage_plan("pl_pro")]),
            credit_balance: None,
            checkout_url: None,
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
            }),
            credit_balance: None,
            checkout_url: None,
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
            }),
            credit_balance: None,
            checkout_url: None,
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::TopupRequired
        );
    }

    #[test]
    fn usage_based_nonzero_balance_is_upgrade() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: Some(PaywallBalance {
                credit_balance: Some(100.0),
            }),
            credit_balance: None,
            checkout_url: None,
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
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
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
        );
    }

    #[test]
    fn recurring_at_cap_is_upgrade() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_pro".into()),
            remaining: Some(0.0),
            plans: Some(vec![recurring_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
        );
    }

    #[test]
    fn plans_none_match_is_upgrade() {
        let limits = PaywallLimits {
            activation_required: None,
            plan: Some("pl_missing".into()),
            remaining: Some(0.0),
            plans: Some(vec![usage_plan("pl_pro")]),
            balance: None,
            credit_balance: None,
            checkout_url: None,
        };
        assert_eq!(
            classify_paywall_state(Some(&limits)),
            PaywallState::UpgradeRequired
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
            }),
            credit_balance: Some(100.0),
            checkout_url: None,
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
        };
        let empty_url = GateContent {
            checkout_url: Some(String::new()),
        };
        let no_url = GateContent { checkout_url: None };

        assert_eq!(
            build_gate_message(&PaywallState::ActivationRequired, &with_url),
            "Your plan needs activation before you can use this tool. Call the `activate_plan` tool to activate it, or open https://pay.test/x in a browser."
        );
        assert_eq!(
            build_gate_message(&PaywallState::ActivationRequired, &empty_url),
            "Your plan needs activation before you can use this tool. Call the `activate_plan` tool to activate it."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &with_url),
            "You're out of credits. Call the `topup` tool to add more, or open https://pay.test/x in a browser."
        );
        assert_eq!(
            build_gate_message(&PaywallState::TopupRequired, &no_url),
            "You're out of credits. Call the `topup` tool to add more."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &with_url),
            "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan, or open https://pay.test/x in a browser."
        );
        assert_eq!(
            build_gate_message(&PaywallState::UpgradeRequired, &empty_url),
            "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan."
        );
        // Reactivation gate copy never inlines the URL.
        assert_eq!(
            build_gate_message(&PaywallState::ReactivationRequired, &with_url),
            "Your previous plan is no longer active. Call the `manage_account` tool to reactivate it, or the `upgrade` tool to pick a new plan."
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
        };
        let no_url = PaywallLimits {
            checkout_url: None,
            ..with_url.clone()
        };
        let empty_url = PaywallLimits {
            checkout_url: Some(String::new()),
            ..with_url.clone()
        };

        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&with_url)),
            "Heads up — running low on credits. Call the `topup` tool to add more, or visit https://pay.test/x."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::TopupRequired, Some(&no_url)),
            "Heads up — running low on credits. Call the `topup` tool to add more."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::UpgradeRequired, Some(&with_url)),
            "Heads up — approaching your plan's limit this period. Call the `upgrade` tool for more headroom, or visit https://pay.test/x."
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
            "Heads up — this plan still needs activation. Call the `activate_plan` tool, or visit https://pay.test/x."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&with_url)),
            "Heads up — your plan is no longer active. Call the `manage_account` tool to reactivate it, or visit https://pay.test/x."
        );
        assert_eq!(
            build_nudge_message(&PaywallState::ReactivationRequired, Some(&no_url)),
            "Heads up — your plan is no longer active. Call the `manage_account` tool to reactivate it."
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
