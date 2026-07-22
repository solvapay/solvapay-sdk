//! CLI: `dto-gen --snapshot <path> --out <dir> [--manifest <path>] [--ts-out <path>] [--ts-client-out <path>] [--ts-parity-out <path>] [--dump-bindings <path>] [--node-bindings-out <dir>] [--wasm-bindings-out <dir>]`

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use dto_gen::{generate_from_snapshot, GenError};

/// CLI entry point.
///
/// # Returns
///
/// [`ExitCode::SUCCESS`] on successful generation; [`ExitCode::FAILURE`] on error.
fn main() -> ExitCode {
    match run() {
        Ok(()) => ExitCode::SUCCESS,
        Err(err) => {
            eprintln!("{err}");
            ExitCode::FAILURE
        }
    }
}

/// Parses CLI flags and runs generation.
///
/// # Errors
///
/// Returns [`GenError::Usage`] when flags are missing/invalid, or generation errors.
fn run() -> Result<(), GenError> {
    let mut snapshot: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut manifest: Option<PathBuf> = None;
    let mut ts_out: Option<PathBuf> = None;
    let mut ts_client_out: Option<PathBuf> = None;
    let mut ts_parity_out: Option<PathBuf> = None;
    let mut dump_bindings: Option<PathBuf> = None;
    let mut node_bindings_out: Option<PathBuf> = None;
    let mut wasm_bindings_out: Option<PathBuf> = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--snapshot" => {
                snapshot = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--out" => {
                out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--manifest" => {
                manifest = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--ts-out" => {
                ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--ts-client-out" => {
                ts_client_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--ts-parity-out" => {
                ts_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--dump-bindings" => {
                dump_bindings = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--node-bindings-out" => {
                node_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--wasm-bindings-out" => {
                wasm_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "-h" | "--help" => return Err(GenError::Usage),
            _ => return Err(GenError::Usage),
        }
    }
    let snapshot = snapshot.ok_or(GenError::Usage)?;
    let out = out.ok_or(GenError::Usage)?;
    generate_from_snapshot(
        &snapshot,
        &out,
        manifest.as_deref(),
        ts_out.as_deref(),
        ts_client_out.as_deref(),
        ts_parity_out.as_deref(),
        dump_bindings.as_deref(),
        node_bindings_out.as_deref(),
        wasm_bindings_out.as_deref(),
    )
}
