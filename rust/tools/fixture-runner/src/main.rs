//! CLI: `fixture-runner <fixtures-root>`

use std::env;
use std::process::ExitCode;

use fixture_runner::{create_default_registry, format_summary, run_suite, RunnerError};

/// CLI entry point: runs the fixture suite and maps failures to a process exit code.
///
/// # Returns
///
/// [`ExitCode::SUCCESS`] when the suite completes with zero failures; [`ExitCode::FAILURE`] when `run` returns an error or any invocation failed.
fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

/// Parses CLI args, runs fixtures with the default registry, and prints summary output.
///
/// Expects exactly one positional argument: the fixtures root directory path.
///
/// # Returns
///
/// [`ExitCode::SUCCESS`] when no invocations failed; [`ExitCode::FAILURE`] when `summary.failed > 0`; or [`RunnerError::Usage`] / other [`RunnerError`] variants on CLI or I/O failures.
fn run() -> Result<ExitCode, RunnerError> {
    let mut args = env::args().skip(1);
    let root = match args.next() {
        Some(path) => path,
        None => return Err(RunnerError::Usage),
    };

    if args.next().is_some() {
        return Err(RunnerError::Usage);
    }

    let registry = create_default_registry();
    let (summary, failures) = run_suite(std::path::Path::new(&root), &registry)?;

    for failure in &failures {
        eprintln!(
            "FAIL {} ({}) {}",
            failure.path.display(),
            failure.binding_id,
            failure.message
        );
    }

    println!("{}", format_summary(&summary));

    if summary.failed > 0 {
        Ok(ExitCode::FAILURE)
    } else {
        Ok(ExitCode::SUCCESS)
    }
}
