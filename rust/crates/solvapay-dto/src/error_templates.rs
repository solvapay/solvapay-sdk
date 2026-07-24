// @generated — do not edit. Regenerate with: pnpm gen

//! Frozen error message templates from `contract/manifest/sdk-contract.yaml`.

/// Webhook verification messages keyed by stable code.
pub mod webhook {
    /// Frozen message for `invalid_payload`.
    pub const INVALID_PAYLOAD: &str = "Invalid webhook payload: body is not valid JSON";
    /// Frozen message for `invalid_signature`.
    pub const INVALID_SIGNATURE: &str = "Invalid webhook signature";
    /// Frozen message for `malformed_signature`.
    pub const MALFORMED_SIGNATURE: &str = "Malformed webhook signature";
    /// Frozen message for `missing_signature`.
    pub const MISSING_SIGNATURE: &str = "Missing webhook signature";
    /// Frozen message for `timestamp_too_old`.
    pub const TIMESTAMP_TOO_OLD: &str = "Webhook signature timestamp too old";
}

/// Paywall throw messages (`PaywallError` construction).
pub mod paywall {
    /// Frozen throw message for `activation_required`.
    pub const ACTIVATION_REQUIRED: &str = "Activation required";
    /// Frozen throw message for `payment_required`.
    pub const PAYMENT_REQUIRED: &str = "Payment required";
}

/// MCP adapter-internal frozen messages (step 34).
pub mod mcp {
    /// Frozen message for `rawHandlerReturn`.
    pub const RAW_HANDLER_RETURN: &str = "SolvaPay: registerPayable handler returned a raw value. Handlers must return ctx.respond(data, options?). If you believe you did, this is an internal bug — please file an issue at https://github.com/solvapay/solvapay-sdk/issues.";
}

/// Transport failure template (step 21).
pub mod transport {
    /// Default transport message template.
    pub const MESSAGE_TEMPLATE: &str = "{message}";
}

/// All manifest client operation ids (camelCase, sorted).
pub const OPERATION_NAMES: &[&str] = &[
    "activatePlan",
    "assignCredits",
    "attachBusinessDetails",
    "bootstrapMcpProduct",
    "cancelPurchase",
    "checkLimits",
    "cloneProduct",
    "configureMcpPlans",
    "createCheckoutSession",
    "createCustomer",
    "createCustomerSession",
    "createPaymentIntent",
    "createPlan",
    "createProduct",
    "createTopupPaymentIntent",
    "deletePlan",
    "deleteProduct",
    "disableAutoRecharge",
    "getAutoRecharge",
    "getCustomer",
    "getCustomerBalance",
    "getMerchant",
    "getPaymentMethod",
    "getPlatformConfig",
    "getProduct",
    "getUserInfo",
    "listPlans",
    "listProducts",
    "processPaymentIntent",
    "reactivatePurchase",
    "saveAutoRecharge",
    "trackUsage",
    "trackUsageBulk",
    "updateCustomer",
    "updatePlan",
    "updateProduct",
];

