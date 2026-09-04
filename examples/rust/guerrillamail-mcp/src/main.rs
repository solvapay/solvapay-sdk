//! CLI for the Guerrilla Mail disposable-inbox MCP (`--mode demo|http`).

use std::path::Path;

use solvapay_example_guerrillamail_mcp::error::ExampleError;
use solvapay_example_guerrillamail_mcp::http::serve_http;
use solvapay_example_guerrillamail_mcp::run_demo;
use solvapay_example_guerrillamail_mcp::sources::{default_fixture_dir, FixtureSource, LiveSource};

#[tokio::main]
async fn main() {
    if let Err(err) = load_dotenv_files() {
        eprintln!("{err}");
        std::process::exit(1);
    }
    let args: Vec<String> = std::env::args().collect();
    let mode = flag_value(&args, "--mode").unwrap_or_else(|| "demo".to_owned());
    let gate = args.iter().any(|a| a == "--gate");
    let source_kind = flag_value(&args, "--source")
        .or_else(|| std::env::var("MCP_SOURCE").ok())
        .unwrap_or_else(|| "fixture".to_owned());
    if let Err(err) = run(&mode, gate, &source_kind).await {
        eprintln!("{err}");
        std::process::exit(1);
    }
}

/// Dispatch `--mode demo|http`.
async fn run(mode: &str, gate: bool, source_kind: &str) -> Result<(), ExampleError> {
    match mode {
        "demo" => {
            let source = resolve_source(source_kind)?;
            let body = run_demo(!gate, source)
                .await
                .map_err(|e| ExampleError::new(e.to_string()))?;
            let text = serde_json::to_string_pretty(&body)
                .map_err(|e| ExampleError::new(format!("serialize demo result: {e}")))?;
            println!("{text}");
            Ok(())
        }
        "http" => {
            let source = resolve_source(source_kind)?;
            serve_http(source).await
        }
        other => Err(ExampleError::new(format!(
            "unknown --mode {other:?} (want demo or http)"
        ))),
    }
}

/// Build the upstream from `--source` / `MCP_SOURCE`.
fn resolve_source(
    kind: &str,
) -> Result<solvapay_example_guerrillamail_mcp::sources::SharedSource, ExampleError> {
    match kind.trim().to_ascii_lowercase().as_str() {
        "" | "fixture" => Ok(std::sync::Arc::new(FixtureSource::from_dir(
            default_fixture_dir(),
        ))),
        "live" => Ok(std::sync::Arc::new(LiveSource::new()?)),
        other => Err(ExampleError::new(format!(
            "unknown --source {other:?} (want fixture or live)"
        ))),
    }
}

/// Value of `--flag value`.
fn flag_value(args: &[String], name: &str) -> Option<String> {
    args.windows(2).find(|w| w[0] == name).map(|w| w[1].clone())
}

/// Load `.env` then `.env.local` from cwd and the crate directory.
fn load_dotenv_files() -> Result<(), ExampleError> {
    let crate_dir = Path::new(env!("CARGO_MANIFEST_DIR"));
    load_dotenv(Path::new(".env"))?;
    load_dotenv(&crate_dir.join(".env"))?;
    load_dotenv(Path::new(".env.local"))?;
    load_dotenv(&crate_dir.join(".env.local"))?;
    Ok(())
}

/// Load `KEY=VALUE` lines without overwriting existing env vars.
fn load_dotenv(path: &Path) -> Result<(), ExampleError> {
    if !path.exists() {
        return Ok(());
    }
    let text = std::fs::read_to_string(path)
        .map_err(|e| ExampleError::new(format!("read {}: {e}", path.display())))?;
    for (idx, line) in text.lines().enumerate() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }
        let Some((key, value)) = trimmed.split_once('=') else {
            return Err(ExampleError::new(format!(
                "{}:{}: expected KEY=VALUE",
                path.display(),
                idx + 1
            )));
        };
        let key = key.trim();
        let value = value.trim().trim_matches('"').trim_matches('\'');
        if std::env::var_os(key).is_none() {
            std::env::set_var(key, value);
        }
    }
    Ok(())
}
