//! OpenAPI snapshot + SDK contract manifest → `solvapay-dto` generator.

pub mod doc_coverage;
pub mod doc_render;
pub mod emit;
pub mod emit_bindings_rs;
pub mod emit_bindings_ts;
pub mod emit_client_rb;
pub mod emit_client_rs;
pub mod emit_client_ts;
pub mod emit_native_py;
pub mod emit_native_rb;
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
pub mod lower_errors;
pub mod lower_overlays;
pub mod manifest;
pub mod name;
pub mod parse;

pub use doc_coverage::check_doc_coverage;
pub use emit::{emit_crate, EmittedCrate};
pub use emit_bindings_rs::{emit_bindings, EmittedBindings, Toolchain};
pub use emit_bindings_ts::emit_native_ts;
pub use emit_client_rb::{emit_client_rb, EmittedRubyPublic};
pub use emit_client_rs::{emit_client_rs, EmittedRustClient};
pub use emit_client_ts::emit_client_ts;
pub use emit_native_py::emit_native_py;
pub use emit_native_rb::emit_native_rb;
pub use emit_parity_suite_py::emit_parity_suite_py;
pub use emit_parity_suite_rb::emit_parity_suite_rb;
pub use emit_parity_suite_rs::emit_parity_suite_rs;
pub use emit_parity_suite_ts::emit_parity_suite_ts;
pub use emit_pyi_py::emit_pyi_py;
pub use emit_rbs_rb::emit_rbs_rb;
pub use emit_ts::emit_overlays_ts;
pub use error::{GenError, GenResult};
pub use ir::Ir;
pub use lower_bindings::{dump_binding_symbols, lower_bindings};
pub use lower_catalog::lower_catalog;
pub use lower_errors::lower_errors;
pub use lower_overlays::lower_overlays;
pub use manifest::Manifest;
pub use parse::parse_openapi;

use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

use serde_json::Value;

/// Reads an OpenAPI snapshot (+ optional manifest), builds IR, and writes generated sources.
///
/// # Errors
///
/// Returns IO/parse/emit failures from the underlying steps.
#[allow(clippy::too_many_arguments)]
pub fn generate_from_snapshot(
    snapshot_path: &Path,
    out_dir: &Path,
    manifest_path: Option<&Path>,
    ts_out: Option<&Path>,
    ts_client_out: Option<&Path>,
    ts_parity_out: Option<&Path>,
    dump_bindings: Option<&Path>,
    node_bindings_out: Option<&Path>,
    wasm_bindings_out: Option<&Path>,
    python_bindings_out: Option<&Path>,
    ruby_bindings_out: Option<&Path>,
    native_ts_out: Option<&Path>,
    wasm_ts_out: Option<&Path>,
    native_py_out: Option<&Path>,
    py_stub_out: Option<&Path>,
    py_parity_out: Option<&Path>,
    native_rb_out: Option<&Path>,
    rb_client_out: Option<&Path>,
    rb_rbs_out: Option<&Path>,
    rb_parity_out: Option<&Path>,
    rs_client_out: Option<&Path>,
    rs_parity_out: Option<&Path>,
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
        lower_bindings(&mut ir, &manifest)?;
    }

    let emitted = emit_crate(&ir)?;
    write_emitted(out_dir, &emitted)?;

    if let Some(ts_path) = ts_out {
        let ts = emit_overlays_ts(&ir)?;
        if let Some(parent) = ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_path, &ts)?;
    }

    if let Some(ts_client_path) = ts_client_out {
        let ts = emit_client_ts(&ir)?;
        if let Some(parent) = ts_client_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_client_path, &ts)?;
    }

    if let Some(ts_parity_path) = ts_parity_out {
        let ts = emit_parity_suite_ts(&ir)?;
        if let Some(parent) = ts_parity_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(ts_parity_path, &ts)?;
    }

    if let Some(bindings_path) = dump_bindings {
        let json = dump_binding_symbols(&ir);
        if let Some(parent) = bindings_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(bindings_path, &json)?;
    }

    if let Some(dir) = node_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Node)?;
        write_binding_shims(dir, &emitted, "native_client.rs")?;
    }

    if let Some(dir) = wasm_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Wasm)?;
        write_binding_shims(dir, &emitted, "wasm_client.rs")?;
    }

    if let Some(dir) = python_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Python)?;
        write_python_shim(dir, &emitted)?;
    }

    if let Some(dir) = ruby_bindings_out {
        let emitted = emit_bindings(&ir, Toolchain::Ruby)?;
        write_ruby_shim(dir, &emitted)?;
    }

    if let Some(native_ts_path) = native_ts_out {
        let ts = emit_native_ts(&ir, Toolchain::Node)?;
        if let Some(parent) = native_ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(native_ts_path, &ts)?;
    }

    if let Some(wasm_ts_path) = wasm_ts_out {
        let ts = emit_native_ts(&ir, Toolchain::Wasm)?;
        if let Some(parent) = wasm_ts_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(wasm_ts_path, &ts)?;
    }

    if let Some(native_py_path) = native_py_out {
        let py = emit_native_py(&ir)?;
        if let Some(parent) = native_py_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(native_py_path, &py)?;
    }

    if let Some(py_stub_path) = py_stub_out {
        let pyi = emit_pyi_py(&ir)?;
        create_parent(py_stub_path)?;
        write_file(py_stub_path, &pyi)?;
    }

    if let Some(py_parity_path) = py_parity_out {
        let py = emit_parity_suite_py(&ir)?;
        if let Some(parent) = py_parity_path.parent() {
            fs::create_dir_all(parent).map_err(|source| GenError::Io {
                path: parent.to_path_buf(),
                source,
            })?;
        }
        write_file(py_parity_path, &py)?;
    }

    if let Some(native_rb_path) = native_rb_out {
        let ruby = emit_native_rb(&ir)?;
        create_parent(native_rb_path)?;
        write_file(native_rb_path, &ruby)?;
    }

    if let Some(rb_client_path) = rb_client_out {
        let ruby = emit_client_rb(&ir)?;
        create_parent(rb_client_path)?;
        write_file(rb_client_path, &ruby.client_rb)?;
        let parent = rb_client_path.parent().ok_or_else(|| {
            GenError::Parse("--rb-client-out must have a parent directory".into())
        })?;
        write_file(&parent.join("helpers.generated.rb"), &ruby.helpers_rb)?;
    }

    if let Some(rb_rbs_path) = rb_rbs_out {
        let rbs = emit_rbs_rb(&ir)?;
        create_parent(rb_rbs_path)?;
        write_file(rb_rbs_path, &rbs)?;
    }

    if let Some(rb_parity_path) = rb_parity_out {
        let ruby = emit_parity_suite_rb(&ir)?;
        create_parent(rb_parity_path)?;
        write_file(rb_parity_path, &ruby)?;
    }

    if let Some(rs_client_path) = rs_client_out {
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

    if let Some(rs_parity_path) = rs_parity_out {
        let rust = emit_parity_suite_rs(&ir)?;
        create_parent(rs_parity_path)?;
        write_file(rs_parity_path, &rust)?;
        rustfmt_files(&[rs_parity_path.to_path_buf()])?;
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
