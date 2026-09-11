//! CLI: `dto-gen --config contract/manifest/repo-paths.yaml [--repo-root <dir>]`

use std::env;
use std::fs;
use std::path::{Path, PathBuf};
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
    let mut config: Option<PathBuf> = None;
    let mut repo_root_arg: Option<PathBuf> = None;
    let mut args = env::args().skip(1);
    while let Some(arg) = args.next() {
        match arg.as_str() {
            "--config" => {
                config = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "--repo-root" => {
                repo_root_arg = Some(PathBuf::from(args.next().ok_or(GenError::Usage)?));
            }
            "-h" | "--help" => return Err(GenError::Usage),
            _ => return Err(GenError::Usage),
        }
    }
    let config = config.ok_or(GenError::Usage)?;
    let repo_root = match repo_root_arg {
        Some(path) => path,
        None => repo_paths::try_repo_root().map_err(|err| GenError::Parse(err.to_string()))?,
    };
    let config_abs = if config.is_absolute() {
        config
    } else {
        repo_root.join(config)
    };
    let raw = fs::read_to_string(&config_abs).map_err(|source| GenError::Io {
        path: config_abs.clone(),
        source,
    })?;
    let manifest: repo_paths::Manifest =
        serde_norway::from_str(&raw).map_err(|err| GenError::Parse(err.to_string()))?;
    if manifest.version != 1 {
        return Err(GenError::Parse(format!(
            "unsupported repo-paths version {}",
            manifest.version
        )));
    }

    let mut snapshot: Option<PathBuf> = None;
    let mut out: Option<PathBuf> = None;
    let mut contract_manifest: Option<PathBuf> = None;
    let mut core_src: Option<PathBuf> = None;
    let mut binding_residue: Option<PathBuf> = None;
    let mut transport_src: Option<PathBuf> = None;
    let mut outputs = OwnedOutputs::default();

    for item in manifest.contract_inputs.values() {
        let Some(flag) = item.flag.as_deref() else {
            continue;
        };
        let path = abs(&repo_root, &item.path);
        apply_input_flag(
            flag,
            path,
            &mut snapshot,
            &mut out,
            &mut contract_manifest,
            &mut core_src,
            &mut binding_residue,
            &mut transport_src,
            &mut outputs,
        )?;
    }
    for item in &manifest.generated {
        let Some(flag) = item.flag.as_deref() else {
            continue;
        };
        let path = abs(&repo_root, &item.path);
        apply_input_flag(
            flag,
            path,
            &mut snapshot,
            &mut out,
            &mut contract_manifest,
            &mut core_src,
            &mut binding_residue,
            &mut transport_src,
            &mut outputs,
        )?;
    }

    let snapshot = snapshot.ok_or(GenError::Usage)?;
    let out = out.ok_or(GenError::Usage)?;
    generate_from_snapshot(
        &snapshot,
        &out,
        contract_manifest.as_deref(),
        core_src.as_deref(),
        binding_residue.as_deref(),
        transport_src.as_deref(),
        &outputs.borrowed(),
    )
}

