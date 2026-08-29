//! Paywall gate ergonomics (§2.4) — outcomes and trackers delegate decisions to core.

#![allow(clippy::missing_docs_in_private_items)]

use crate::client::Client;
use serde_json::Value;
use solvapay_core::PaywallGate;

/// Options for [`Client::gate`].
#[derive(Debug, Clone)]
pub struct GateOpts {
    /// Product reference (`productRef` on limit checks).
    pub product: String,
    /// Meter / usage type (default `"requests"`).
    pub usage_type: String,
}

impl GateOpts {
    /// Builds gate options for a product with the default usage type.
    ///
    /// # Arguments
    ///
    /// * `product` - Product reference.
    ///
    /// # Returns
    ///
    /// Options with `usage_type` set to `"requests"`.
    pub fn for_product(product: impl Into<String>) -> Self {
        Self {
            product: product.into(),
            usage_type: "requests".to_owned(),
        }
    }
}

/// Result of a paywall gate check.
pub enum GateOutcome {
    /// Request is gated; render 402 from structured gate content.
    Paywall(PaywallGate),
    /// Request may proceed; call [`Allow::track_success`] / [`Allow::track_fail`] after work.
    Allow(Allow),
}

/// Merchant-facing customer projection from the last limits check.
#[derive(Debug, Clone, PartialEq)]
pub struct CustomerSnapshot {
    /// Backend customer reference used for usage tracking.
    pub customer_ref: String,
    /// `creditBalance` from limits, or `0` when absent.
    pub balance: Value,
    /// Remaining allowance from limits (may be JSON `null`).
    pub remaining: Value,
    /// `withinLimits` from limits, or `true` when absent.
    pub within_limits: Value,
    /// Plan field from limits (may be JSON `null`).
    pub plan: Value,
}

/// Allow arm returned from [`Client::gate`]; usage tracking delegates to the typed client.
pub struct Allow {
    pub(crate) client: Client,
    pub(crate) backend_ref: String,
    pub(crate) product: String,
    pub(crate) meter_name: String,
    pub(crate) limits: Value,
    pub(crate) customer: CustomerSnapshot,
    pub(crate) driver_state: Value,
}

/// Options for usage tracking after an allowed request.
#[derive(Debug, Clone, Default)]
pub struct TrackOpts {
    /// Optional duration in milliseconds.
    pub duration: Option<f64>,
    /// Optional metadata map (merged on track-fail with an `error` key).
    pub metadata: Option<serde_json::Map<String, serde_json::Value>>,
}

impl Allow {
    /// Customer snapshot used by payable MCP `ResponseContext`.
    pub fn customer(&self) -> CustomerSnapshot {
        self.customer.clone()
    }

    /// Backend customer reference used for usage tracking.
    pub fn backend_ref(&self) -> &str {
        &self.backend_ref
    }

    /// Product reference this allow decision was issued for.
    pub fn product(&self) -> &str {
        &self.product
    }

    /// Meter name used when recording usage for this allow.
    pub fn meter_name(&self) -> &str {
        &self.meter_name
    }

    /// Limits payload from the last successful check.
    pub fn limits(&self) -> &Value {
        &self.limits
    }

    /// Copy the core driver snapshot onto the host `CustomerSnapshot`.
    pub(crate) fn from_core_customer(
        customer: solvapay_core::CustomerSnapshot,
    ) -> CustomerSnapshot {
        CustomerSnapshot {
            customer_ref: customer.customer_ref,
            balance: serde_json::json!(customer.balance),
            remaining: customer.remaining,
            within_limits: serde_json::json!(customer.within_limits),
            plan: customer.plan,
        }
    }

    /// Records a successful usage event (`trackUsage`).
    pub async fn track_success(&self, opts: TrackOpts) -> Result<(), solvapay_core::SdkError> {
        self.client
            .emit_handler_usage(
                &self.driver_state,
                serde_json::json!({
                    "kind": "handlerSucceeded",
                    "durationMs": opts.duration.unwrap_or(0.0),
                    "nowMs": crate::client::now_ms(),
                    "randomUnit": self.client.random_unit(),
                }),
            )
            .await
    }

    /// Records a failed usage event (same API call with error metadata).
    pub async fn track_fail(
        &self,
        error: impl std::fmt::Display,
        opts: TrackOpts,
    ) -> Result<(), solvapay_core::SdkError> {
        self.client
            .emit_handler_usage(
                &self.driver_state,
                serde_json::json!({
                    "kind": "handlerFailed",
                    "durationMs": opts.duration.unwrap_or(0.0),
                    "nowMs": crate::client::now_ms(),
                    "randomUnit": self.client.random_unit(),
                    "errorMessage": error.to_string(),
                    "isPaywallError": false,
                }),
            )
            .await
    }
}

/// Product-scoped gate helper from [`Client::payable`].
#[derive(Clone)]
pub struct Payable {
    pub(crate) client: Client,
    pub(crate) product: String,
    pub(crate) usage_type: String,
}

impl Payable {
    /// Runs [`Client::gate`] with this payable's product and usage type.
    pub async fn gate(&self, customer_ref: &str) -> Result<GateOutcome, solvapay_core::SdkError> {
        self.client
            .gate(
                customer_ref,
                GateOpts {
                    product: self.product.clone(),
                    usage_type: self.usage_type.clone(),
                },
            )
            .await
    }
}
