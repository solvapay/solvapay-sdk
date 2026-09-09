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
use serde_json::{json, Value};

use crate::paywall_state::{
    build_gate_message, classify_paywall_state, credit_signals, next_action_for, GateContent,
    IncludedUsage, PaywallAutoRecharge, PaywallBalance, PaywallLimits, PaywallNextAction,
    PaywallPlanSummary, PaywallRecoveryLinks, PaywallState,
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
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
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
    /// Authoritative backend deny reason: prepaid top-up required.
    #[serde(default)]
    pub needs_top_up: Option<bool>,
    /// Authoritative backend deny reason: auto-upgrade required.
    #[serde(default)]
    pub needs_upgrade: Option<bool>,
    /// Meter name used in included-usage copy and recovery fields.
    #[serde(default)]
    pub meter_name: Option<String>,
    /// Product-level currency when the active plan does not carry one.
    #[serde(default)]
    pub currency: Option<String>,
    /// Authoritative backend paywall classification.
    #[serde(default)]
    pub paywall_reason: Option<String>,
    /// Active plan reference when the customer already holds a purchase.
    #[serde(default)]
    pub plan_ref: Option<String>,
    /// Active purchase reference when the customer already holds a purchase.
    #[serde(default)]
    pub purchase_ref: Option<String>,
    /// Display name of the active or default plan.
    #[serde(default)]
    pub plan_name: Option<String>,
    /// Top-level credits deducted per metered item.
    #[serde(default)]
    pub credits_per_unit: Option<f64>,
    /// Consumed usage units this period when the backend measured a finite cap.
    #[serde(default)]
    pub used: Option<f64>,
    /// Effective finite cap when the backend measured one.
    #[serde(default)]
    pub limit: Option<f64>,
    /// Per-provider auto-recharge snapshot.
    #[serde(default)]
    pub auto_recharge: Option<PaywallAutoRecharge>,
    /// Purchase/plan status when the backend sent one.
    #[serde(default)]
    pub plan_status: Option<String>,
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

impl PaywallGateKind {
    /// Frozen throw text for this kind (`"Activation required"` / `"Payment required"`).
    #[must_use]
    pub const fn short_message(self) -> &'static str {
        match self {
            Self::ActivationRequired => "Activation required",
            Self::PaymentRequired => "Payment required",
        }
    }
}

/// Ready-to-serialize paywall gate (`PaywallStructuredContent` parity).
///
/// `checkout_url` and `message` are always present (`checkout_url` may be `""`).
/// Optional blocks are emitted only when present in the input (never `null`).
/// Recovery fields (`planRef`, `plans`, counters, price) land on both branches.
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
    /// Kind-derived throw text (`"Activation required"` / `"Payment required"`).
    pub short_message: String,
    /// Confirmation URL echoed on the activation branch when present in the input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub confirmation_url: Option<String>,
    /// Product plans echoed on both branches when present.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plans: Option<Value>,
    /// Quota balance echoed verbatim when present in the input.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub balance: Option<Value>,
    /// Rich product context echoed verbatim (input `product` → `productDetails`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub product_details: Option<Value>,
    /// Active plan reference from `limits.plan`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_ref: Option<String>,
    /// Meter name from the limits response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub meter_name: Option<String>,
    /// Per-unit charge from the active plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub unit_price_minor: Option<f64>,
    /// Currency from the active plan or the limits response.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub currency: Option<String>,
    /// Included counters when `freeUnits` is a positive cap.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub included: Option<IncludedUsage>,
    /// Coalesced credit balance (`balance.creditBalance ?? creditBalance`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credit_balance: Option<f64>,
    /// Classified [`PaywallState::kind`].
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    /// Single primary recovery the agent should take.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub next_action: Option<PaywallNextAction>,
    /// Display name of the active or default plan.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_name: Option<String>,
    /// Credits deducted per call.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub credits_per_call: Option<f64>,
    /// `max(0, creditsPerCall - creditBalance)` when both are known.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub shortfall_credits: Option<f64>,
    /// How many calls the current allowance or wallet still covers.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub remaining_calls: Option<f64>,
    /// Active purchase reference.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub purchase_ref: Option<String>,
    /// Purchase/plan status when the backend sent one.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub plan_status: Option<String>,
    /// Per-provider auto-recharge snapshot.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub auto_recharge: Option<PaywallAutoRecharge>,
    /// Global destinations. Per-plan URLs stay on `plans[].checkoutUrl`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub links: Option<PaywallRecoveryLinks>,
}

