//! OpenAPI snapshot + SDK contract manifest → `solvapay-dto` generator.

pub mod derive_bindings;
pub mod doc_coverage;
pub mod doc_render;
pub mod emit;
pub mod emit_bindings_rs;
pub mod emit_bindings_ts;
pub mod emit_client_go;
pub mod emit_client_rb;
pub mod emit_client_rs;
pub mod emit_client_ts;
pub mod emit_conformance_c;
pub mod emit_conformance_chrome;
pub mod emit_conformance_go;
pub mod emit_conformance_py;
pub mod emit_conformance_rb;
pub mod emit_core_types_ts;
pub mod emit_core_wrappers_ts;
pub mod emit_fixture_runner_rs;
pub mod emit_native_py;
pub mod emit_native_rb;
pub mod emit_parity_suite_c;
pub mod emit_parity_suite_go;
pub mod emit_parity_suite_py;
pub mod emit_parity_suite_rb;
pub mod emit_parity_suite_rs;
pub mod emit_parity_suite_ts;
pub mod emit_pyi_py;
pub mod emit_rbs_rb;
pub mod emit_ts;
pub mod error;
pub mod ir;
pub mod lower_bindings;
pub mod lower_catalog;
pub mod lower_core_types;
pub mod lower_errors;
pub mod lower_overlays;
pub mod manifest;
pub mod name;
pub mod parse;
pub mod scan_core_types;

pub use derive_bindings::{derive_export_bindings, install_derived_bindings};
pub use doc_coverage::check_doc_coverage;
pub use emit::{emit_crate, EmittedCrate};
pub use emit_bindings_rs::{emit_bindings, EmittedBindings, Toolchain};
pub use emit_bindings_ts::emit_native_ts;
pub use emit_client_go::emit_client_go;
pub use emit_client_rb::{emit_client_rb, EmittedRubyPublic};
pub use emit_client_rs::{emit_client_rs, EmittedRustClient};
pub use emit_client_ts::emit_client_ts;
pub use emit_conformance_c::emit_conformance_c;
pub use emit_conformance_go::emit_conformance_go;
pub use emit_conformance_py::emit_conformance_py;
pub use emit_conformance_rb::emit_conformance_rb;
pub use emit_core_types_ts::emit_core_types_ts;
pub use emit_core_wrappers_ts::{emit_core_wrappers_ts, CoreWrapperKind};
pub use emit_fixture_runner_rs::emit_fixture_runner;
pub use emit_native_py::emit_native_py;
pub use emit_native_rb::emit_native_rb;
pub use emit_parity_suite_c::emit_parity_suite_c;
pub use emit_parity_suite_go::emit_parity_suite_go;
pub use emit_parity_suite_py::emit_parity_suite_py;
pub use emit_parity_suite_rb::emit_parity_suite_rb;
pub use emit_parity_suite_rs::emit_parity_suite_rs;
pub use emit_parity_suite_ts::emit_parity_suite_ts;
pub use emit_pyi_py::emit_pyi_py;
pub use emit_rbs_rb::emit_rbs_rb;
pub use emit_ts::emit_overlays_ts;
pub use error::{GenError, GenResult};
pub use ir::Ir;
pub use lower_bindings::dump_binding_symbols;
pub use lower_catalog::lower_catalog;
pub use lower_core_types::{dump_core_types, lower_core_types};
pub use lower_errors::lower_errors;
pub use lower_overlays::lower_overlays;
pub use manifest::{BindingResidueManifest, Manifest};
pub use parse::parse_openapi;
pub use scan_core_types::scan_core_types;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// Load `binding-residue.yaml`.
///
/// # Errors
///
/// IO or YAML parse failures.
pub fn load_binding_residue(path: &Path) -> GenResult<BindingResidueManifest> {
    let raw = fs::read_to_string(path).map_err(|source| GenError::Io {
        path: path.to_path_buf(),
        source,
    })?;
    serde_norway::from_str(&raw)
        .map_err(|e| GenError::Parse(format!("invalid binding-residue YAML: {e}")))
}

