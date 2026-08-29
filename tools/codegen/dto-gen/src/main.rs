//! CLI: `dto-gen --snapshot <path> --out <dir> [...binding outputs] [--go-bindings-out <dir>] [--go-client-out <file>] [--go-parity-out <file>] [--native-rb-out <file>] [--rb-client-out <file>] [--rb-rbs-out <file>] [--rb-parity-out <file>] [--rb-conformance-out <dir>] [--rs-client-out <file>] [--rs-parity-out <file>]`

use std::env;
use std::path::PathBuf;
use std::process::ExitCode;

use dto_gen::{generate_from_snapshot, GenError, GenOutputs};

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
    let mut ts_client_runtime_out: Option<PathBuf> = None;
    let mut ts_parity_out: Option<PathBuf> = None;
    let mut dump_bindings: Option<PathBuf> = None;
    let mut node_bindings_out: Option<PathBuf> = None;
    let mut wasm_bindings_out: Option<PathBuf> = None;
    let mut python_bindings_out: Option<PathBuf> = None;
    let mut ruby_bindings_out: Option<PathBuf> = None;
    let mut go_bindings_out: Option<PathBuf> = None;
    let mut native_ts_out: Option<PathBuf> = None;
    let mut wasm_ts_out: Option<PathBuf> = None;
    let mut native_py_out: Option<PathBuf> = None;
    let mut py_stub_out: Option<PathBuf> = None;
    let mut py_helpers_out: Option<PathBuf> = None;
    let mut py_parity_out: Option<PathBuf> = None;
    let mut py_conformance_out: Option<PathBuf> = None;
    let mut native_rb_out: Option<PathBuf> = None;
    let mut rb_client_out: Option<PathBuf> = None;
    let mut rb_rbs_out: Option<PathBuf> = None;
    let mut rb_mcp_rbs_out: Option<PathBuf> = None;
    let mut rb_parity_out: Option<PathBuf> = None;
    let mut rb_conformance_out: Option<PathBuf> = None;
    let mut go_conformance_out: Option<PathBuf> = None;
    let mut rs_client_out: Option<PathBuf> = None;
    let mut rs_helpers_out: Option<PathBuf> = None;
    let mut rs_parity_out: Option<PathBuf> = None;
    let mut go_client_out: Option<PathBuf> = None;
    let mut go_helpers_out: Option<PathBuf> = None;
    let mut go_parity_out: Option<PathBuf> = None;
    let mut c_bindings_out: Option<PathBuf> = None;
    let mut c_conformance_out: Option<PathBuf> = None;
    let mut c_parity_out: Option<PathBuf> = None;
    let mut fixture_runner_out: Option<PathBuf> = None;
    let mut rb_mcp_layer2_out: Option<PathBuf> = None;
    let mut py_mcp_layer2_out: Option<PathBuf> = None;
    let mut go_mcp_layer2_out: Option<PathBuf> = None;
    let mut ts_mcp_native_out: Option<PathBuf> = None;
    let mut rs_mcp_layer2_out: Option<PathBuf> = None;
    let mut core_src: Option<PathBuf> = None;
    let mut binding_residue: Option<PathBuf> = None;
    let mut transport_src: Option<PathBuf> = None;
    let mut dump_boundary_types: Option<PathBuf> = None;
    let mut core_types_ts_out: Option<PathBuf> = None;
    let mut core_dispatch_ts_out: Option<PathBuf> = None;
    let mut core_native_ts_out: Option<PathBuf> = None;
    let mut core_helpers_ts_out: Option<PathBuf> = None;
    let mut server_decisions_ts_out: Option<PathBuf> = None;
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
            "--ts-client-runtime-out" => {
                ts_client_runtime_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
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
            "--go-bindings-out" => {
                go_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
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
            "--py-helpers-out" => {
                py_helpers_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--py-parity-out" => {
                py_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--py-conformance-out" => {
                py_conformance_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
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
            "--rb-mcp-rbs-out" => {
                rb_mcp_rbs_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-parity-out" => {
                rb_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-conformance-out" => {
                rb_conformance_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--go-conformance-out" => {
                go_conformance_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-client-out" => {
                rs_client_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-helpers-out" => {
                rs_helpers_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rb-mcp-layer2-out" => {
                rb_mcp_layer2_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--py-mcp-layer2-out" => {
                py_mcp_layer2_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--go-mcp-layer2-out" => {
                go_mcp_layer2_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--ts-mcp-native-out" => {
                ts_mcp_native_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-mcp-layer2-out" => {
                rs_mcp_layer2_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--rs-parity-out" => {
                rs_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--go-client-out" => {
                go_client_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--go-helpers-out" => {
                go_helpers_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--go-parity-out" => {
                go_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--c-bindings-out" => {
                c_bindings_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--c-conformance-out" => {
                c_conformance_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--c-parity-out" => {
                c_parity_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--fixture-runner-out" => {
                fixture_runner_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--core-src" => {
                core_src = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--binding-residue" => {
                binding_residue = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--transport-src" => {
                transport_src = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--dump-boundary-types" => {
                dump_boundary_types = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--core-types-ts-out" => {
                core_types_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--core-dispatch-ts-out" => {
                core_dispatch_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--core-native-ts-out" => {
                core_native_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--core-helpers-ts-out" => {
                core_helpers_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--server-decisions-ts-out" => {
                server_decisions_ts_out = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
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
        core_src.as_deref(),
        binding_residue.as_deref(),
        transport_src.as_deref(),
        &GenOutputs {
            ts_out: ts_out.as_deref(),
            ts_client_out: ts_client_out.as_deref(),
            ts_client_runtime_out: ts_client_runtime_out.as_deref(),
            ts_parity_out: ts_parity_out.as_deref(),
            dump_bindings: dump_bindings.as_deref(),
            dump_boundary_types: dump_boundary_types.as_deref(),
            core_types_ts_out: core_types_ts_out.as_deref(),
            core_dispatch_ts_out: core_dispatch_ts_out.as_deref(),
            core_native_ts_out: core_native_ts_out.as_deref(),
            core_helpers_ts_out: core_helpers_ts_out.as_deref(),
            server_decisions_ts_out: server_decisions_ts_out.as_deref(),
            node_bindings_out: node_bindings_out.as_deref(),
            wasm_bindings_out: wasm_bindings_out.as_deref(),
            python_bindings_out: python_bindings_out.as_deref(),
            ruby_bindings_out: ruby_bindings_out.as_deref(),
            go_bindings_out: go_bindings_out.as_deref(),
            native_ts_out: native_ts_out.as_deref(),
            wasm_ts_out: wasm_ts_out.as_deref(),
            native_py_out: native_py_out.as_deref(),
            py_stub_out: py_stub_out.as_deref(),
            py_helpers_out: py_helpers_out.as_deref(),
            py_parity_out: py_parity_out.as_deref(),
            py_conformance_out: py_conformance_out.as_deref(),
            native_rb_out: native_rb_out.as_deref(),
            rb_client_out: rb_client_out.as_deref(),
            rb_rbs_out: rb_rbs_out.as_deref(),
            rb_mcp_rbs_out: rb_mcp_rbs_out.as_deref(),
            rb_parity_out: rb_parity_out.as_deref(),
            rb_conformance_out: rb_conformance_out.as_deref(),
            go_conformance_out: go_conformance_out.as_deref(),
            rs_client_out: rs_client_out.as_deref(),
            rs_helpers_out: rs_helpers_out.as_deref(),
            rs_parity_out: rs_parity_out.as_deref(),
            go_client_out: go_client_out.as_deref(),
            go_helpers_out: go_helpers_out.as_deref(),
            go_parity_out: go_parity_out.as_deref(),
            c_bindings_out: c_bindings_out.as_deref(),
            c_conformance_out: c_conformance_out.as_deref(),
            c_parity_out: c_parity_out.as_deref(),
            fixture_runner_out: fixture_runner_out.as_deref(),
            rb_mcp_layer2_out: rb_mcp_layer2_out.as_deref(),
            py_mcp_layer2_out: py_mcp_layer2_out.as_deref(),
            go_mcp_layer2_out: go_mcp_layer2_out.as_deref(),
            ts_mcp_native_out: ts_mcp_native_out.as_deref(),
            rs_mcp_layer2_out: rs_mcp_layer2_out.as_deref(),
        },
    )
}