impl Default for PaywallGate {
    fn default() -> Self {
        Self {
            kind: PaywallGateKind::PaymentRequired,
            product: String::new(),
            checkout_url: String::new(),
            message: String::new(),
            short_message: String::new(),
            confirmation_url: None,
            plans: None,
            balance: None,
            product_details: None,
            plan_ref: None,
            meter_name: None,
            unit_price_minor: None,
            currency: None,
            included: None,
            credit_balance: None,
            reason: None,
            next_action: None,
            plan_name: None,
            credits_per_call: None,
            shortfall_credits: None,
            remaining_calls: None,
            purchase_ref: None,
            plan_status: None,
            auto_recharge: None,
            links: None,
        }
    }
}

/// JSON Schema for `PaywallStructuredContent` / [`PaywallGate`].
///
/// Payable tools must not default to this schema — a success payload would fail
/// host validation. Pass it explicitly when a tool only ever returns a gate, or
/// union it with a merchant `outputSchema`.
///
/// # Returns
///
/// A JSON Schema `oneOf` with `payment_required` and `activation_required`
/// branches. Recovery fields the backend may omit stay optional; `shortMessage`
/// is required on both branches.
#[must_use]
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall state / gate / payload",
    emit_order = 41
)]
pub fn paywall_structured_content_schema() -> Value {
    json!({
        "oneOf": [
            {
                "type": "object",
                "required": ["kind", "product", "checkoutUrl", "message", "shortMessage"],
                "additionalProperties": true,
                "properties": {
                    "kind": { "const": "payment_required" },
                    "product": { "type": "string" },
                    "checkoutUrl": { "type": "string" },
                    "message": { "type": "string" },
                    "shortMessage": { "type": "string" },
                    "planRef": { "type": "string" },
                    "plans": { "type": "array" },
                    "meterName": { "type": "string" },
                    "unitPriceMinor": { "type": "number" },
                    "currency": { "type": "string" },
                    "included": {
                        "type": "object",
                        "properties": {
                            "total": { "type": "number" },
                            "used": { "type": "number" },
                            "remaining": { "type": "number" }
                        }
                    },
                    "creditBalance": { "type": "number" },
                    "reason": { "type": "string" },
                    "nextAction": { "type": "string" },
                    "planName": { "type": "string" },
                    "creditsPerCall": { "type": "number" },
                    "shortfallCredits": { "type": "number" },
                    "remainingCalls": { "type": "number" },
                    "purchaseRef": { "type": "string" },
                    "planStatus": { "type": "string" },
                    "autoRecharge": {
                        "type": "object",
                        "properties": {
                            "enabled": { "type": "boolean" },
                            "status": { "type": "string" }
                        }
                    },
                    "links": {
                        "type": "object",
                        "properties": {
                            "topup": { "type": "string" },
                            "checkout": { "type": "string" },
                            "manage": { "type": "string" }
                        }
                    },
                    "balance": {},
                    "productDetails": {}
                }
            },
            {
                "type": "object",
                "required": ["kind", "product", "checkoutUrl", "message", "shortMessage"],
                "additionalProperties": true,
                "properties": {
                    "kind": { "const": "activation_required" },
                    "product": { "type": "string" },
                    "checkoutUrl": { "type": "string" },
                    "message": { "type": "string" },
                    "shortMessage": { "type": "string" },
                    "planRef": { "type": "string" },
                    "plans": { "type": "array" },
                    "meterName": { "type": "string" },
                    "unitPriceMinor": { "type": "number" },
                    "currency": { "type": "string" },
                    "included": {
                        "type": "object",
                        "properties": {
                            "total": { "type": "number" },
                            "used": { "type": "number" },
                            "remaining": { "type": "number" }
                        }
                    },
                    "creditBalance": { "type": "number" },
                    "reason": { "type": "string" },
                    "nextAction": { "type": "string" },
                    "planName": { "type": "string" },
                    "creditsPerCall": { "type": "number" },
                    "shortfallCredits": { "type": "number" },
                    "remainingCalls": { "type": "number" },
                    "purchaseRef": { "type": "string" },
                    "planStatus": { "type": "string" },
                    "autoRecharge": {
                        "type": "object",
                        "properties": {
                            "enabled": { "type": "boolean" },
                            "status": { "type": "string" }
                        }
                    },
                    "links": {
                        "type": "object",
                        "properties": {
                            "topup": { "type": "string" },
                            "checkout": { "type": "string" },
                            "manage": { "type": "string" }
                        }
                    },
                    "confirmationUrl": { "type": "string" },
                    "balance": {},
                    "productDetails": {}
                }
            }
        ]
    })
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
        paywall_reason: limits.paywall_reason.clone(),
        // TS `plan: limits.plan ?? ''` is a no-op here — `None` never matches a
        // plan reference, exactly like the empty-string fallback.
        plan: limits.plan.clone(),
        plan_ref: limits.plan_ref.clone(),
        purchase_ref: limits.purchase_ref.clone(),
        plan_name: limits.plan_name.clone(),
        plans: limits.plans.as_ref().map(|items| {
            items
                .iter()
                .filter_map(|item| serde_json::from_value::<PaywallPlanSummary>(item.clone()).ok())
                .collect()
        }),
        balance: balance
            .and_then(|value| serde_json::from_value::<PaywallBalance>(value.clone()).ok()),
        credit_balance: limits.credit_balance,
        credits_per_unit: limits.credits_per_unit,
        remaining: limits.remaining,
        used: limits.used,
        limit: limits.limit,
        checkout_url: limits.checkout_url.clone(),
        needs_top_up: limits.needs_top_up,
        needs_upgrade: limits.needs_upgrade,
        meter_name: limits.meter_name.clone(),
        currency: limits.currency.clone(),
        auto_recharge: limits.auto_recharge.clone(),
    }
}