fn abs(root: &Path, rel: &str) -> PathBuf {
    let mut out = root.to_path_buf();
    for part in rel.split('/') {
        if !part.is_empty() {
            out.push(part);
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn apply_input_flag(
    flag: &str,
    path: PathBuf,
    snapshot: &mut Option<PathBuf>,
    out: &mut Option<PathBuf>,
    contract_manifest: &mut Option<PathBuf>,
    core_src: &mut Option<PathBuf>,
    binding_residue: &mut Option<PathBuf>,
    transport_src: &mut Option<PathBuf>,
    outputs: &mut OwnedOutputs,
) -> Result<(), GenError> {
    match flag {
        "--snapshot" => *snapshot = Some(path),
        "--out" => *out = Some(path),
        "--manifest" => *contract_manifest = Some(path),
        "--core-src" => *core_src = Some(path),
        "--binding-residue" => *binding_residue = Some(path),
        "--transport-src" => *transport_src = Some(path),
        "--ts-out" => outputs.ts_out = Some(path),
        "--ts-client-out" => outputs.ts_client_out = Some(path),
        "--ts-client-runtime-out" => outputs.ts_client_runtime_out = Some(path),
        "--ts-parity-out" => outputs.ts_parity_out = Some(path),
        "--dump-bindings" => outputs.dump_bindings = Some(path),
        "--dump-boundary-types" => outputs.dump_boundary_types = Some(path),
        "--core-types-ts-out" => outputs.core_types_ts_out = Some(path),
        "--core-dispatch-ts-out" => outputs.core_dispatch_ts_out = Some(path),
        "--core-native-ts-out" => outputs.core_native_ts_out = Some(path),
        "--core-helpers-ts-out" => outputs.core_helpers_ts_out = Some(path),
        "--server-decisions-ts-out" => outputs.server_decisions_ts_out = Some(path),
        "--node-bindings-out" => outputs.node_bindings_out = Some(path),
        "--wasm-bindings-out" => outputs.wasm_bindings_out = Some(path),
        "--python-bindings-out" => outputs.python_bindings_out = Some(path),
        "--ruby-bindings-out" => outputs.ruby_bindings_out = Some(path),
        "--go-bindings-out" => outputs.go_bindings_out = Some(path),
        "--native-ts-out" => outputs.native_ts_out = Some(path),
        "--wasm-ts-out" => outputs.wasm_ts_out = Some(path),
        "--native-py-out" => outputs.native_py_out = Some(path),
        "--py-stub-out" => outputs.py_stub_out = Some(path),
        "--py-helpers-out" => outputs.py_helpers_out = Some(path),
        "--py-parity-out" => outputs.py_parity_out = Some(path),
        "--py-conformance-out" => outputs.py_conformance_out = Some(path),
        "--native-rb-out" => outputs.native_rb_out = Some(path),
        "--rb-client-out" => outputs.rb_client_out = Some(path),
        "--rb-rbs-out" => outputs.rb_rbs_out = Some(path),
        "--rb-mcp-rbs-out" => outputs.rb_mcp_rbs_out = Some(path),
        "--rb-parity-out" => outputs.rb_parity_out = Some(path),
        "--rb-conformance-out" => outputs.rb_conformance_out = Some(path),
        "--go-conformance-out" => outputs.go_conformance_out = Some(path),
        "--rs-client-out" => outputs.rs_client_out = Some(path),
        "--rs-helpers-out" => outputs.rs_helpers_out = Some(path),
        "--rs-parity-out" => outputs.rs_parity_out = Some(path),
        "--go-client-out" => outputs.go_client_out = Some(path),
        "--go-helpers-out" => outputs.go_helpers_out = Some(path),
        "--go-parity-out" => outputs.go_parity_out = Some(path),
        "--c-bindings-out" => outputs.c_bindings_out = Some(path),
        "--c-conformance-out" => outputs.c_conformance_out = Some(path),
        "--c-parity-out" => outputs.c_parity_out = Some(path),
        "--fixture-runner-out" => outputs.fixture_runner_out = Some(path),
        "--rb-mcp-layer2-out" => outputs.rb_mcp_layer2_out = Some(path),
        "--py-mcp-layer2-out" => outputs.py_mcp_layer2_out = Some(path),
        "--go-mcp-layer2-out" => outputs.go_mcp_layer2_out = Some(path),
        "--ts-mcp-native-out" => outputs.ts_mcp_native_out = Some(path),
        "--rs-mcp-layer2-out" => outputs.rs_mcp_layer2_out = Some(path),
        other => {
            return Err(GenError::Parse(format!(
                "unknown dto-gen flag in repo-paths manifest: {other}"
            )))
        }
    }
    Ok(())
}

#[derive(Default)]
struct OwnedOutputs {
    ts_out: Option<PathBuf>,
    ts_client_out: Option<PathBuf>,
    ts_client_runtime_out: Option<PathBuf>,
    ts_parity_out: Option<PathBuf>,
    dump_bindings: Option<PathBuf>,
    dump_boundary_types: Option<PathBuf>,
    core_types_ts_out: Option<PathBuf>,
    core_dispatch_ts_out: Option<PathBuf>,
    core_native_ts_out: Option<PathBuf>,
    core_helpers_ts_out: Option<PathBuf>,
    server_decisions_ts_out: Option<PathBuf>,
    node_bindings_out: Option<PathBuf>,
    wasm_bindings_out: Option<PathBuf>,
    python_bindings_out: Option<PathBuf>,
    ruby_bindings_out: Option<PathBuf>,
    go_bindings_out: Option<PathBuf>,
    native_ts_out: Option<PathBuf>,
    wasm_ts_out: Option<PathBuf>,
    native_py_out: Option<PathBuf>,
    py_stub_out: Option<PathBuf>,
    py_helpers_out: Option<PathBuf>,
    py_parity_out: Option<PathBuf>,
    py_conformance_out: Option<PathBuf>,
    native_rb_out: Option<PathBuf>,
    rb_client_out: Option<PathBuf>,
    rb_rbs_out: Option<PathBuf>,
    rb_mcp_rbs_out: Option<PathBuf>,
    rb_parity_out: Option<PathBuf>,
    rb_conformance_out: Option<PathBuf>,
    go_conformance_out: Option<PathBuf>,
    rs_client_out: Option<PathBuf>,
    rs_helpers_out: Option<PathBuf>,
    rs_parity_out: Option<PathBuf>,
    go_client_out: Option<PathBuf>,
    go_helpers_out: Option<PathBuf>,
    go_parity_out: Option<PathBuf>,
    c_bindings_out: Option<PathBuf>,
    c_conformance_out: Option<PathBuf>,
    c_parity_out: Option<PathBuf>,
    fixture_runner_out: Option<PathBuf>,
    rb_mcp_layer2_out: Option<PathBuf>,
    py_mcp_layer2_out: Option<PathBuf>,
    go_mcp_layer2_out: Option<PathBuf>,
    ts_mcp_native_out: Option<PathBuf>,
    rs_mcp_layer2_out: Option<PathBuf>,
}

impl OwnedOutputs {
    fn borrowed(&self) -> GenOutputs<'_> {
        GenOutputs {
            ts_out: self.ts_out.as_deref(),
            ts_client_out: self.ts_client_out.as_deref(),
            ts_client_runtime_out: self.ts_client_runtime_out.as_deref(),
            ts_parity_out: self.ts_parity_out.as_deref(),
            dump_bindings: self.dump_bindings.as_deref(),
            dump_boundary_types: self.dump_boundary_types.as_deref(),
            core_types_ts_out: self.core_types_ts_out.as_deref(),
            core_dispatch_ts_out: self.core_dispatch_ts_out.as_deref(),
            core_native_ts_out: self.core_native_ts_out.as_deref(),
            core_helpers_ts_out: self.core_helpers_ts_out.as_deref(),
            server_decisions_ts_out: self.server_decisions_ts_out.as_deref(),
            node_bindings_out: self.node_bindings_out.as_deref(),
            wasm_bindings_out: self.wasm_bindings_out.as_deref(),
            python_bindings_out: self.python_bindings_out.as_deref(),
            ruby_bindings_out: self.ruby_bindings_out.as_deref(),
            go_bindings_out: self.go_bindings_out.as_deref(),
            native_ts_out: self.native_ts_out.as_deref(),
            wasm_ts_out: self.wasm_ts_out.as_deref(),
            native_py_out: self.native_py_out.as_deref(),
            py_stub_out: self.py_stub_out.as_deref(),
            py_helpers_out: self.py_helpers_out.as_deref(),
            py_parity_out: self.py_parity_out.as_deref(),
            py_conformance_out: self.py_conformance_out.as_deref(),
            native_rb_out: self.native_rb_out.as_deref(),
            rb_client_out: self.rb_client_out.as_deref(),
            rb_rbs_out: self.rb_rbs_out.as_deref(),
            rb_mcp_rbs_out: self.rb_mcp_rbs_out.as_deref(),
            rb_parity_out: self.rb_parity_out.as_deref(),
            rb_conformance_out: self.rb_conformance_out.as_deref(),
            go_conformance_out: self.go_conformance_out.as_deref(),
            rs_client_out: self.rs_client_out.as_deref(),
            rs_helpers_out: self.rs_helpers_out.as_deref(),
            rs_parity_out: self.rs_parity_out.as_deref(),
            go_client_out: self.go_client_out.as_deref(),
            go_helpers_out: self.go_helpers_out.as_deref(),
            go_parity_out: self.go_parity_out.as_deref(),
            c_bindings_out: self.c_bindings_out.as_deref(),
            c_conformance_out: self.c_conformance_out.as_deref(),
            c_parity_out: self.c_parity_out.as_deref(),
            fixture_runner_out: self.fixture_runner_out.as_deref(),
            rb_mcp_layer2_out: self.rb_mcp_layer2_out.as_deref(),
            py_mcp_layer2_out: self.py_mcp_layer2_out.as_deref(),
            go_mcp_layer2_out: self.go_mcp_layer2_out.as_deref(),
            ts_mcp_native_out: self.ts_mcp_native_out.as_deref(),
            rs_mcp_layer2_out: self.rs_mcp_layer2_out.as_deref(),
        }
    }
}
