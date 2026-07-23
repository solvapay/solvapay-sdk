//! Paywall gate ergonomics (§2.4) — outcomes and trackers delegate decisions to core.

#![allow(clippy::missing_docs_in_private_items)]

use solvapay_core::PaywallGate;

use crate::client::Client;

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

/// Allow arm returned from [`Client::gate`]; usage tracking delegates to the typed client.
pub struct Allow {
    pub(crate) client: Client,
    pub(crate) backend_ref: String,
    pub(crate) product: String,
    pub(crate) usage_type: String,
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
    /// Records a successful usage event (`trackUsage`).
    pub async fn track_success(&self, opts: TrackOpts) -> Result<(), solvapay_core::SdkError> {
        self.client
            .track_usage_after_allow(&self.backend_ref, &self.product, &self.usage_type, opts)
            .await
    }

    /// Records a failed usage event (same API call with error metadata).
    pub async fn track_fail(
        &self,
        error: impl std::fmt::Display,
        opts: TrackOpts,
    ) -> Result<(), solvapay_core::SdkError> {
        let mut merged = opts.metadata.unwrap_or_default();
        merged.insert(
            "error".to_owned(),
            serde_json::Value::String(error.to_string()),
        );
        self.track_success(TrackOpts {
            duration: opts.duration,
            metadata: Some(merged),
        })
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