/// Machine-readable recovery fields. A field the backend did not send is omitted.
struct RecoveryFields {
    /// Active plan reference from `plan_ref` or deprecated `plan`.
    plan_ref: Option<String>,
    /// Catalog plans from `limits.plans`.
    plans: Option<Value>,
    /// Meter name for included-usage copy.
    meter_name: Option<String>,
    /// Per-unit charge of the active plan, in minor units.
    unit_price_minor: Option<f64>,
    /// ISO currency for [`Self::unit_price_minor`].
    currency: Option<String>,
    /// Included-usage counters when a finite cap is known.
    included: Option<IncludedUsage>,
    /// Credit balance coalesced from nested or top-level fields.
    credit_balance: Option<f64>,
    /// Classified paywall reason.
    reason: Option<String>,
    /// Primary recovery action.
    next_action: Option<PaywallNextAction>,
    /// Display name of the active or default plan.
    plan_name: Option<String>,
    /// Credits deducted per call.
    credits_per_call: Option<f64>,
    /// Shortfall when both balance and cost are known.
    shortfall_credits: Option<f64>,
    /// Remaining call count.
    remaining_calls: Option<f64>,
    /// Active purchase reference.
    purchase_ref: Option<String>,
    /// Purchase/plan status.
    plan_status: Option<String>,
    /// Auto-recharge snapshot.
    auto_recharge: Option<PaywallAutoRecharge>,
    /// Global recovery destinations.
    links: Option<PaywallRecoveryLinks>,
}

/// Active plan reference: `plan_ref` wins over deprecated `plan`; empty → `None`.
fn active_plan_ref_of(limits: &PaywallGateLimits) -> Option<&str> {
    limits
        .plan_ref
        .as_deref()
        .or(limits.plan.as_deref())
        .filter(|value| !value.is_empty())
}

