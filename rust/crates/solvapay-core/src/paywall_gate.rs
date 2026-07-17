//! Paywall gate assembly (§9 step 14).
//!
//! Pure port of `buildPaywallGate` from `packages/server/src/paywall-gate.ts`:
//! turn a limits response into the transport-agnostic gate object
//! (`PaywallStructuredContent` parity) used by 402 responses.
//!
//! Orchestrates the step-13 classifier: [`classify_paywall_state`] decides the
//! recovery state and [`build_gate_message`] renders the copy, while this module
//! adds [`all_paid_plans_are_payg`] plus the activation-vs-payment branching and
//! conditional (skip-absent, never-`null`) field emission.

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::paywall_state::{
    build_gate_message, classify_paywall_state, GateContent, PaywallBalance, PaywallLimits,
    PaywallPlanSummary, PaywallState,
};

/// Limits input read by [`build_paywall_gate`].
///
/// Pass-through blocks (`plans`, `balance`, `product`) are kept as raw
/// [`Value`]s so extra keys (`creditsPerUnit`, `currency`, arbitrary product
/// context, …) are echoed verbatim; the typed [`PaywallBalance`] /
/// [`PaywallPlanSummary`] views are derived only to feed the classifier.
///
/// Every field is optional and defaults to absent. JSON `null` collapses to
/// `None` at the serde boundary (null ≡ absent), matching the convention
/// documented on [`crate::paywall_state`].
#[derive(Debug, Clone, PartialEq, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallGateLimits {
    /// Explicit backend flag that no plan is live yet.
    #[serde(default)]
    pub activation_required: Option<bool>,
    /// Active plan reference (matched against plan summaries by the classifier).
    #[serde(default)]
    pub plan: Option<String>,
    /// Available plans; raw pass-through plus PAYG / classify source.
    #[serde(default)]
    pub plans: Option<Vec<Value>>,
    /// Structured balance block; raw pass-through plus usage proxy / credit source.
    #[serde(default)]
    pub balance: Option<Value>,
    /// Top-level credit balance (older / alternate channel).
    #[serde(default)]
    pub credit_balance: Option<f64>,
    /// Remaining allowance (usage-based fallback when credit channels are absent).
    #[serde(default)]
    pub remaining: Option<f64>,
    /// Checkout URL (`||` semantics: empty string is treated as absent).
    #[serde(default)]
    pub checkout_url: Option<String>,
    /// Confirmation URL; takes precedence over `checkout_url` on the activation branch.
    #[serde(default)]
    pub confirmation_url: Option<String>,
    /// Rich product context; raw pass-through emitted as `productDetails`.
    #[serde(default)]
    pub product: Option<Value>,
}

/// Recovery discriminator emitted on the wire as `kind`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum PaywallGateKind {
    /// Generic paid remediation (upgrade / pay).
    PaymentRequired,
    /// Activation or PAYG-topup remediation (plans may be attached).
    ActivationRequired,
}

/// Ready-to-serialize paywall gate (`PaywallStructuredContent` parity).
///
/// `checkout_url` and `message` are always present (`checkout_url` may be `""`).
/// The four optional blocks are emitted only when present in the input (never
/// `null`); the payment branch never emits `plans` / `confirmation_url`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PaywallGate {
    /// Recovery discriminator.
    pub kind: PaywallGateKind,
    /// Product reference echoed from the caller.
    pub product: String,
    /// Best checkout / confirmation URL (may be an empty string).
    pub checkout_url: String,
    /// Frozen gate copy from [`build_gate_message`].
    pub message: String,
    /// Confirmation URL echoed on the activation branch when present in the input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_url: Option<String>,
    /// Product plans echoed verbatim on the activation branch when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Value>,
    /// Quota balance echoed verbatim when present in the input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<Value>,
    /// Rich product context echoed verbatim (input `product` → `productDetails`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_details: Option<Value>,
}

/// Non-empty string, or `None` when absent / empty (JS `||` truthiness).
///
/// Mirrors `non_empty_url` in [`crate::paywall_state`].
fn non_empty(value: Option<&str>) -> Option<&str> {
    value.filter(|s| !s.is_empty())
}

