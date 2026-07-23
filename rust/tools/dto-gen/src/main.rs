//! CLI: `dto-gen --snapshot <path> --out <dir> [...binding outputs] [--native-rb-out <file>] [--rb-client-out <file>] [--rb-rbs-out <file>] [--rb-parity-out <file>] [--rs-client-out <file>] [--rs-parity-out <file>]`

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
    let mut python_bindings_out: Option<PathBuf> = None;
    let mut ruby_bindings_out: Option<PathBuf> = None;
    let mut native_ts_out: Option<PathBuf> = None;
    let mut wasm_ts_out: Option<PathBuf> = None;
    let mut native_py_out: Option<PathBuf> = None;
    let mut py_stub_out: Option<PathBuf> = None;
    let mut py_parity_out: Option<PathBuf> = None;
    let mut native_rb_out: Option<PathBuf> = None;
    let mut rb_client_out: Option<PathBuf> = None;
    let mut rb_rbs_out: Option<PathBuf> = None;
    let mut rb_parity_out: Option<PathBuf> = None;
    let mut rs_client_out: Option<PathBuf> = None;
    let mut rs_parity_out: Option<PathBuf> = None;
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
            "--python-bindings-out" => {
                python_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--ruby-bindings-out" => {
                ruby_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--native-ts-out" => {
                native_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--wasm-ts-out" => {
                wasm_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--native-py-out" => {
                native_py_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--py-stub-out" => {
                py_stub_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--py-parity-out" => {
                py_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--native-rb-out" => {
                native_rb_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-client-out" => {
                rb_client_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-rbs-out" => {
                rb_rbs_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-parity-out" => {
                rb_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-client-out" => {
                rs_client_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-parity-out" => {
                rs_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
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
        python_bindings_out.as_deref(),
        ruby_bindings_out.as_deref(),
        native_ts_out.as_deref(),
        wasm_ts_out.as_deref(),
        native_py_out.as_deref(),
        py_stub_out.as_deref(),
        py_parity_out.as_deref(),
        native_rb_out.as_deref(),
        rb_client_out.as_deref(),
        rb_rbs_out.as_deref(),
        rb_parity_out.as_deref(),
        rs_client_out.as_deref(),
        rs_parity_out.as_deref(),
    )
}