/// Per-operation HTTP / validation message templates.
pub mod operations {
    /// Templates for `activatePlan`.
    pub mod activate_plan {
        /// Default failure template.
        pub const DEFAULT: &str = "Activate plan failed ({status}): {body}";
    }
    /// Templates for `assignCredits`.
    pub mod assign_credits {
        /// Default failure template.
        pub const DEFAULT: &str = "Assign credits failed ({status}): {body}";
    }
    /// Templates for `attachBusinessDetails`.
    pub mod attach_business_details {
        /// Default failure template.
        pub const DEFAULT: &str = "Attach business details failed ({status}): {body}";
    }
    /// Templates for `bootstrapMcpProduct`.
    pub mod bootstrap_mcp_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Bootstrap MCP product failed ({status}): {body}";
    }
    /// Templates for `cancelPurchase`.
    pub mod cancel_purchase {
        /// Default failure template.
        pub const DEFAULT: &str = "Cancel purchase failed ({status}): {body}";
        /// Status- / shape-specific case templates (manifest order).
        pub const CASES: &[&str] = &[
            "Purchase not found: {body}",
            "Purchase cannot be cancelled or does not belong to provider: {body}",
            "Invalid JSON response from cancel purchase endpoint: {bodyPrefix200}",
            "Invalid response structure from cancel purchase endpoint",
            "Invalid purchase data in cancel purchase response",
        ];
    }
    /// Templates for `checkLimits`.
    pub mod check_limits {
        /// Default failure template.
        pub const DEFAULT: &str = "Check limits failed ({status}): {body}";
    }
    /// Templates for `cloneProduct`.
    pub mod clone_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Clone product failed ({status}): {body}";
    }
    /// Templates for `configureMcpPlans`.
    pub mod configure_mcp_plans {
        /// Default failure template.
        pub const DEFAULT: &str = "Configure MCP plans failed ({status}): {body}";
    }
    /// Templates for `createCheckoutSession`.
    pub mod create_checkout_session {
        /// Default failure template.
        pub const DEFAULT: &str = "Create checkout session failed ({status}): {body}";
    }
    /// Templates for `createCustomer`.
    pub mod create_customer {
        /// Default failure template.
        pub const DEFAULT: &str = "Create customer failed ({status}): {body}";
    }
    /// Templates for `createCustomerSession`.
    pub mod create_customer_session {
        /// Default failure template.
        pub const DEFAULT: &str = "Create customer session failed ({status}): {body}";
    }
    /// Templates for `createPaymentIntent`.
    pub mod create_payment_intent {
        /// Default failure template.
        pub const DEFAULT: &str = "Create payment intent failed ({status}): {body}";
    }
    /// Templates for `createPlan`.
    pub mod create_plan {
        /// Default failure template.
        pub const DEFAULT: &str = "Create plan failed ({status}): {body}";
    }
    /// Templates for `createProduct`.
    pub mod create_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Create product failed ({status}): {body}";
    }
    /// Templates for `createTopupPaymentIntent`.
    pub mod create_topup_payment_intent {
        /// Default failure template.
        pub const DEFAULT: &str = "Create topup payment intent failed ({status}): {body}";
    }
    /// Templates for `deletePlan`.
    pub mod delete_plan {
        /// Default failure template.
        pub const DEFAULT: &str = "Delete plan failed ({status}): {body}";
    }
    /// Templates for `deleteProduct`.
    pub mod delete_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Delete product failed ({status}): {body}";
    }
    /// Templates for `disableAutoRecharge`.
    pub mod disable_auto_recharge {
        /// Default failure template.
        pub const DEFAULT: &str = "Disable auto-recharge failed ({status}): {body}";
    }
    /// Templates for `getAutoRecharge`.
    pub mod get_auto_recharge {
        /// Default failure template.
        pub const DEFAULT: &str = "Get auto-recharge failed ({status}): {body}";
    }
    /// Templates for `getCustomer`.
    pub mod get_customer {
        /// Default failure template.
        pub const DEFAULT: &str = "Get customer failed ({status}): {body}";
        /// Status- / shape-specific case templates (manifest order).
        pub const CASES: &[&str] = &[
            "One of customerRef, externalRef, or email must be provided",
            "No customer found with externalRef: {externalRef}",
        ];
    }
    /// Templates for `getCustomerBalance`.
    pub mod get_customer_balance {
        /// Default failure template.
        pub const DEFAULT: &str = "Get customer balance failed ({status}): {body}";
    }
    /// Templates for `getMerchant`.
    pub mod get_merchant {
        /// Default failure template.
        pub const DEFAULT: &str = "Get merchant failed ({status}): {body}";
    }
    /// Templates for `getPaymentMethod`.
    pub mod get_payment_method {
        /// Default failure template.
        pub const DEFAULT: &str = "Get payment method failed ({status}): {body}";
    }
    /// Templates for `getPlatformConfig`.
    pub mod get_platform_config {
        /// Default failure template.
        pub const DEFAULT: &str = "Get platform config failed ({status}): {body}";
    }
    /// Templates for `getProduct`.
    pub mod get_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Get product failed ({status}): {body}";
    }
    /// Templates for `getUserInfo`.
    pub mod get_user_info {
        /// Default failure template.
        pub const DEFAULT: &str = "Get user info failed ({status}): {body}";
    }
    /// Templates for `listPlans`.
    pub mod list_plans {
        /// Default failure template.
        pub const DEFAULT: &str = "List plans failed ({status}): {body}";
    }
    /// Templates for `listProducts`.
    pub mod list_products {
        /// Default failure template.
        pub const DEFAULT: &str = "List products failed ({status}): {body}";
    }
    /// Templates for `processPaymentIntent`.
    pub mod process_payment_intent {
        /// Default failure template.
        pub const DEFAULT: &str = "Process payment failed ({status}): {body}";
    }
    /// Templates for `reactivatePurchase`.
    pub mod reactivate_purchase {
        /// Default failure template.
        pub const DEFAULT: &str = "Reactivate purchase failed ({status}): {body}";
        /// Status- / shape-specific case templates (manifest order).
        pub const CASES: &[&str] = &[
            "Purchase not found: {body}",
            "Purchase cannot be reactivated: {body}",
            "Invalid JSON response from reactivate purchase endpoint: {bodyPrefix200}",
            "Invalid response structure from reactivate purchase endpoint",
            "Invalid purchase data in reactivate purchase response",
        ];
    }
    /// Templates for `saveAutoRecharge`.
    pub mod save_auto_recharge {
        /// Default failure template.
        pub const DEFAULT: &str = "Save auto-recharge failed ({status}): {body}";
    }
    /// Templates for `trackUsage`.
    pub mod track_usage {
        /// Default failure template.
        pub const DEFAULT: &str = "Track usage failed ({status}): {body}";
    }
    /// Templates for `trackUsageBulk`.
    pub mod track_usage_bulk {
        /// Default failure template.
        pub const DEFAULT: &str = "Track usage bulk failed ({status}): {body}";
    }
    /// Templates for `updateCustomer`.
    pub mod update_customer {
        /// Default failure template.
        pub const DEFAULT: &str = "Update customer failed ({status}): {body}";
    }
    /// Templates for `updatePlan`.
    pub mod update_plan {
        /// Default failure template.
        pub const DEFAULT: &str = "Update plan failed ({status}): {body}";
    }
    /// Templates for `updateProduct`.
    pub mod update_product {
        /// Default failure template.
        pub const DEFAULT: &str = "Update product failed ({status}): {body}";
    }
}