/// `#[solvapay_export]` symbols, then exact-path join.
///
/// # Errors
///
/// Lower, derive, or join failures.
pub fn lower_all_bindings(
    ir: &mut Ir,
    manifest: &Manifest,
    core_src: &Path,
    residue: &BindingResidueManifest,
    transport_src: Option<&Path>,
) -> GenResult<()> {
    lower_core_types(ir, core_src, manifest)?;
    if let Some(transport_src) = transport_src {
        crate::lower_core_types::lower_transport_fns(ir, transport_src)?;
    }
    install_derived_bindings(ir, residue)?;
    crate::lower_core_types::join_binding_fns(ir)
}

/// Optional dto-gen output paths (all default to skipped).
#[derive(Debug, Default, Clone)]
pub struct GenOutputs<'a> {
    /// `--ts-out`
    pub ts_out: Option<&'a Path>,
    /// `--ts-client-out`
    pub ts_client_out: Option<&'a Path>,
    /// `--ts-parity-out`
    pub ts_parity_out: Option<&'a Path>,
    /// `--dump-bindings`
    pub dump_bindings: Option<&'a Path>,
    /// `--dump-boundary-types`
    pub dump_boundary_types: Option<&'a Path>,
    /// `--core-types-ts-out`
    pub core_types_ts_out: Option<&'a Path>,
    /// `--core-dispatch-ts-out`
    pub core_dispatch_ts_out: Option<&'a Path>,
    /// `--core-native-ts-out`
    pub core_native_ts_out: Option<&'a Path>,
    /// `--core-helpers-ts-out`
    pub core_helpers_ts_out: Option<&'a Path>,
    /// `--server-decisions-ts-out`
    pub server_decisions_ts_out: Option<&'a Path>,
    /// `--node-bindings-out`
    pub node_bindings_out: Option<&'a Path>,
    /// `--wasm-bindings-out`
    pub wasm_bindings_out: Option<&'a Path>,
    /// `--python-bindings-out`
    pub python_bindings_out: Option<&'a Path>,
    /// `--ruby-bindings-out`
    pub ruby_bindings_out: Option<&'a Path>,
    /// `--go-bindings-out`
    pub go_bindings_out: Option<&'a Path>,
    /// `--native-ts-out`
    pub native_ts_out: Option<&'a Path>,
    /// `--wasm-ts-out`
    pub wasm_ts_out: Option<&'a Path>,
    /// `--native-py-out`
    pub native_py_out: Option<&'a Path>,
    /// `--py-stub-out`
    pub py_stub_out: Option<&'a Path>,
    /// `--py-parity-out`
    pub py_parity_out: Option<&'a Path>,
    /// `--py-conformance-out`
    pub py_conformance_out: Option<&'a Path>,
    /// `--native-rb-out`
    pub native_rb_out: Option<&'a Path>,
    /// `--rb-client-out`
    pub rb_client_out: Option<&'a Path>,
    /// `--rb-rbs-out`
    pub rb_rbs_out: Option<&'a Path>,
    /// `--rb-parity-out`
    pub rb_parity_out: Option<&'a Path>,
    /// `--rb-conformance-out`
    pub rb_conformance_out: Option<&'a Path>,
    /// `--go-conformance-out`
    pub go_conformance_out: Option<&'a Path>,
    /// `--rs-client-out`
    pub rs_client_out: Option<&'a Path>,
    /// `--rs-parity-out`
    pub rs_parity_out: Option<&'a Path>,
    /// `--go-client-out`
    pub go_client_out: Option<&'a Path>,
    /// `--go-parity-out`
    pub go_parity_out: Option<&'a Path>,
    /// `--c-bindings-out`
    pub c_bindings_out: Option<&'a Path>,
    /// `--c-conformance-out`
    pub c_conformance_out: Option<&'a Path>,
    /// `--c-parity-out`
    pub c_parity_out: Option<&'a Path>,
    /// `--fixture-runner-out`
    pub fixture_runner_out: Option<&'a Path>,
}

