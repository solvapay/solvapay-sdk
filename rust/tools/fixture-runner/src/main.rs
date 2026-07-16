//! CLI: `fixture-runner <fixtures-root>`

use std::env;
use std::process::ExitCode;

use fixture_runner::{format_summary, run_suite, BindingRegistry, RunnerError};

fn main() -> ExitCode {
    match run() {
        Ok(code) => code,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

fn run() -> Result<ExitCode, RunnerError> {
    let mut args = env::args().skip(1);
    let root = match args.next() {
        Some(path) => path,
        None => return Err(RunnerError::Usage),
    };

    if args.next().is_some() {
        return Err(RunnerError::Usage);
    }

    let registry = BindingRegistry::new();
    let summary = run_suite(std::path::Path::new(&root), &registry)?;
    println!("{}", format_summary(&summary));
    Ok(ExitCode::SUCCESS)
}
