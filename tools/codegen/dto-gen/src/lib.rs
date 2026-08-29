//! OpenAPI snapshot + SDK contract manifest → `solvapay-dto` generator.

pub mod chrome;
pub mod derive_bindings;
pub mod doc_coverage;
pub mod doc_parity;
pub mod doc_render;
pub mod emit;
pub mod emit_bindings_rs;
pub mod emit_bindings_ts;
pub mod emit_client_go;
pub mod emit_client_rb;
pub mod emit_client_rs;
pub mod emit_client_runtime_ts;
pub mod emit_client_ts;
pub mod emit_conformance_c;
pub mod emit_conformance_chrome;
pub mod emit_conformance_go;
pub mod emit_conformance_py;
pub mod emit_conformance_rb;
pub mod emit_core_types_ts;
pub mod emit_core_wrappers_ts;
pub mod emit_fixture_runner_rs;
pub mod emit_helpers;
pub mod emit_helpers_go;
pub mod emit_helpers_py;
pub mod emit_helpers_rs;
pub mod emit_mcp;
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
pub mod header;
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
pub use doc_parity::{check_doc_parity, EmittedSurface};
pub use emit::{emit_crate, EmittedCrate};
pub use emit_bindings_rs::{emit_bindings, EmittedBindings, Toolchain};
pub use emit_bindings_ts::emit_native_ts;
pub use emit_client_go::emit_client_go;
pub use emit_client_rb::{emit_client_rb, EmittedRubyPublic};
pub use emit_client_rs::{emit_client_rs, EmittedRustClient};
pub use emit_client_runtime_ts::emit_client_runtime_ts;
pub use emit_client_ts::emit_client_ts;
pub use emit_conformance_c::emit_conformance_c;
pub use emit_conformance_go::emit_conformance_go;
pub use emit_conformance_py::emit_conformance_py;
pub use emit_conformance_rb::emit_conformance_rb;
pub use emit_core_types_ts::emit_core_types_ts;
pub use emit_core_wrappers_ts::{emit_core_wrappers_ts, CoreWrapperKind};
pub use emit_fixture_runner_rs::emit_fixture_runner;
pub use emit_helpers_go::emit_helpers_go;
pub use emit_helpers_py::emit_helpers_py;
pub use emit_helpers_rs::emit_helpers_rs;
pub use emit_mcp::{emit_mcp_go, emit_mcp_py, emit_mcp_rb, emit_mcp_rs, emit_mcp_ts};
pub use emit_native_py::emit_native_py;
pub use emit_native_rb::emit_native_rb;
pub use emit_parity_suite_c::emit_parity_suite_c;
pub use emit_parity_suite_go::emit_parity_suite_go;
pub use emit_parity_suite_py::emit_parity_suite_py;
pub use emit_parity_suite_rb::emit_parity_suite_rb;
pub use emit_parity_suite_rs::emit_parity_suite_rs;
pub use emit_parity_suite_ts::emit_parity_suite_ts;
pub use emit_pyi_py::emit_pyi_py;
pub use emit_rbs_rb::{emit_mcp_rbs_rb, emit_rbs_rb};
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
    /// `--ts-client-runtime-out`
    pub ts_client_runtime_out: Option<&'a Path>,
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
    /// `--py-helpers-out`
    pub py_helpers_out: Option<&'a Path>,
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
    /// `--rb-mcp-rbs-out`
    pub rb_mcp_rbs_out: Option<&'a Path>,
    /// `--rb-parity-out`
    pub rb_parity_out: Option<&'a Path>,
    /// `--rb-conformance-out`
    pub rb_conformance_out: Option<&'a Path>,
    /// `--go-conformance-out`
    pub go_conformance_out: Option<&'a Path>,
    /// `--rs-client-out`
    pub rs_client_out: Option<&'a Path>,
    /// `--rs-helpers-out`
    pub rs_helpers_out: Option<&'a Path>,
    /// `--rs-parity-out`
    pub rs_parity_out: Option<&'a Path>,
    /// `--go-client-out`
    pub go_client_out: Option<&'a Path>,
    /// `--go-helpers-out`
    pub go_helpers_out: Option<&'a Path>,
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
    /// `--rb-mcp-layer2-out`
    pub rb_mcp_layer2_out: Option<&'a Path>,
    /// `--py-mcp-layer2-out`
    pub py_mcp_layer2_out: Option<&'a Path>,
    /// `--go-mcp-layer2-out`
    pub go_mcp_layer2_out: Option<&'a Path>,
    /// `--ts-mcp-native-out`
    pub ts_mcp_native_out: Option<&'a Path>,
    /// `--rs-mcp-layer2-out`
    pub rs_mcp_layer2_out: Option<&'a Path>,
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

    write_file_outputs(
        &ir,
        &[
            ("--ts-out", outputs.ts_out, emit_overlays_ts, false),
            (
                "--ts-client-out",
                outputs.ts_client_out,
                emit_client_ts,
                false,
            ),
            (
                "--ts-client-runtime-out",
                outputs.ts_client_runtime_out,
                emit_client_runtime_ts,
                false,
            ),
            (
                "--ts-parity-out",
                outputs.ts_parity_out,
                emit_parity_suite_ts,
                false,
            ),
            (
                "--dump-bindings",
                outputs.dump_bindings,
                dump_bindings_text,
                false,
            ),
            (
                "--dump-boundary-types",
                outputs.dump_boundary_types,
                dump_core_types,
                false,
            ),
            (
                "--core-types-ts-out",
                outputs.core_types_ts_out,
                emit_core_types_ts,
                false,
            ),
            (
                "--core-dispatch-ts-out",
                outputs.core_dispatch_ts_out,
                emit_dispatch_ts,
                false,
            ),
            (
                "--core-native-ts-out",
                outputs.core_native_ts_out,
                emit_native_core_ts,
                false,
            ),
            (
                "--core-helpers-ts-out",
                outputs.core_helpers_ts_out,
                emit_native_helpers_ts,
                false,
            ),
            (
                "--server-decisions-ts-out",
                outputs.server_decisions_ts_out,
                emit_native_decisions_ts,
                false,
            ),
            (
                "--c-parity-out",
                outputs.c_parity_out,
                emit_parity_suite_c,
                false,
            ),
            (
                "--fixture-runner-out",
                outputs.fixture_runner_out,
                emit_fixture_runner,
                true,
            ),
            (
                "--native-ts-out",
                outputs.native_ts_out,
                emit_native_ts_node,
                false,
            ),
            (
                "--wasm-ts-out",
                outputs.wasm_ts_out,
                emit_native_ts_wasm,
                false,
            ),
            (
                "--native-py-out",
                outputs.native_py_out,
                emit_native_py,
                false,
            ),
            ("--py-stub-out", outputs.py_stub_out, emit_pyi_py, false),
            (
                "--py-helpers-out",
                outputs.py_helpers_out,
                emit_helpers_py,
                false,
            ),
            (
                "--py-parity-out",
                outputs.py_parity_out,
                emit_parity_suite_py,
                false,
            ),
            (
                "--native-rb-out",
                outputs.native_rb_out,
                emit_native_rb,
                false,
            ),
            ("--rb-rbs-out", outputs.rb_rbs_out, emit_rbs_rb, false),
            (
                "--rb-mcp-rbs-out",
                outputs.rb_mcp_rbs_out,
                emit_mcp_rbs_rb,
                false,
            ),
            (
                "--rb-parity-out",
                outputs.rb_parity_out,
                emit_parity_suite_rb,
                false,
            ),
            (
                "--rs-parity-out",
                outputs.rs_parity_out,
                emit_parity_suite_rs,
                true,
            ),
            (
                "--go-client-out",
                outputs.go_client_out,
                emit_client_go,
                false,
            ),
            (
                "--go-helpers-out",
                outputs.go_helpers_out,
                emit_helpers_go,
                false,
            ),
            (
                "--go-parity-out",
                outputs.go_parity_out,
                emit_parity_suite_go,
                false,
            ),
            (
                "--rs-helpers-out",
                outputs.rs_helpers_out,
                emit_helpers_rs,
                true,
            ),
            (
                "--rb-mcp-layer2-out",
                outputs.rb_mcp_layer2_out,
                emit_mcp_rb,
                false,
            ),
            (
                "--py-mcp-layer2-out",
                outputs.py_mcp_layer2_out,
                emit_mcp_py,
                false,
            ),
            (
                "--go-mcp-layer2-out",
                outputs.go_mcp_layer2_out,
                emit_mcp_go,
                false,
            ),
            (
                "--ts-mcp-native-out",
                outputs.ts_mcp_native_out,
                emit_mcp_ts,
                false,
            ),
            (
                "--rs-mcp-layer2-out",
                outputs.rs_mcp_layer2_out,
                emit_mcp_rs,
                true,
            ),
        ],
    )?;

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

    if let Some(dir) = outputs.py_conformance_out {
        let files = emit_conformance_py(&ir)?;
        write_conformance_dir(dir, &files)?;
    }

    if let Some(rb_client_path) = outputs.rb_client_out {
        let ruby = emit_client_rb(&ir)?;
        write_contents(rb_client_path, &ruby.client_rb)?;
        let parent = rb_client_path.parent().ok_or_else(|| {
            GenError::Parse("--rb-client-out must have a parent directory".into())
        })?;
        write_contents(&parent.join("helpers.generated.rb"), &ruby.helpers_rb)?;
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
        write_contents(rs_client_path, &rust.client_generated_rs)?;
        let parent = rs_client_path.parent().ok_or_else(|| {
            GenError::Parse("--rs-client-out must have a parent directory".into())
        })?;
        let blocking_path = parent.join("blocking_generated.rs");
        write_contents(&blocking_path, &rust.blocking_generated_rs)?;
        rustfmt_files(&[rs_client_path.to_path_buf(), blocking_path])?;
    }

    Ok(())
}