/// Reads an OpenAPI snapshot (+ optional manifest), builds IR, and writes generated sources.
///
/// # Errors
///
/// Returns IO/parse/emit failures from the underlying steps.
pub fn generate_from_snapshot(
    snapshot_path: &Path,
    out_dir: &Path,
    manifest_path: Option<&Path>,
    core_src: Option<&Path>,
    binding_residue: Option<&Path>,
    transport_src: Option<&Path>,
    outputs: &GenOutputs<'_>,
) -> GenResult<()> {
    let raw = fs::read_to_string(snapshot_path).map_err(|source| GenError::Io {
        path: snapshot_path.to_path_buf(),
        source,
    })?;
    let value: Value = serde_json::from_str(&raw)
        .map_err(|e| GenError::Parse(format!("invalid snapshot JSON: {e}")))?;
    let mut ir = parse_openapi(&value)?;

    if let Some(manifest_path) = manifest_path {
        let manifest_raw = fs::read_to_string(manifest_path).map_err(|source| GenError::Io {
            path: manifest_path.to_path_buf(),
            source,
        })?;
        let manifest: Manifest = serde_norway::from_str(&manifest_raw)
            .map_err(|e| GenError::Parse(format!("invalid manifest YAML: {e}")))?;
        lower_overlays(&mut ir, &manifest)?;
        lower_errors(&mut ir, &manifest)?;
        lower_catalog(&mut ir, &manifest)?;
        check_doc_coverage(&ir)?;
        if let Some(core_src) = core_src {
            let residue_path = binding_residue
                .ok_or_else(|| GenError::Parse("--core-src requires --binding-residue".into()))?;
            let residue = load_binding_residue(residue_path)?;
            lower_all_bindings(&mut ir, &manifest, core_src, &residue, transport_src)?;
        } else if outputs.dump_boundary_types.is_some() || outputs.dump_bindings.is_some() {
            return Err(GenError::Parse(
                "--dump-boundary-types / --dump-bindings require --core-src".into(),
            ));
        }
    } else if outputs.dump_boundary_types.is_some() {
        return Err(GenError::Parse(
            "--dump-boundary-types requires --manifest".into(),
        ));
    }

    let emitted = emit_crate(&ir)?;
    write_emitted(out_dir, &emitted)?;

    if let Some(ts_path) = outputs.ts_out {
        let ts = emit_overlays_ts(&ir)?;
        if let Some(parent) = ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_path, &ts)?;
    }

    if let Some(ts_client_path) = outputs.ts_client_out {
        let ts = emit_client_ts(&ir)?;
        if let Some(parent) = ts_client_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_client_path, &ts)?;
    }

    if let Some(ts_parity_path) = outputs.ts_parity_out {
        let ts = emit_parity_suite_ts(&ir)?;
        if let Some(parent) = ts_parity_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_parity_path, &ts)?;
    }

    if let Some(bindings_path) = outputs.dump_bindings {
        let json = dump_binding_symbols(&ir);
        if let Some(parent) = bindings_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(bindings_path, &json)?;
    }

    if let Some(path) = outputs.dump_boundary_types {
        let json = dump_core_types(&ir)?;
        create_parent(path)?;
        write_file(path, &json)?;
    }

    if let Some(path) = outputs.core_types_ts_out {
        let ts = emit_core_types_ts(&ir)?;
        create_parent(path)?;
        write_file(path, &ts)?;
    }

    if let Some(path) = outputs.core_dispatch_ts_out {
        let ts = emit_core_wrappers_ts(&ir, CoreWrapperKind::Dispatch)?;
        create_parent(path)?;
        write_file(path, &ts)?;
    }
    if let Some(path) = outputs.core_native_ts_out {
        let ts = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeCore)?;
        create_parent(path)?;
        write_file(path, &ts)?;
    }
    if let Some(path) = outputs.core_helpers_ts_out {
        let ts = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeHelpers)?;
        create_parent(path)?;
        write_file(path, &ts)?;
    }
    if let Some(path) = outputs.server_decisions_ts_out {
        let ts = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeDecisions)?;
        create_parent(path)?;
        write_file(path, &ts)?;
    }

    if let Some(dir) = outputs.node_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Node)?;
        write_binding_shims(dir, &emitted, "native_client.rs")?;
    }

    if let Some(dir) = outputs.wasm_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Wasm)?;
        write_binding_shims(dir, &emitted, "wasm_client.rs")?;
    }

    if let Some(dir) = outputs.python_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Python)?;
        write_python_shim(dir, &emitted)?;
    }

    if let Some(dir) = outputs.ruby_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Ruby)?;
        write_ruby_shim(dir, &emitted)?;
    }

    if let Some(dir) = outputs.go_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Go)?;
        write_go_shim(dir, &emitted)?;
    }

    if let Some(dir) = outputs.c_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::C)?;
        write_c_shim(dir, &emitted)?;
    }

    if let Some(dir) = outputs.c_conformance_out {
        let files = emit_conformance_c(&ir)?;
        write_conformance_dir(dir, &files)?;
    }

    if let Some(path) = outputs.c_parity_out {
        let c = emit_parity_suite_c(&ir)?;
        create_parent(path)?;
        write_file(path, &c)?;
    }

    if let Some(path) = outputs.fixture_runner_out {
        let rs = emit_fixture_runner(&ir)?;
        create_parent(path)?;
        write_file(path, &rs)?;
        rustfmt_files(&[path.to_path_buf()])?;
    }

    if let Some(native_ts_path) = outputs.native_ts_out {
        let ts = emit_native_ts(&ir, Toolchain::Node)?;
        if let Some(parent) = native_ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(native_ts_path, &ts)?;
    }

    if let Some(wasm_ts_path) = outputs.wasm_ts_out {
        let ts = emit_native_ts(&ir, Toolchain::Wasm)?;
        if let Some(parent) = wasm_ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(wasm_ts_path, &ts)?;
    }

    if let Some(native_py_path) = outputs.native_py_out {
        let py = emit_native_py(&ir)?;
        if let Some(parent) = native_py_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(native_py_path, &py)?;
    }

    if let Some(py_stub_path) = outputs.py_stub_out {
        let pyi = emit_pyi_py(&ir)?;
        create_parent(py_stub_path)?;
        write_file(py_stub_path, &pyi)?;
    }

    if let Some(py_parity_path) = outputs.py_parity_out {
        let py = emit_parity_suite_py(&ir)?;
        if let Some(parent) = py_parity_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(py_parity_path, &py)?;
    }

    if let Some(dir) = outputs.py_conformance_out {
        let files = emit_conformance_py(&ir)?;
        write_conformance_dir(dir, &files)?;
    }

    if let Some(native_rb_path) = outputs.native_rb_out {
        let ruby = emit_native_rb(&ir)?;
        create_parent(native_rb_path)?;
        write_file(native_rb_path, &ruby)?;
    }

    if let Some(rb_client_path) = outputs.rb_client_out {
        let ruby = emit_client_rb(&ir)?;
        create_parent(rb_client_path)?;
        write_file(rb_client_path, &ruby.client_rb)?;
        let parent = rb_client_path.parent().ok_or_else(|| {
            GenError::Parse("--rb-client-out must have a parent directory".into())
        })?;
        write_file(&parent.join("helpers.generated.rb"), &ruby.helpers_rb)?;
    }

    if let Some(rb_rbs_path) = outputs.rb_rbs_out {
        let rbs = emit_rbs_rb(&ir)?;
        create_parent(rb_rbs_path)?;
        write_file(rb_rbs_path, &rbs)?;
    }

    if let Some(rb_parity_path) = outputs.rb_parity_out {
        let ruby = emit_parity_suite_rb(&ir)?;
        create_parent(rb_parity_path)?;
        write_file(rb_parity_path, &ruby)?;
    }

    if let Some(dir) = outputs.rb_conformance_out {
        let files = emit_conformance_rb(&ir)?;
        write_conformance_dir(dir, &files)?;
    }

    if let Some(dir) = outputs.go_conformance_out {
        let files = emit_conformance_go(&ir)?;
        write_conformance_dir(dir, &files)?;
    }

    if let Some(rs_client_path) = outputs.rs_client_out {
        let rust = emit_client_rs(&ir)?;
        create_parent(rs_client_path)?;
        write_file(rs_client_path, &rust.client_generated_rs)?;
        let parent = rs_client_path.parent().ok_or_else(|| {
            GenError::Parse("--rs-client-out must have a parent directory".into())
        })?;
        let blocking_path = parent.join("blocking_generated.rs");
        write_file(&blocking_path, &rust.blocking_generated_rs)?;
        rustfmt_files(&[rs_client_path.to_path_buf(), blocking_path])?;
    }

    if let Some(rs_parity_path) = outputs.rs_parity_out {
        let rust = emit_parity_suite_rs(&ir)?;
        create_parent(rs_parity_path)?;
        write_file(rs_parity_path, &rust)?;
        rustfmt_files(&[rs_parity_path.to_path_buf()])?;
    }

    if let Some(go_client_path) = outputs.go_client_out {
        let go = emit_client_go(&ir)?;
        create_parent(go_client_path)?;
        write_file(go_client_path, &go)?;
    }

    if let Some(go_parity_path) = outputs.go_parity_out {
        let go = emit_parity_suite_go(&ir)?;
        create_parent(go_parity_path)?;
        write_file(go_parity_path, &go)?;
    }

    Ok(())
}

