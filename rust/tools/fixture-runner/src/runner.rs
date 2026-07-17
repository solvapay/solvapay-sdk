//! Fixture execution: discover → bind → invoke → deep-compare.

use std::collections::HashMap;
use std::path::{Path, PathBuf};

use serde_json::{Map, Value};

use crate::discover::{discover_fixtures, DiscoveredFixture};
use crate::error::RunnerResult;
use crate::model::{FixtureErrorExpect, FixtureExpect, FixtureInput};

/// Structured SDK error observed by a binding (maps to `expect.error` fields).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErrorObservation {
    /// Error constructor/name (e.g. `"SolvaPayError"`).
    pub name: Option<String>,
    /// Human-readable message.
    pub message: String,
    /// Optional error kind discriminator (e.g. `"Webhook"`).
    pub kind: Option<String>,
    /// Optional machine-readable error code.
    pub code: Option<String>,
    /// Optional HTTP status when modeling an API failure.
    pub status: Option<i64>,
}

/// Error returned from a binding invoke: structured SDK failure or harness/setup failure.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BindingError {
    /// Domain/SDK error compared against `expect.error`.
    Sdk(ErrorObservation),
    /// Fixture-runner / arg-parsing failure (not an SDK error observation).
    Harness(String),
}

impl From<String> for BindingError {
    /// Wraps a harness/setup error string as [`BindingError::Harness`].
    ///
    /// # Arguments
    ///
    /// * `value` - Human-readable harness failure message.
    ///
    /// # Returns
    ///
    /// [`BindingError::Harness`] containing `value`.
    fn from(value: String) -> Self {
        Self::Harness(value)
    }
}

impl From<&str> for BindingError {
    /// Wraps a harness/setup error string slice as [`BindingError::Harness`].
    ///
    /// # Arguments
    ///
    /// * `value` - Human-readable harness failure message.
    ///
    /// # Returns
    ///
    /// [`BindingError::Harness`] owning a clone of `value`.
    fn from(value: &str) -> Self {
        Self::Harness(value.to_owned())
    }
}

/// Invokes a bound SDK function for one fixture input.
pub type BindingFn = Box<dyn Fn(&FixtureInput) -> Result<Value, BindingError> + Send + Sync>;

/// One registered implementation for an `input.fn` name.
pub struct Binding {
    /// Binding label printed in failure output (e.g. `"core"`).
    pub id: &'static str,
    /// Callable that maps fixture input to a JSON result or [`BindingError`].
    pub invoke: BindingFn,
}

/// `input.fn` → one or more bindings (parity with the TS `FixtureRegistry`).
#[derive(Default)]
pub struct BindingRegistry {
    /// Registered bindings keyed by `input.fn` name.
    map: HashMap<String, Vec<Binding>>,
}

impl BindingRegistry {
    /// Creates an empty registry with no registered functions.
    ///
    /// # Returns
    ///
    /// A default [`BindingRegistry`] with an empty internal map.
    pub fn new() -> Self {
        Self {
            map: HashMap::new(),
        }
    }

    /// Registers a binding under a fixture function name.
    ///
    /// Multiple bindings per name are allowed (parity with the TS `FixtureRegistry`).
    ///
    /// # Arguments
    ///
    /// * `fn_name` - Value of `input.fn` that selects this binding.
    /// * `binding` - Implementation label and invoke closure to register.
    ///
    /// # Returns
    ///
    /// Nothing; appends `binding` to the list for `fn_name`.
    pub fn register(&mut self, fn_name: impl Into<String>, binding: Binding) {
        self.map.entry(fn_name.into()).or_default().push(binding);
    }

    /// Returns all bindings registered for a fixture function name.
    ///
    /// # Arguments
    ///
    /// * `fn_name` - Value of `input.fn` to look up.
    ///
    /// # Returns
    ///
    /// A slice of registered bindings, or `None` when no binding exists for `fn_name`.
    pub fn get(&self, fn_name: &str) -> Option<&[Binding]> {
        self.map.get(fn_name).map(|v| v.as_slice())
    }

    /// Returns whether any binding exists for a fixture function name.
    ///
    /// # Arguments
    ///
    /// * `fn_name` - Value of `input.fn` to look up.
    ///
    /// # Returns
    ///
    /// `true` when at least one binding is registered for `fn_name`; `false` otherwise.
    pub fn contains(&self, fn_name: &str) -> bool {
        self.map.contains_key(fn_name)
    }
}

/// Aggregate counts after running a fixture suite.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SuiteSummary {
    /// Total JSON fixtures discovered on disk.
    pub parsed: usize,
    /// Binding invocations performed (fixtures × bindings per `fn`).
    pub executed: usize,
    /// Invocations whose result matched `expect.result`.
    pub passed: usize,
    /// Invocations that failed comparison or binding errors.
    pub failed: usize,
    /// Fixtures whose `input.fn` had no registered binding.
    pub skipped_unbound: usize,
}