fn dump_bindings_text(ir: &Ir) -> GenResult<String> {
    Ok(dump_binding_symbols(ir))
}

fn emit_dispatch_ts(ir: &Ir) -> GenResult<String> {
    emit_core_wrappers_ts(ir, CoreWrapperKind::Dispatch)
}

fn emit_native_core_ts(ir: &Ir) -> GenResult<String> {
    emit_core_wrappers_ts(ir, CoreWrapperKind::NativeCore)
}

fn emit_native_helpers_ts(ir: &Ir) -> GenResult<String> {
    emit_core_wrappers_ts(ir, CoreWrapperKind::NativeHelpers)
}

fn emit_native_decisions_ts(ir: &Ir) -> GenResult<String> {
    emit_core_wrappers_ts(ir, CoreWrapperKind::NativeDecisions)
}

fn emit_native_ts_node(ir: &Ir) -> GenResult<String> {
    emit_native_ts(ir, Toolchain::Node)
}

fn emit_native_ts_wasm(ir: &Ir) -> GenResult<String> {
    emit_native_ts(ir, Toolchain::Wasm)
}

/// One dto-gen `--flag` write: path, emitter, and whether to rustfmt the result.
type FileOutput<'a> = (
    &'static str,
    Option<&'a Path>,
    fn(&Ir) -> GenResult<String>,
    bool,
);

