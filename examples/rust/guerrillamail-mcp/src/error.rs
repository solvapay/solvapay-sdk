//! Example-level errors that fail loudly (no silent defaults).

use std::fmt;

/// Recoverable failure in this example (source, session, env, or handler).
#[derive(Debug)]
pub struct ExampleError {
    /// Caller-visible reason.
    message: String,
}

impl ExampleError {
    /// Build an error with a caller-visible message.
    #[must_use]
    pub fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }

    /// Message text.
    #[must_use]
    pub fn message(&self) -> &str {
        &self.message
    }
}

impl fmt::Display for ExampleError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.message)
    }
}

impl std::error::Error for ExampleError {}

impl From<ExampleError> for solvapay_mcp::PayableError {
    fn from(value: ExampleError) -> Self {
        Self::Handler(value.message)
    }
}