/// One failed binding invocation with path and diagnostic message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FixtureFailure {
    /// Path to the golden fixture file.
    pub path: PathBuf,
    /// Binding id that produced the mismatch.
    pub binding_id: String,
    /// Human-readable failure reason (mismatch diff or binding error).
    pub message: String,
}

/// Discovers fixtures under a root directory, invokes bound functions, and deep-compares results.
///
/// Pipeline: discover → bind → invoke → compare `expect.result`.
///
/// # Arguments
///
/// * `root` - Filesystem path to the fixtures corpus root directory.
/// * `registry` - Bindings keyed by `input.fn` names.
///
/// # Returns
///
/// A [`SuiteSummary`] and list of [`FixtureFailure`] records, or [`crate::RunnerError`] when discovery or parsing fails.
pub fn run_suite(
    root: &Path,
    registry: &BindingRegistry,
) -> RunnerResult<(SuiteSummary, Vec<FixtureFailure>)> {
    let discovered = discover_fixtures(root)?;
    execute(&discovered, registry)
}

/// Invokes every bound function for each discovered fixture and tallies outcomes.
///
/// Fixtures whose `input.fn` has no registered binding increment `skipped_unbound` and are not executed.
///
/// # Arguments
///
/// * `discovered` - Parsed fixtures loaded from disk.
/// * `registry` - Bindings keyed by `input.fn` names.
///
/// # Returns
///
/// A [`SuiteSummary`] and collected [`FixtureFailure`] entries for mismatches and binding errors.
fn execute(
    discovered: &[DiscoveredFixture],
    registry: &BindingRegistry,
) -> RunnerResult<(SuiteSummary, Vec<FixtureFailure>)> {
    let mut executed = 0usize;
    let mut passed = 0usize;
    let mut failed = 0usize;
    let mut skipped_unbound = 0usize;
    let mut failures = Vec::new();

    for item in discovered {
        let Some(bindings) = registry.get(&item.fixture.input.fn_name) else {
            skipped_unbound = skipped_unbound.saturating_add(1);
            continue;
        };

        for binding in bindings {
            executed = executed.saturating_add(1);
            match run_one(&item.fixture.expect, &item.fixture.input, binding) {
                Ok(()) => {
                    passed = passed.saturating_add(1);
                }
                Err(message) => {
                    failed = failed.saturating_add(1);
                    failures.push(FixtureFailure {
                        path: item.path.clone(),
                        binding_id: binding.id.to_owned(),
                        message,
                    });
                }
            }
        }
    }

    Ok((
        SuiteSummary {
            parsed: discovered.len(),
            executed,
            passed,
            failed,
            skipped_unbound,
        },
        failures,
    ))
}

/// Invokes one binding and deep-compares the result against the fixture expectation.
///
/// Success expectations deep-compare JSON. Error expectations compare structured
/// [`ErrorObservation`] fields against [`FixtureErrorExpect`] (message always;
/// `name` / `status` / `kind` / `code` when present in the fixture).
///
/// # Arguments
///
/// * `expect` - Success or error expectation from the fixture.
/// * `input` - Callable input block passed to the binding.
/// * `binding` - Registered implementation to invoke.
///
/// # Returns
///
/// `Ok(())` when the binding outcome matches `expect`; `Err(message)` on harness
/// failure, unexpected success/error, or field mismatch.
pub(crate) fn run_one(
    expect: &FixtureExpect,
    input: &FixtureInput,
    binding: &Binding,
) -> Result<(), String> {
    let outcome = (binding.invoke)(input);

    match (expect, outcome) {
        (FixtureExpect::Result(expected), Ok(actual)) => {
            if &actual == expected {
                Ok(())
            } else {
                Err(format!(
                    "result mismatch for binding {}\n  expected: {}\n  actual:   {}",
                    binding.id,
                    compact_json(expected),
                    compact_json(&actual)
                ))
            }
        }
        (FixtureExpect::Result(_), Err(BindingError::Sdk(actual))) => Err(format!(
            "binding {} returned error but fixture expects a result\n  actual error: {}",
            binding.id,
            format_error_observation(&actual)
        )),
        (FixtureExpect::Result(_), Err(BindingError::Harness(message))) => {
            Err(format!("binding {} harness error: {message}", binding.id))
        }
        (FixtureExpect::Error(_), Ok(actual)) => Err(format!(
            "binding {} produced a result but fixture expects an error\n  actual: {}",
            binding.id,
            compact_json(&actual)
        )),
        (FixtureExpect::Error(expected), Err(BindingError::Sdk(actual))) => {
            compare_expected_error(binding.id, expected, &actual)
        }
        (FixtureExpect::Error(_), Err(BindingError::Harness(message))) => Err(format!(
            "binding {} harness error (fixture expects SDK error): {message}",
            binding.id
        )),
    }
}