/// Raw pass-through value, or `None` when absent or JSON `null` (null ≡ absent).
///
/// Keeps the never-`null` guarantee even for values constructed directly (serde
/// already collapses `null` to `None` for these fields on deserialize).
fn present(value: Option<&Value>) -> Option<&Value> {
    value.filter(|v| !v.is_null())
}

/// Whether the only paid remediation on this product is a topup.
///
/// `false` when no plans are supplied or the list is empty; free plans
/// (`requiresPayment == Some(false)`) are filtered out first, and `false` when
/// no paid plans remain. Otherwise `true` iff every paid plan `type` is
/// `usage-based` or `hybrid`. Fields are read structurally off the raw
/// [`Value`]s to match the TypeScript helper's duck-typing.
///
/// # Arguments
///
/// * `plans` - Raw plan objects, or `None` when the input omitted `plans`.
///
/// # Returns
///
/// `true` when every paid plan is PAYG (`usage-based` / `hybrid`).
fn all_paid_plans_are_payg(plans: Option<&[Value]>) -> bool {
    let Some(plans) = plans else {
        return false;
    };
    if plans.is_empty() {
        return false;
    }
    // TS `p.requiresPayment !== false`: absent / non-bool stays paid.
    let mut paid = plans
        .iter()
        .filter(|p| p.get("requiresPayment").and_then(Value::as_bool) != Some(false))
        .peekable();
    if paid.peek().is_none() {
        return false;
    }
    paid.all(|p| {
        matches!(
            p.get("type").and_then(Value::as_str),
            Some("usage-based") | Some("hybrid")
        )
    })
}

/// Builds the classifier's typed view from the raw gate limits.
///
/// Extra keys on the raw `plans` / `balance` blocks are ignored; unparsable
/// entries are dropped rather than panicking (defensive — fixtures always
/// supply well-formed plan summaries).
///
/// # Arguments
///
/// * `limits` - Raw gate limits.
/// * `balance` - Pre-normalized balance block (`null` already treated as absent).
///
/// # Returns
///
/// A [`PaywallLimits`] suitable for [`classify_paywall_state`].
fn classifier_view(limits: &PaywallGateLimits, balance: Option<&Value>) -> PaywallLimits {
    PaywallLimits {
        activation_required: limits.activation_required,
        // TS `plan: limits.plan ?? ''` is a no-op here — `None` never matches a
        // plan reference, exactly like the empty-string fallback.
        plan: limits.plan.clone(),
        plans: limits.plans.as_ref().map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<PaywallPlanSummary>(item.clone()).ok())
                .collect()
        }),
        balance: balance
            .and_then(|value| serde_json::from_value::<PaywallBalance>(value.clone()).ok()),
        credit_balance: limits.credit_balance,
        remaining: limits.remaining,
        checkout_url: limits.checkout_url.clone(),
    }
}