/// Writes named conformance-harness files into `dir`.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when a relative name contains `/`, `\`, or `..`.
fn write_conformance_dir(dir: &Path, files: &[(String, String)]) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    for (name, contents) in files {
        if name.contains('/') || name.contains('\\') || name.contains("..") {
            return Err(GenError::Parse(format!(
                "illegal emitted conformance path {name}"
            )));
        }
        write_file(&dir.join(name), contents)?;
    }
    Ok(())
}

fn create_parent(path: &Path) -> GenResult<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|source| GenError::Io {
            path: parent.to_path_buf(),
            source,
        })?;
    }
    Ok(())
}

/// Writes + rustfmts all generated Step 44 Ruby binding shims.
///
/// # Errors
///
/// Returns [`GenError::Io`] on write failures or [`GenError::Parse`] if rustfmt
/// is unavailable.
fn write_ruby_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let paths = [
        dir.join("args.rs"),
        dir.join("decisions.rs"),
        dir.join("payload_builders.rs"),
        dir.join("client.rs"),
        dir.join("register.rs"),
    ];
    write_file(&paths[0], &emitted.args_rs)?;
    write_file(&paths[1], &emitted.decisions_rs)?;
    write_file(&paths[2], &emitted.payload_builders_rs)?;
    write_file(&paths[3], &emitted.client_rs)?;
    write_file(&paths[4], &emitted.register_rs)?;
    rustfmt_files(&paths)?;
    Ok(())
}

