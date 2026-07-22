//! OpenAPI snapshot + SDK contract manifest → `solvapay-dto` generator.

pub mod emit;
pub mod emit_bindings_rs;
pub mod emit_client_ts;
pub mod emit_parity_suite_ts;
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

pub use emit::{emit_crate, EmittedCrate};
pub use emit_bindings_rs::{emit_bindings, EmittedBindings, Toolchain};
pub use emit_client_ts::emit_client_ts;
pub use emit_parity_suite_ts::emit_parity_suite_ts;
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