/// Compares a structured SDK error observation against `expect.error`.
///
/// Mirrors the TS harness `assertExpectedError` (message always; `name`/`status`
/// when present) and additionally asserts `kind`/`code` when present in the fixture.
///
/// # Arguments
///
/// * `binding_id` - Binding label included in mismatch messages.
/// * `expected` - Error expectation from the fixture.
/// * `actual` - Structured error returned by the binding.
///
/// # Returns
///
/// `Ok(())` when all present expected fields match; `Err(message)` listing mismatches.
fn compare_expected_error(
    binding_id: &str,
    expected: &FixtureErrorExpect,
    actual: &ErrorObservation,
) -> Result<(), String> {
    let mut mismatches = Vec::new();

    if actual.message != expected.message {
        mismatches.push(format!(
            "message: expected {:?}, actual {:?}",
            expected.message, actual.message
        ));
    }

    if let Some(ref expected_name) = expected.name {
        match &actual.name {
            Some(actual_name) if actual_name == expected_name => {}
            Some(actual_name) => mismatches.push(format!(
                "name: expected {:?}, actual {:?}",
                expected_name, actual_name
            )),
            None => mismatches.push(format!(
                "name: expected {:?}, actual <absent>",
                expected_name
            )),
        }
    }

    if let Some(expected_status) = expected.status {
        match actual.status {
            Some(actual_status) if actual_status == expected_status => {}
            Some(actual_status) => mismatches.push(format!(
                "status: expected {expected_status}, actual {actual_status}"
            )),
            None => mismatches.push(format!(
                "status: expected {expected_status}, actual <absent>"
            )),
        }
    }

    if let Some(ref expected_kind) = expected.kind {
        match &actual.kind {
            Some(actual_kind) if actual_kind == expected_kind => {}
            Some(actual_kind) => mismatches.push(format!(
                "kind: expected {:?}, actual {:?}",
                expected_kind, actual_kind
            )),
            None => mismatches.push(format!(
                "kind: expected {:?}, actual <absent>",
                expected_kind
            )),
        }
    }

    if let Some(ref expected_code) = expected.code {
        match &actual.code {
            Some(actual_code) if actual_code == expected_code => {}
            Some(actual_code) => mismatches.push(format!(
                "code: expected {:?}, actual {:?}",
                expected_code, actual_code
            )),
            None => mismatches.push(format!(
                "code: expected {:?}, actual <absent>",
                expected_code
            )),
        }
    }

    if mismatches.is_empty() {
        Ok(())
    } else {
        Err(format!(
            "error mismatch for binding {binding_id}\n  {}",
            mismatches.join("\n  ")
        ))
    }
}

/// Formats an [`ErrorObservation`] for failure diagnostics.
///
/// # Arguments
///
/// * `error` - Structured SDK error to stringify.
///
/// # Returns
///
/// A compact single-line description of name/message/kind/code/status.
fn format_error_observation(error: &ErrorObservation) -> String {
    format!(
        "name={:?} message={:?} kind={:?} code={:?} status={:?}",
        error.name, error.message, error.kind, error.code, error.status
    )
}

/// Serializes JSON for compact mismatch output in failure messages.
///
/// # Arguments
///
/// * `value` - JSON value to stringify.
///
/// # Returns
///
/// Compact single-line JSON string, or `"<unserializable>"` when serialization fails.
fn compact_json(value: &Value) -> String {
    match serde_json::to_string(value) {
        Ok(s) => s,
        Err(_) => "<unserializable>".to_owned(),
    }
}

/// Formats a [`SuiteSummary`] as a single-line status string for stdout.
///
/// # Arguments
///
/// * `summary` - Aggregate counts after running a fixture suite.
///
/// # Returns
///
/// A space-separated status line (`parsed=… executed=… passed=… failed=… skipped-unbound=…`).
pub fn format_summary(summary: &SuiteSummary) -> String {
    format!(
        "parsed={} executed={} passed={} failed={} skipped-unbound={}",
        summary.parsed, summary.executed, summary.passed, summary.failed, summary.skipped_unbound
    )
}

/// Converts fixture `input.args` to a JSON object value.
///
/// # Arguments
///
/// * `input` - Fixture input block containing the named `args` map.
///
/// # Returns
///
/// A [`serde_json::Value::Object`] clone of all argument key-value pairs.
pub fn args_object(input: &FixtureInput) -> Value {
    let map: Map<String, Value> = input
        .args
        .iter()
        .map(|(k, v)| (k.clone(), v.clone()))
        .collect();
    Value::Object(map)
}

/// Reads a required string argument from `input.args`.
///
/// # Arguments
///
/// * `input` - Fixture input block containing the `args` map.
/// * `key` - Argument name to read.
///
/// # Returns
///
/// The cloned string value, or a harness [`BindingError`] when the key is missing or not a JSON string.
pub fn require_string_arg(input: &FixtureInput, key: &str) -> Result<String, BindingError> {
    match input.args.get(key) {
        Some(Value::String(s)) => Ok(s.clone()),
        Some(_) => Err(BindingError::Harness(format!(
            "args.{key} must be a string"
        ))),
        None => Err(BindingError::Harness(format!("args.{key} is required"))),
    }
}