/// Writes + rustfmts the Step 49 Go (wazero WASI guest) binding shims
/// (`args.rs` / `client.rs` / `webhook.rs`).
///
/// # Errors
///
/// Returns [`GenError::Io`] on write failures or [`GenError::Parse`] if rustfmt
/// is unavailable.
fn write_go_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let paths = [
        dir.join("args.rs"),
        dir.join("decisions.rs"),
        dir.join("payload_builders.rs"),
        dir.join("client.rs"),
        dir.join("webhook.rs"),
    ];
    write_file(&paths[0], &emitted.args_rs)?;
    write_file(&paths[1], &emitted.decisions_rs)?;
    write_file(&paths[2], &emitted.payload_builders_rs)?;
    write_file(&paths[3], &emitted.client_rs)?;
    write_file(&paths[4], &emitted.webhook_rs)?;
    rustfmt_files(&paths)?;
    Ok(())
}

/// Writes + rustfmts the C ABI `dispatch.rs` match table.
fn write_c_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let path = dir.join("dispatch.rs");
    write_file(&path, &emitted.client_rs)?;
    rustfmt_files(&[path])?;
    Ok(())
}

/// Writes + rustfmts the Step 41 Python binding shims (`args` / `decisions` /
/// `payload_builders` / `client` / `register`).
///
/// # Errors
///
/// Returns [`GenError::Io`] on write failures or [`GenError::Parse`] if rustfmt
/// is unavailable.
fn write_python_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let paths = [
        dir.join("args.rs"),
        dir.join("decisions.rs"),
        dir.join("payload_builders.rs"),
        dir.join("client.rs"),
        dir.join("register.rs"),
    ];
    write_file(&paths[0], &emitted.args_rs)?;
    write_file(&paths[1], &emitted.decisions_rs)?;
    write_file(&paths[2], &emitted.payload_builders_rs)?;
    write_file(&paths[3], &emitted.client_rs)?;
    write_file(&paths[4], &emitted.register_rs)?;
    rustfmt_files(&paths)?;
    Ok(())
}

