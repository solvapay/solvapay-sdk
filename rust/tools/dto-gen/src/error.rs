//! Generator errors — no panic paths.

use std::path::PathBuf;

use thiserror::Error;

/// Recoverable failures while reading the OpenAPI snapshot or writing generated Rust.
#[derive(Debug, Error)]
pub enum GenError {
    /// Snapshot JSON failed to parse or did not match the expected OpenAPI shape.
    #[error("openapi parse error: {0}")]
    Parse(String),

    /// Filesystem read/write failure.
    #[error("IO error for {path}: {source}")]
    Io {
        /// Path that could not be read or written.
        path: PathBuf,
        /// Underlying OS I/O error.
        #[source]
        source: std::io::Error,
    },

    /// CLI invoked without required arguments.
    #[error(
        "usage: dto-gen --snapshot <sdk-v1.snapshot.json> --out <crates/solvapay-dto/src> \
         [--manifest <sdk-contract.yaml>] [--ts-out <overlays.generated.d.ts>] \
         [--ts-client-out <client.generated.d.ts>] \
         [--ts-parity-out <signature-parity.generated.test.ts>] \
         [--native-py-out <_native.py>] [--py-stub-out <__init__.pyi>] \
         [--py-parity-out <signature_parity_generated_test.py>] \
         [--native-rb-out <_native.rb>] [--rb-client-out <client.rb>] \
         [--rb-rbs-out <solvapay.rbs>] [--rb-parity-out <signature-parity.rb>]"
    )]
    Usage,

    /// A referenced schema name was missing from `components.schemas`.
    #[error("unknown schema ref: {0}")]
    UnknownRef(String),

    /// Emitter hit a schema shape it cannot represent yet.
    #[error("unsupported schema shape for {name}: {detail}")]
    Unsupported {
        /// Type or field being emitted.
        name: String,
        /// Why emission failed.
        detail: String,
    },

    /// One or more catalogued entry points lack a non-empty `docs.summary` (§5.6 / D19).
    #[error(
        "doc-comment coverage: missing non-empty docs.summary for: {}",
        missing.join(", ")
    )]
    DocCoverage {
        /// Sorted catalog ids missing a usable summary.
        missing: Vec<String>,
    },
}

/// Result alias used throughout dto-gen.
pub type GenResult<T> = Result<T, GenError>;
