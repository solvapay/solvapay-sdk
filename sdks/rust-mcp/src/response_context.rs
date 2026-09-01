//! Merchant-facing payable context (`respond` / `gate` / `emit`).

use serde_json::Value;
use solvapay::CustomerSnapshot;
use solvapay_core::mcp::ResponseEnvelope;
use solvapay_mcp_core::mcp_default_gate;

use crate::layer2::{assert_response_result, make_response_result};
use crate::register::PayableError;

/// Customer projection on [`ResponseContext`].
#[derive(Debug, Clone)]
pub struct CustomerView {
    /// Backend customer reference.
    pub customer_ref: String,
    /// Credit balance.
    pub balance: Value,
    /// Remaining allowance.
    pub remaining: Value,
    /// Whether the last limits check was within limits.
    pub within_limits: Value,
    /// Plan field from limits.
    pub plan: Value,
}

impl From<CustomerSnapshot> for CustomerView {
    fn from(snap: CustomerSnapshot) -> Self {
        Self {
            customer_ref: snap.customer_ref,
            balance: snap.balance,
            remaining: snap.remaining,
            within_limits: snap.within_limits,
            plan: snap.plan,
        }
    }
}

/// Product projection on [`ResponseContext`].
#[derive(Debug, Clone)]
pub struct ProductView {
    /// Product reference.
    pub reference: String,
    /// Display name (same as the reference for V1).
    pub name: String,
}

/// Branded allow envelope. Only [`ResponseContext::respond`] can construct this.
#[derive(Debug, Clone)]
pub struct PayableResponse(pub(crate) ResponseEnvelope);

/// Context passed to a payable tool handler.
#[derive(Debug)]
pub struct ResponseContext {
    /// Customer snapshot from the last limits check.
    customer: CustomerView,
    /// Product projection for this tool.
    product: ProductView,
    /// Product reference used when assembling a handler-invoked gate.
    product_ref: String,
    /// Content blocks queued by [`ResponseContext::emit`].
    emitted: Vec<Value>,
}

impl ResponseContext {
    /// Build a context for one payable invocation.
    pub(crate) fn new(customer: CustomerView, product: ProductView, product_ref: String) -> Self {
        Self {
            customer,
            product,
            product_ref,
            emitted: Vec::new(),
        }
    }

    /// Customer snapshot from the last limits check.
    pub fn customer(&self) -> &CustomerView {
        &self.customer
    }

    /// Product projection for this tool.
    pub fn product(&self) -> &ProductView {
        &self.product
    }

    /// Queue a content block flushed before the text block at respond time.
    pub fn emit(&mut self, block: Value) {
        self.emitted.push(block);
    }

    /// Produce the branded allow envelope via layer 2.
    ///
    /// # Errors
    ///
    /// Returns [`PayableError::Handler`] when the envelope fails the brand check.
    pub fn respond(
        &mut self,
        data: Value,
        options: Option<Value>,
    ) -> Result<PayableResponse, PayableError> {
        let emitted = std::mem::take(&mut self.emitted);
        let envelope = make_response_result(data, options, emitted);
        let value = serde_json::to_value(&envelope)
            .map_err(|e| PayableError::Handler(format!("serialize response envelope: {e}")))?;
        assert_response_result(&value)?;
        Ok(PayableResponse(envelope))
    }

    /// Stop the handler and format a paywall result. Default reason is `Payment required`.
    pub fn gate(&self, reason: Option<&str>) -> PayableError {
        let gate = mcp_default_gate(&self.product_ref, reason);
        PayableError::Gate {
            message: gate.message.clone(),
            gate: Box::new(gate),
        }
    }
}
