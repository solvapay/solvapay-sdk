//! Rust fixture runner for the Phase 0 §5.3 golden-fixture corpus.

pub mod bindings;
pub mod discover;
pub mod error;
pub mod model;
pub mod runner;
pub mod sdk_error;

pub use sdk_error::sdk_error_to_observation;

pub use bindings::create_default_registry;
pub use discover::{discover_fixtures, DiscoveredFixture};
pub use error::{RunnerError, RunnerResult};
pub use model::{
    parse_fixture, Fixture, FixtureErrorExpect, FixtureExpect, FixtureInput, HttpMethod, Wire,
    WireRequest, WireResponse,
};
pub use runner::{
    format_summary, run_suite, Binding, BindingError, BindingRegistry, ErrorObservation,
    FixtureFailure, SuiteSummary,
};

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests;