/// Writes + rustfmts the four generated shim files for one toolchain.
///
/// # Errors
///
/// Returns [`GenError::Io`] on write failures or [`GenError::Parse`] if rustfmt
/// is unavailable.
fn write_binding_shims(dir: &Path, emitted: &EmittedBindings, client_file: &str) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let paths = [
        dir.join("args.rs"),
        dir.join("decisions.rs"),
        dir.join("payload_builders.rs"),
        dir.join(client_file),
    ];
    write_file(&paths[0], &emitted.args_rs)?;
    write_file(&paths[1], &emitted.decisions_rs)?;
    write_file(&paths[2], &emitted.payload_builders_rs)?;
    write_file(&paths[3], &emitted.client_rs)?;
    rustfmt_files(&paths)?;
    Ok(())
}

/// Writes an [`EmittedCrate`] into `out_dir`.
///
/// # Errors
///
/// Returns [`GenError::Io`] when a file cannot be created or written.
pub fn write_emitted(out_dir: &Path, emitted: &EmittedCrate) -> GenResult<()> {
    fs::create_dir_all(out_dir).map_err(|source| GenError::Io {
        path: out_dir.to_path_buf(),
        source,
    })?;
    let paths = [
        out_dir.join("lib.rs"),
        out_dir.join("schemas.rs"),
        out_dir.join("routes.rs"),
        out_dir.join("overlays.rs"),
        out_dir.join("error_templates.rs"),
    ];
    write_file(&paths[0], &emitted.lib_rs)?;
    write_file(&paths[1], &emitted.schemas_rs)?;
    write_file(&paths[2], &emitted.routes_rs)?;
    write_file(&paths[3], &emitted.overlays_rs)?;
    write_file(&paths[4], &emitted.error_templates_rs)?;
    rustfmt_files(&paths)?;
    Ok(())
}

fn write_file(path: &Path, contents: &str) -> GenResult<()> {
    fs::write(path, contents).map_err(|source| GenError::Io {
        path: path.to_path_buf(),
        source,
    })
}

/// Runs `rustfmt` on generated sources so CI `fmt --check` and regen drift agree.
///
/// # Errors
///
/// Returns [`GenError::Parse`] when rustfmt is missing or exits non-zero.
fn rustfmt_files(paths: &[PathBuf]) -> GenResult<()> {
    let status = Command::new("rustfmt")
        .arg("--edition=2021")
        .args(paths)
        .status()
        .map_err(|e| GenError::Parse(format!("failed to spawn rustfmt: {e}")))?;
    if !status.success() {
        return Err(GenError::Parse(format!(
            "rustfmt failed with status {status}"
        )));
    }
    Ok(())
}