/// Assemble the paywall gate for a product from a limits response.
///
/// Classifies the recovery [`PaywallState`], optionally reclassifies a PAYG
/// `topup_required` state onto the activation branch (so downstream UI can show
/// topup-flavored copy with plans attached), computes the effective checkout
/// URL, then emits the branch-specific fields and the rendered message.
///
/// # Arguments
///
/// * `product_ref` - Product reference echoed onto the gate.
/// * `limits` - Limits response driving classification and pass-through.
///
/// # Returns
///
/// A [`PaywallGate`] ready to serialize into a 402 response.
pub fn build_paywall_gate(product_ref: &str, limits: &PaywallGateLimits) -> PaywallGate {
    // Normalize `null` pass-through blocks to absent (never-`null` guarantee).
    let balance = present(limits.balance.as_ref());
    let product = present(limits.product.as_ref());

    let state = classify_paywall_state(Some(&classifier_view(limits, balance)));

    // Reclassify a PAYG `topup_required` state onto the activation branch (plans
    // attached) so downstream UI can show topup-flavored copy; the message still
    // reflects the `topup_required` state.
    let use_activation_for_topup = limits.activation_required != Some(true)
        && state == PaywallState::TopupRequired
        && all_paid_plans_are_payg(limits.plans.as_deref());

    let activation_branch = limits.activation_required == Some(true) || use_activation_for_topup;

    // `checkout_url` uses JS `||` truthiness (empty string is falsy). The
    // activation branch prefers `confirmation_url` before `checkout_url`.
    let checkout_url = if activation_branch {
        non_empty(limits.confirmation_url.as_deref()).or(non_empty(limits.checkout_url.as_deref()))
    } else {
        non_empty(limits.checkout_url.as_deref())
    }
    .unwrap_or_default()
    .to_owned();

    let message = build_gate_message(
        &state,
        &GateContent {
            checkout_url: Some(checkout_url.clone()),
        },
    );

    if activation_branch {
        PaywallGate {
            kind: PaywallGateKind::ActivationRequired,
            product: product_ref.to_owned(),
            checkout_url,
            message,
            // TS emits `confirmationUrl` on presence (`!== undefined`); `null`
            // already collapses to `None`, so `Some` marks a present value.
            confirmation_url: limits.confirmation_url.clone(),
            plans: limits
                .plans
                .as_ref()
                .map(|items| Value::Array(items.clone())),
            balance: balance.cloned(),
            product_details: product.cloned(),
        }
    } else {
        // Payment branch never emits `plans` / `confirmation_url`, even when the
        // input carries them.
        PaywallGate {
            kind: PaywallGateKind::PaymentRequired,
            product: product_ref.to_owned(),
            checkout_url,
            message,
            confirmation_url: None,
            plans: None,
            balance: balance.cloned(),
            product_details: product.cloned(),
        }
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
    use serde_json::json;

    fn limits_from(value: Value) -> PaywallGateLimits {
        serde_json::from_value(value).expect("valid gate limits")
    }

    fn gate_value(product_ref: &str, value: Value) -> Value {
        let gate = build_paywall_gate(product_ref, &limits_from(value));
        serde_json::to_value(&gate).expect("serializable gate")
    }

    fn plan(reference: &str, plan_type: &str, requires_payment: bool) -> Value {
        json!({ "reference": reference, "type": plan_type, "requiresPayment": requires_payment })
    }

    #[test]
    fn all_paid_plans_are_payg_none_or_empty_is_false() {
        assert!(!all_paid_plans_are_payg(None));
        assert!(!all_paid_plans_are_payg(Some(&[])));
    }

    #[test]
    fn all_paid_plans_are_payg_all_free_is_false() {
        let plans = [
            plan("pl_free", "usage-based", false),
            plan("pl_free2", "hybrid", false),
        ];
        assert!(!all_paid_plans_are_payg(Some(&plans)));
    }

    #[test]
    fn all_paid_plans_are_payg_mixed_recurring_is_false() {
        let plans = [
            plan("pl_pro", "usage-based", true),
            plan("pl_rec", "recurring", true),
        ];
        assert!(!all_paid_plans_are_payg(Some(&plans)));
    }

    #[test]
    fn all_paid_plans_are_payg_usage_and_hybrid_is_true() {
        let plans = [
            plan("pl_pro", "usage-based", true),
            plan("pl_hybrid", "hybrid", true),
        ];
        assert!(all_paid_plans_are_payg(Some(&plans)));
    }

    #[test]
    fn all_paid_plans_are_payg_ignores_free_recurring_when_paid_are_payg() {
        // A free recurring plan is filtered out; the only paid plan is PAYG.
        let plans = [
            plan("pl_free_rec", "recurring", false),
            plan("pl_pro", "usage-based", true),
        ];
        assert!(all_paid_plans_are_payg(Some(&plans)));
    }

    #[test]
    fn all_paid_plans_are_payg_absent_requires_payment_counts_as_paid() {
        // TS `requiresPayment !== false`: absent means paid → recurring fails.
        let plans = [json!({ "reference": "pl_rec", "type": "recurring" })];
        assert!(!all_paid_plans_are_payg(Some(&plans)));
    }

    #[test]
    fn payment_minimal() {
        let actual = gate_value(
            "prd_demo",
            json!({ "plan": "pl_basic", "remaining": 0, "checkoutUrl": "https://pay.test/x" }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "https://pay.test/x",
                "message": "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan, or open https://pay.test/x in a browser."
            })
        );
    }

    #[test]
    fn payment_no_url_emits_empty_checkout_url() {
        let actual = gate_value("prd_demo", json!({ "plan": "pl_basic", "remaining": 0 }));
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "",
                "message": "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan."
            })
        );
    }

    #[test]
    fn plan_absent_fallback_is_payment() {
        let actual = gate_value(
            "prd_demo",
            json!({ "remaining": 0, "checkoutUrl": "https://pay.test/x" }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "https://pay.test/x",
                "message": "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan, or open https://pay.test/x in a browser."
            })
        );
    }

    #[test]
    fn activation_regular_prefers_confirmation_url() {
        let actual = gate_value(
            "prd_demo",
            json!({
                "plan": "pl_pro",
                "remaining": 0,
                "activationRequired": true,
                "confirmationUrl": "https://pay.test/confirm",
                "checkoutUrl": "https://pay.test/x",
                "plans": [plan("pl_pro", "usage-based", true)]
            }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "activation_required",
                "product": "prd_demo",
                "message": "Your plan needs activation before you can use this tool. Call the `activate_plan` tool to activate it, or open https://pay.test/confirm in a browser.",
                "checkoutUrl": "https://pay.test/confirm",
                "confirmationUrl": "https://pay.test/confirm",
                "plans": [plan("pl_pro", "usage-based", true)]
            })
        );
    }

    #[test]
    fn payg_topup_reclassifies_to_activation_with_topup_message() {
        let actual = gate_value(
            "prd_demo",
            json!({
                "plan": "pl_pro",
                "remaining": 0,
                "checkoutUrl": "https://pay.test/x",
                "plans": [
                    plan("pl_pro", "usage-based", true),
                    plan("pl_hybrid", "hybrid", true)
                ],
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" }
            }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "activation_required",
                "product": "prd_demo",
                "message": "You're out of credits. Call the `topup` tool to add more, or open https://pay.test/x in a browser.",
                "checkoutUrl": "https://pay.test/x",
                "plans": [
                    plan("pl_pro", "usage-based", true),
                    plan("pl_hybrid", "hybrid", true)
                ],
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" }
            })
        );
    }

    #[test]
    fn topup_with_recurring_stays_payment_and_omits_plans() {
        let actual = gate_value(
            "prd_demo",
            json!({
                "plan": "pl_pro",
                "remaining": 0,
                "checkoutUrl": "https://pay.test/x",
                "plans": [
                    plan("pl_pro", "usage-based", true),
                    plan("pl_pro", "recurring", true)
                ],
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" }
            }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "https://pay.test/x",
                "message": "You're out of credits. Call the `topup` tool to add more, or open https://pay.test/x in a browser.",
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" }
            })
        );
    }

    #[test]
    fn payment_with_balance_and_product_passes_extra_keys_through() {
        let actual = gate_value(
            "prd_demo",
            json!({
                "plan": "pl_basic",
                "remaining": 0,
                "checkoutUrl": "https://pay.test/x",
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" },
                "product": { "name": "Demo", "reference": "prd_demo" }
            }),
        );
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "https://pay.test/x",
                "message": "You're out of credits. Call the `topup` tool to add more, or open https://pay.test/x in a browser.",
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" },
                "productDetails": { "name": "Demo", "reference": "prd_demo" }
            })
        );
    }

    /// Explicit `null` pass-through keys must be treated as absent (never `null`),
    /// even when the struct is constructed directly with `Some(Value::Null)`.
    #[test]
    fn null_pass_through_is_omitted() {
        let limits = PaywallGateLimits {
            plan: Some("pl_basic".into()),
            remaining: Some(0.0),
            checkout_url: Some("https://pay.test/x".into()),
            balance: Some(Value::Null),
            product: Some(Value::Null),
            plans: None,
            ..PaywallGateLimits::default()
        };
        let actual = serde_json::to_value(build_paywall_gate("prd_demo", &limits)).unwrap();
        assert_eq!(
            actual,
            json!({
                "kind": "payment_required",
                "product": "prd_demo",
                "checkoutUrl": "https://pay.test/x",
                "message": "You don't have an active plan for this tool. Call the `upgrade` tool to pick a plan, or open https://pay.test/x in a browser."
            })
        );
    }

    /// JSON `null` on a raw pass-through field collapses to `None` on deserialize.
    #[test]
    fn null_balance_deserializes_to_none() {
        let limits = limits_from(json!({ "plan": "pl_basic", "remaining": 0, "balance": null }));
        assert!(limits.balance.is_none());
    }
}
