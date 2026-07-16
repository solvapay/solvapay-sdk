//! Empty-suite (and later bound) fixture execution.

use std::collections::HashMap;
use std::path::Path;

use crate::discover::{discover_fixtures, DiscoveredFixture};
use crate::error::RunnerResult;

/// Binding registry: `input.fn` → invoker. Empty in step 8; steps 9+ register core fns.
pub type BindingRegistry = HashMap<String, ()>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuiteSummary {
    pub parsed: usize,
    pub executed: usize,
    pub skipped_unbound: usize,
}

/// Parse all fixtures under `root`. With an empty registry, execute none;
/// every fixture is counted as skipped-unbound. Exits conceptually success.
pub fn run_suite(root: &Path, registry: &BindingRegistry) -> RunnerResult<SuiteSummary> {
    let discovered = discover_fixtures(root)?;
    summarize(&discovered, registry)
}

fn summarize(
    discovered: &[DiscoveredFixture],
    registry: &BindingRegistry,
) -> RunnerResult<SuiteSummary> {
    let mut executed = 0usize;
    let mut skipped_unbound = 0usize;

    for item in discovered {
        if registry.contains_key(&item.fixture.input.fn_name) {
            // Steps 9+ invoke bindings here.
            executed = executed.saturating_add(1);
        } else {
            skipped_unbound = skipped_unbound.saturating_add(1);
        }
    }

    Ok(SuiteSummary {
        parsed: discovered.len(),
        executed,
        skipped_unbound,
    })
}

pub fn format_summary(summary: &SuiteSummary) -> String {
    format!(
        "parsed={} executed={} skipped-unbound={}",
        summary.parsed, summary.executed, summary.skipped_unbound
    )
}
