//! Hand-written fixture-runner bindings that the registry emitter cannot derive.
//!
//! Generated wrap / verbatim invoke bodies and the registration table live in
//! [`crate::registry`]. Remaining host-simulation adapters live in the modules
//! below (`withRetry`, `pollBalanceUntilIncreased`, `constructSdkError`,
//! `resolveAuthenticatedUser`, `verifyWebhook`, `validatePublicBaseUrl`).

pub(crate) mod balance_poll;
pub(crate) mod error_model;
pub(crate) mod helpers;
pub(crate) mod mcp_descriptors;
pub(crate) mod mcp_payload;
pub(crate) mod retry;
pub(crate) mod webhook;
