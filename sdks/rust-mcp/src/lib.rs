//! Payable MCP tools for SolvaPay over the `rmcp` SDK.

#![allow(clippy::result_large_err)]

mod layer2;
mod register;
mod response_context;

pub use register::{
    invoke_payable, register_payable_tool, GetCustomerRef, PayableError, PayableHandler,
    PayableTool,
};
pub use response_context::{CustomerView, PayableResponse, ProductView, ResponseContext};

#[cfg(feature = "test-seams")]
pub use layer2::set_format_gate_override;
