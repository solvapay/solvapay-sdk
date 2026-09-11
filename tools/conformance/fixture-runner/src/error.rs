//! Runner errors — no panic paths.

use std::path::PathBuf;

use thiserror::Error;

/// Recoverable failures while discovering, parsing, or executing fixtures.
#[derive(Debug, Error)]
pub enum RunnerError {
    /// Schema or shape violation while parsing fixture JSON in memory.
    #[error("fixture parse error: {0}")]
    Parse(String),

    /// Invalid JSON or fixture content at a specific file path.
    #[error("invalid fixture at {path}: {message}")]
    InvalidFixture {
        /// Path to the fixture file that failed validation.
        path: PathBuf,
        /// Parse or schema error message.
        message: String,
    },

    /// Filesystem read failure for a fixture file.
    #[error("IO error for {path}: {source}")]
    Io {
        /// Path that could not be read.
        path: PathBuf,
        /// Underlying OS I/O error.
        #[source]
        source: std::io::Error,
    },

    /// Directory walk or fixtures-root validation failure.
    #[error("walk error: {0}")]
    Walk(String),

    /// CLI invoked without exactly one fixtures-root argument.
    #[error("usage: fixture-runner <fixtures-root>")]
    Usage,
}

/// Result alias used throughout the fixture runner.
pub type RunnerResult<T> = Result<T, RunnerError>;