fn write_file_outputs(ir: &Ir, items: &[FileOutput<'_>]) -> GenResult<()> {
    for (flag, path, emit, rustfmt) in items {
        let Some(path) = path else {
            continue;
        };
        write_contents(
            path,
            &emit(ir).map_err(|e| GenError::Parse(format!("{flag}: {e}")))?,
        )?;
        if *rustfmt {
            rustfmt_files(&[path.to_path_buf()])?;
        }
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

fn write_contents(path: &Path, contents: &str) -> GenResult<()> {
    create_parent(path)?;
    write_file(path, contents)
}

fn write_formatted_files(dir: &Path, files: &[(&str, &str)]) -> GenResult<()> {
    fs::create_dir_all(dir).map_err(|source| GenError::Io {
        path: dir.to_path_buf(),
        source,
    })?;
    let mut paths = Vec::with_capacity(files.len());
    for (name, contents) in files {
        let path = dir.join(name);
        write_file(&path, contents)?;
        paths.push(path);
    }
    rustfmt_files(&paths)
}

fn write_ruby_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    write_formatted_files(
        dir,
        &[
            ("args.rs", &emitted.args_rs),
            ("decisions.rs", &emitted.decisions_rs),
            ("payload_builders.rs", &emitted.payload_builders_rs),
            ("client.rs", &emitted.client_rs),
            ("register.rs", &emitted.register_rs),
        ],
    )
}

fn write_go_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    write_formatted_files(
        dir,
        &[
            ("args.rs", &emitted.args_rs),
            ("decisions.rs", &emitted.decisions_rs),
            ("payload_builders.rs", &emitted.payload_builders_rs),
            ("client.rs", &emitted.client_rs),
            ("webhook.rs", &emitted.webhook_rs),
        ],
    )
}

fn write_c_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    write_formatted_files(dir, &[("dispatch.rs", &emitted.client_rs)])
}