/// Plan object in `limits.plans` whose `reference` matches the active plan ref.
fn active_plan_of(limits: &PaywallGateLimits) -> Option<&Value> {
    let plan_ref = active_plan_ref_of(limits)?;
    limits
        .plans
        .as_ref()?
        .iter()
        .find(|p| p.get("reference").and_then(Value::as_str) == Some(plan_ref))
}

/// Included counters: measured `used`/`limit` win over plan-derived `freeUnits`.
fn included_from_limits(limits: &PaywallGateLimits) -> Option<IncludedUsage> {
    if let (Some(used), Some(limit)) = (limits.used, limits.limit) {
        return Some(IncludedUsage {
            total: limit,
            used,
            remaining: limits.remaining.unwrap_or(0.0),
        });
    }
    let plan = active_plan_of(limits)?;
    let total = plan.get("freeUnits").and_then(Value::as_f64)?;
    if total == 0.0 {
        return None;
    }
    let remaining = limits.remaining?;
    Some(IncludedUsage {
        total,
        used: (total - remaining).max(0.0),
        remaining,
    })
}

/// Map checkout / confirmation URLs onto the named recovery link slots.
fn recovery_links(
    limits: &PaywallGateLimits,
    state: &PaywallState,
) -> Option<PaywallRecoveryLinks> {
    let mut links = PaywallRecoveryLinks::default();
    if let Some(url) = limits.checkout_url.as_deref().filter(|url| !url.is_empty()) {
        if *state == PaywallState::TopupRequired {
            links.topup = Some(url.to_owned());
        } else {
            links.checkout = Some(url.to_owned());
        }
    }
    if let Some(url) = limits
        .confirmation_url
        .as_deref()
        .filter(|url| !url.is_empty())
    {
        links.manage = Some(url.to_owned());
    }
    if links.topup.is_none() && links.checkout.is_none() && links.manage.is_none() {
        None
    } else {
        Some(links)
    }
}

/// Wire form of the classified reason (`topup_required`, `limit_reached`, …).
fn paywall_reason_wire(state: &PaywallState) -> String {
    match state {
        PaywallState::ActivationRequired => "activation_required",
        PaywallState::TopupRequired => "topup_required",
        PaywallState::UpgradeRequired => "upgrade_required",
        PaywallState::LimitReached => "limit_reached",
        PaywallState::ReactivationRequired => "reactivation_required",
    }
    .to_owned()
}

