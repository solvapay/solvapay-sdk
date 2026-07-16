//! Rust fixture runner for the Phase 0 §5.3 golden-fixture corpus.

pub mod discover;
pub mod error;
pub mod model;
pub mod runner;

pub use discover::{discover_fixtures, DiscoveredFixture};
pub use error::{RunnerError, RunnerResult};
pub use model::{
    parse_fixture, Fixture, FixtureErrorExpect, FixtureExpect, FixtureInput, HttpMethod, Wire,
    WireRequest, WireResponse,
};
pub use runner::{format_summary, run_suite, BindingRegistry, SuiteSummary};

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod tests;