fn write_python_shim(dir: &Path, emitted: &EmittedBindings) -> GenResult<()> {
    write_formatted_files(
        dir,
        &[
            ("args.rs", &emitted.args_rs),
            ("decisions.rs", &emitted.decisions_rs),
            ("payload_builders.rs", &emitted.payload_builders_rs),
            ("client.rs", &emitted.client_rs),
            ("register.rs", &emitted.register_rs),
        ],
    )
}

fn write_binding_shims(dir: &Path, emitted: &EmittedBindings, client_file: &str) -> GenResult<()> {
    write_formatted_files(
        dir,
        &[
            ("args.rs", &emitted.args_rs),
            ("decisions.rs", &emitted.decisions_rs),
            ("payload_builders.rs", &emitted.payload_builders_rs),
            (client_file, &emitted.client_rs),
        ],
    )
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

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]
mod output_dispatch_tests {
    use super::*;

    fn dummy_emit(_ir: &Ir) -> GenResult<String> {
        Ok("// @generated\nok\n".into())
    }

    #[test]
    fn write_file_outputs_creates_missing_parent_dirs_for_each_flag() {
        let dir = std::env::temp_dir().join(format!(
            "dto-gen-file-outs-{}-{}",
            std::process::id(),
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        let flags = [
            "--ts-out",
            "--ts-client-out",
            "--ts-client-runtime-out",
            "--ts-parity-out",
            "--dump-bindings",
            "--dump-boundary-types",
            "--core-types-ts-out",
            "--core-dispatch-ts-out",
            "--core-native-ts-out",
            "--core-helpers-ts-out",
            "--server-decisions-ts-out",
            "--c-parity-out",
            "--native-ts-out",
            "--wasm-ts-out",
            "--native-py-out",
            "--py-stub-out",
            "--py-helpers-out",
            "--py-parity-out",
            "--native-rb-out",
            "--rb-rbs-out",
            "--rb-mcp-rbs-out",
            "--rb-parity-out",
            "--go-client-out",
            "--go-helpers-out",
            "--go-parity-out",
            "--rs-helpers-out",
            "--rb-mcp-layer2-out",
            "--py-mcp-layer2-out",
            "--go-mcp-layer2-out",
            "--ts-mcp-native-out",
            "--rs-mcp-layer2-out",
        ];
        let paths: Vec<PathBuf> = flags
            .iter()
            .map(|flag| dir.join("nested").join(flag.trim_start_matches('-')))
            .collect();
        let items: Vec<FileOutput<'_>> = flags
            .iter()
            .zip(paths.iter())
            .map(|(flag, path)| {
                (
                    *flag,
                    Some(path.as_path()),
                    dummy_emit as fn(&Ir) -> GenResult<String>,
                    false,
                )
            })
            .collect();
        write_file_outputs(&Ir::default(), &items).unwrap();
        for path in &paths {
            assert_eq!(fs::read_to_string(path).unwrap(), "// @generated\nok\n");
        }
        let _ = fs::remove_dir_all(&dir);
    }
}
