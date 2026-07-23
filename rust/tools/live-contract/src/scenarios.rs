//! Port of `contract/shadow/scenarios.ts` / Python `live_contract.py` SCENARIOS.

use std::sync::LazyLock;

use serde_json::{json, Value};

/// Optional backend capability gate for a scenario.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Requires {
    /// Needs Stripe-enabled sandbox.
    Stripe,
    /// Needs an active purchase ref (skipped in single-side live).
    ActivePurchase,
}

/// One live-contract scenario.
#[derive(Debug, Clone)]
pub struct Scenario {
    /// Stable scenario id (report key).
    pub id: &'static str,
    /// CamelCase operation name (manifest / dispatch).
    pub op: &'static str,
    /// JSON args template (`{productRef}` placeholders).
    pub args: Value,
    /// Optional capability requirement.
    pub requires: Option<Requires>,
    /// When true, a structured SDK error scores IDENTICAL.
    pub expect_error: bool,
    /// Skip reason when capability gate trips.
    pub skip_reason: Option<&'static str>,
}

/// All live scenarios (36 unique ops + bogus probes) in dependency order.
pub static SCENARIOS: LazyLock<Vec<Scenario>> = LazyLock::new(|| {
    vec![
        Scenario {
            id: "getMerchant",
            op: "getMerchant",
            args: json!({}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "getPlatformConfig",
            op: "getPlatformConfig",
            args: json!({}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "createProduct",
            op: "createProduct",
            args: json!({"name": "Shadow Product Scenario {sideTag}", "config": {}, "metadata": {}}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "listProducts",
            op: "listProducts",
            args: json!({}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "getProduct",
            op: "getProduct",
            args: json!({"productRef": "{productRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "updateProduct",
            op: "updateProduct",
            args: json!({"productRef": "{productRef}", "name": "Shadow Product Updated {sideTag}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "cloneProduct",
            op: "cloneProduct",
            args: json!({"productRef": "{productRef}", "name": "Shadow Product Clone {sideTag}"}),
            requires: None,
            expect_error: true,
            skip_reason: None,
        },
        Scenario {
            id: "bootstrapMcpProduct",
            op: "bootstrapMcpProduct",
            args: json!({"originUrl": "https://mcp.shadow.example.com", "metadata": {}}),
            requires: None,
            expect_error: true,
            skip_reason: None,
        },
        Scenario {
            id: "configureMcpPlans",
            op: "configureMcpPlans",
            args: json!({"productRef": "{productRef}", "plans": []}),
            requires: None,
            expect_error: true,
            skip_reason: None,
        },
        Scenario {
            id: "createPlan",
            op: "createPlan",
            args: json!({
                "productRef": "{productRef}",
                "name": "Shadow Plan",
                "type": "recurring",
                "billingCycle": "monthly",
                "price": 1000,
                "currency": "usd"
            }),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "listPlans",
            op: "listPlans",
            args: json!({"productRef": "{productRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "updatePlan",
            op: "updatePlan",
            args: json!({
                "productRef": "{productRef}",
                "planRef": "{planRef}",
                "name": "Shadow Plan Updated"
            }),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "createCustomer",
            op: "createCustomer",
            args: json!({"email": "shadow-create-{sideTag}@example.com"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "getCustomer",
            op: "getCustomer",
            args: json!({"customerRef": "{customerRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "updateCustomer",
            op: "updateCustomer",
            args: json!({"customerRef": "{customerRef}", "name": "Shadow Customer"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "assignCredits",
            op: "assignCredits",
            args: json!({"customerRef": "{customerRef}", "credits": 25}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "getCustomerBalance",
            op: "getCustomerBalance",
            args: json!({"customerRef": "{customerRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "getUserInfo",
            op: "getUserInfo",
            args: json!({"customerRef": "{customerRef}", "productRef": "{productRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "checkLimits",
            op: "checkLimits",
            args: json!({"customerRef": "{customerRef}", "productRef": "{productRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "trackUsage",
            op: "trackUsage",
            args: json!({"customerRef": "{customerRef}", "actionType": "api_call", "units": 1}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "trackUsageBulk",
            op: "trackUsageBulk",
            args: json!({
                "events": [{"customerRef": "{customerRef}", "actionType": "api_call", "units": 1}]
            }),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "createCheckoutSession",
            op: "createCheckoutSession",
            args: json!({"productRef": "{productRef}", "customerRef": "{customerRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "createCustomerSession",
            op: "createCustomerSession",
            args: json!({"customerRef": "{customerRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "activatePlan",
            op: "activatePlan",
            args: json!({
                "customerRef": "{customerRef}",
                "productRef": "{productRef}",
                "planRef": "{planRef}"
            }),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "createPaymentIntent",
            op: "createPaymentIntent",
            args: json!({
                "productRef": "{productRef}",
                "planRef": "{planRef}",
                "customerRef": "{customerRef}"
            }),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "createTopupPaymentIntent",
            op: "createTopupPaymentIntent",
            args: json!({
                "customerRef": "{customerRef}",
                "productRef": "{productRef}",
                "amount": 500,
                "currency": "USD"
            }),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "processPaymentIntent",
            op: "processPaymentIntent",
            args: json!({
                "processorPaymentId": "{paymentIntentId}",
                "customerRef": "{customerRef}"
            }),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "attachBusinessDetails",
            op: "attachBusinessDetails",
            args: json!({
                "paymentIntentId": "{paymentIntentId}",
                "businessName": "Shadow Co",
                "country": "US"
            }),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "cancelPurchase",
            op: "cancelPurchase",
            args: json!({"purchaseRef": "{purchaseRef}"}),
            requires: Some(Requires::ActivePurchase),
            expect_error: false,
            skip_reason: Some("requires: activePurchase"),
        },
        Scenario {
            id: "reactivatePurchase",
            op: "reactivatePurchase",
            args: json!({"purchaseRef": "{purchaseRef}"}),
            requires: Some(Requires::ActivePurchase),
            expect_error: false,
            skip_reason: Some("requires: activePurchase"),
        },
        Scenario {
            id: "getPaymentMethod",
            op: "getPaymentMethod",
            args: json!({"customerRef": "{customerRef}"}),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe (Stripe customer)"),
        },
        Scenario {
            id: "getAutoRecharge",
            op: "getAutoRecharge",
            args: json!({"customerRef": "{customerRef}"}),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "saveAutoRecharge",
            op: "saveAutoRecharge",
            args: json!({
                "customerRef": "{customerRef}",
                "enabled": true,
                "threshold": 100,
                "topupAmount": 500
            }),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "disableAutoRecharge",
            op: "disableAutoRecharge",
            args: json!({"customerRef": "{customerRef}"}),
            requires: Some(Requires::Stripe),
            expect_error: false,
            skip_reason: Some("requires: stripe"),
        },
        Scenario {
            id: "getProduct-bogus",
            op: "getProduct",
            args: json!({"productRef": "prd_shadow_does_not_exist_zzzz"}),
            requires: None,
            expect_error: true,
            skip_reason: None,
        },
        Scenario {
            id: "getCustomer-bogus",
            op: "getCustomer",
            args: json!({"customerRef": "cus_shadow_does_not_exist_zzzz"}),
            requires: None,
            expect_error: true,
            skip_reason: None,
        },
        Scenario {
            id: "deletePlan",
            op: "deletePlan",
            args: json!({"productRef": "{productRef}", "planRef": "{planRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
        Scenario {
            id: "deleteProduct",
            op: "deleteProduct",
            args: json!({"productRef": "{productRef}"}),
            requires: None,
            expect_error: false,
            skip_reason: None,
        },
    ]
});
