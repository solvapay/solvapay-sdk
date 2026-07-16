//! Runner errors — no panic paths.

use std::path::PathBuf;

use thiserror::Error;

#[derive(Debug, Error)]
pub enum RunnerError {
    #[error("fixture parse error: {0}")]
    Parse(String),

    #[error("invalid fixture at {path}: {message}")]
    InvalidFixture { path: PathBuf, message: String },

    #[error("IO error for {path}: {source}")]
    Io {
        path: PathBuf,
        #[source]
        source: std::io::Error,
    },

    #[error("walk error: {0}")]
    Walk(String),

    #[error("usage: fixture-runner <fixtures-root>")]
    Usage,
}

pub type RunnerResult<T> = Result<T, RunnerError>;