/// Collect recovery fields for both gate branches. Absent backend data stays `None`.
fn recovery_fields(limits: &PaywallGateLimits, state: &PaywallState) -> RecoveryFields {
    let plan = active_plan_of(limits);
    let included = included_from_limits(limits);
    let view = classifier_view(limits, present(limits.balance.as_ref()));
    let signals = credit_signals(Some(&view));
    let (unit_price_minor, currency) = match plan.and_then(|p| {
        p.get("perUnitChargeMinor")
            .and_then(Value::as_f64)
            .map(|amount| {
                (
                    amount,
                    p.get("currency")
                        .and_then(Value::as_str)
                        .map(ToOwned::to_owned),
                )
            })
    }) {
        Some((amount, currency)) => (Some(amount), currency),
        None => (None, limits.currency.clone()),
    };
    RecoveryFields {
        plan_ref: active_plan_ref_of(limits).map(ToOwned::to_owned),
        plans: limits
            .plans
            .as_ref()
            .map(|items| Value::Array(items.clone())),
        meter_name: limits.meter_name.clone(),
        unit_price_minor,
        currency,
        included,
        credit_balance: signals.credit_balance,
        reason: Some(paywall_reason_wire(state)),
        next_action: Some(next_action_for(state)),
        plan_name: limits.plan_name.clone(),
        credits_per_call: signals.credits_per_call,
        shortfall_credits: signals.shortfall_credits,
        remaining_calls: signals.remaining_calls,
        purchase_ref: limits.purchase_ref.clone(),
        plan_status: limits.plan_status.clone(),
        auto_recharge: limits.auto_recharge.clone(),
        links: recovery_links(limits, state),
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
#[crate::solvapay_export(
    artifact = "decisions",
    catalog = "topLevel",
    section = "paywall state / gate / payload",
    emit_order = 39
)]
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

    let recovery = recovery_fields(limits, &state);
    let typed_plans = limits.plans.as_ref().map(|items| {
        items
            .iter()
            .filter_map(|item| serde_json::from_value::<PaywallPlanSummary>(item.clone()).ok())
            .collect()
    });
    let message = build_gate_message(
        &state,
        &GateContent {
            checkout_url: Some(checkout_url.clone()),
            plan_ref: recovery.plan_ref.clone(),
            plan_name: recovery.plan_name.clone(),
            plans: typed_plans,
            meter_name: recovery.meter_name.clone(),
            unit_price_minor: recovery.unit_price_minor,
            currency: recovery.currency.clone(),
            included: recovery.included.clone(),
            balance: balance
                .and_then(|value| serde_json::from_value::<PaywallBalance>(value.clone()).ok()),
            credit_balance: recovery.credit_balance,
            credits_per_call: recovery.credits_per_call,
            shortfall_credits: recovery.shortfall_credits,
            remaining_calls: recovery.remaining_calls,
            purchase_ref: recovery.purchase_ref.clone(),
            auto_recharge: recovery.auto_recharge.clone(),
        },
    );

    let shared = |kind: PaywallGateKind, confirmation_url: Option<String>| PaywallGate {
        kind,
        product: product_ref.to_owned(),
        checkout_url: checkout_url.clone(),
        message: message.clone(),
        short_message: kind.short_message().to_owned(),
        confirmation_url,
        plans: recovery.plans.clone(),
        balance: balance.cloned(),
        product_details: product.cloned(),
        plan_ref: recovery.plan_ref.clone(),
        meter_name: recovery.meter_name.clone(),
        unit_price_minor: recovery.unit_price_minor,
        currency: recovery.currency.clone(),
        included: recovery.included.clone(),
        credit_balance: recovery.credit_balance,
        reason: recovery.reason.clone(),
        next_action: recovery.next_action,
        plan_name: recovery.plan_name.clone(),
        credits_per_call: recovery.credits_per_call,
        shortfall_credits: recovery.shortfall_credits,
        remaining_calls: recovery.remaining_calls,
        purchase_ref: recovery.purchase_ref.clone(),
        plan_status: recovery.plan_status.clone(),
        auto_recharge: recovery.auto_recharge.clone(),
        links: recovery.links.clone(),
    };

    if activation_branch {
        shared(
            PaywallGateKind::ActivationRequired,
            limits.confirmation_url.clone(),
        )
    } else {
        shared(PaywallGateKind::PaymentRequired, None)
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
                "shortMessage": "Payment required",
                "checkoutUrl": "https://pay.test/x",
                "planRef": "pl_basic",
                "reason": "limit_reached",
                "nextAction": "checkout",
                "remainingCalls": 0.0,
                "links": { "checkout": "https://pay.test/x" },
                "message": "You've reached the included usage for this period. [Open checkout](https://pay.test/x) to continue (expires in 15 minutes), or call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
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
                "shortMessage": "Payment required",
                "checkoutUrl": "",
                "planRef": "pl_basic",
                "reason": "limit_reached",
                "nextAction": "checkout",
                "remainingCalls": 0.0,
                "message": "You've reached the included usage for this period. Call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
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
                "shortMessage": "Payment required",
                "checkoutUrl": "https://pay.test/x",
                "reason": "upgrade_required",
                "nextAction": "checkout",
                "remainingCalls": 0.0,
                "links": { "checkout": "https://pay.test/x" },
                "message": "You don't have an active plan for this tool. [Open checkout](https://pay.test/x) to pick a plan (expires in 15 minutes), or call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
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
                "shortMessage": "Activation required",
                "message": "Your plan needs activation. [Open checkout](https://pay.test/confirm) to activate (expires in 15 minutes), or call the `account` tool with view: 'checkout'. Or call `activate_plan` with a `planRef`. See docs://solvapay/overview.md.",
                "checkoutUrl": "https://pay.test/confirm",
                "confirmationUrl": "https://pay.test/confirm",
                "planRef": "pl_pro",
                "reason": "activation_required",
                "nextAction": "activate",
                "remainingCalls": 0.0,
                "links": { "checkout": "https://pay.test/x", "manage": "https://pay.test/confirm" },
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
                "shortMessage": "Activation required",
                "message": "Out of credits for this call. Balance 0 credits; this call costs 1 credits — 1 short. [Add credits](https://pay.test/x) to add credits (expires in 15 minutes), or call the `account` tool with view: 'topup'. See docs://solvapay/overview.md.",
                "checkoutUrl": "https://pay.test/x",
                "planRef": "pl_pro",
                "creditBalance": 0.0,
                "reason": "topup_required",
                "nextAction": "topup",
                "creditsPerCall": 1.0,
                "shortfallCredits": 1.0,
                "remainingCalls": 0.0,
                "links": { "topup": "https://pay.test/x" },
                "plans": [
                    plan("pl_pro", "usage-based", true),
                    plan("pl_hybrid", "hybrid", true)
                ],
                "balance": { "creditBalance": 0, "creditsPerUnit": 1, "currency": "usd" }
            })
        );
    }

    #[test]
    fn topup_with_recurring_stays_payment_and_keeps_plans() {
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
                "shortMessage": "Payment required",
                "checkoutUrl": "https://pay.test/x",
                "message": "Out of credits for this call. Balance 0 credits; this call costs 1 credits — 1 short. [Add credits](https://pay.test/x) to add credits (expires in 15 minutes), or call the `account` tool with view: 'topup'. See docs://solvapay/overview.md.",
                "planRef": "pl_pro",
                "creditBalance": 0.0,
                "reason": "topup_required",
                "nextAction": "topup",
                "creditsPerCall": 1.0,
                "shortfallCredits": 1.0,
                "remainingCalls": 0.0,
                "links": { "topup": "https://pay.test/x" },
                "plans": [
                    plan("pl_pro", "usage-based", true),
                    plan("pl_pro", "recurring", true)
                ],
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
                "shortMessage": "Payment required",
                "checkoutUrl": "https://pay.test/x",
                "message": "Out of credits for this call. Balance 0 credits; this call costs 1 credits — 1 short. [Add credits](https://pay.test/x) to add credits (expires in 15 minutes), or call the `account` tool with view: 'topup'. See docs://solvapay/overview.md.",
                "planRef": "pl_basic",
                "creditBalance": 0.0,
                "reason": "topup_required",
                "nextAction": "topup",
                "creditsPerCall": 1.0,
                "shortfallCredits": 1.0,
                "remainingCalls": 0.0,
                "links": { "topup": "https://pay.test/x" },
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
                "shortMessage": "Payment required",
                "checkoutUrl": "https://pay.test/x",
                "planRef": "pl_basic",
                "reason": "limit_reached",
                "nextAction": "checkout",
                "remainingCalls": 0.0,
                "links": { "checkout": "https://pay.test/x" },
                "message": "You've reached the included usage for this period. [Open checkout](https://pay.test/x) to continue (expires in 15 minutes), or call the `account` tool with view: 'checkout'. See docs://solvapay/overview.md."
            })
        );
    }

    /// JSON `null` on a raw pass-through field collapses to `None` on deserialize.
    #[test]
    fn null_balance_deserializes_to_none() {
        let limits = limits_from(json!({ "plan": "pl_basic", "remaining": 0, "balance": null }));
        assert!(limits.balance.is_none());
    }

    #[test]
    fn recovery_links_topup_from_paywall_reason_not_url_shape() {
        let actual = gate_value(
            "prd_topup",
            json!({
                "paywallReason": "topup_required",
                "checkoutUrl": "https://pay.example.com/customer/checkout?id=chk_1"
            }),
        );
        assert_eq!(
            actual.get("links"),
            Some(&json!({ "topup": "https://pay.example.com/customer/checkout?id=chk_1" }))
        );
        assert_eq!(actual.get("reason"), Some(&json!("topup_required")));
        assert_eq!(
            actual.get("checkoutUrl"),
            Some(&json!("https://pay.example.com/customer/checkout?id=chk_1"))
        );
        assert!(actual["message"]
            .as_str()
            .unwrap()
            .contains("[Add credits](https://pay.example.com/customer/checkout?id=chk_1)"));
    }
}
