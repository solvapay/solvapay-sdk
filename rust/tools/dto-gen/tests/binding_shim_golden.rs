//! Golden test: emitted shim files must match the committed napi / wasm-bindgen
//! bindings once headers are normalized (step 39G-b).
//!
//! Lowers the real contract manifest into IR, emits both toolchains, runs the
//! emitted strings through `rustfmt` exactly like `dto-gen` does on write, and
//! compares against the committed files after stripping the leading `//!`
//! module-doc block (the only sanctioned diff is the `@generated` header).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use dto_gen::emit_bindings_rs::{emit_bindings, Toolchain};
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::lower_bindings::lower_bindings;
use dto_gen::manifest::Manifest;

fn repo_root() -> PathBuf {
    // CARGO_MANIFEST_DIR = <repo>/rust/tools/dto-gen
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf()
}

fn lower_ir() -> Ir {
    let manifest_path = repo_root().join("contract/manifest/sdk-contract.yaml");
    let raw = fs::read_to_string(&manifest_path).expect("read manifest");
    let manifest: Manifest = serde_norway::from_str(&raw).expect("parse manifest");
    let mut ir = Ir {
        types: Default::default(),
        overlay_helpers: Default::default(),
        overlays: Default::default(),
        routes: vec![],
        error_templates: IrErrorTemplates::default(),
        entry_points: Default::default(),
        binding_symbols: Default::default(),
    };
    lower_bindings(&mut ir, &manifest).expect("lower bindings");
    ir
}

/// Formats a Rust source string with rustfmt (same edition dto-gen uses).
fn rustfmt(source: &str, tag: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(format!("dto_gen_golden_{}_{}.rs", std::process::id(), tag));
    {
        let mut f = fs::File::create(&path).expect("create temp");
        f.write_all(source.as_bytes()).expect("write temp");
    }
    let status = Command::new("rustfmt")
        .arg("--edition=2021")
        .arg(&path)
        .status()
        .expect("spawn rustfmt");
    assert!(status.success(), "rustfmt failed for {tag}");
    let out = fs::read_to_string(&path).expect("read temp");
    let _ = fs::remove_file(&path);
    out
}

/// Drops the leading contiguous `//!` module-doc block (and any blank lines
/// immediately trailing it is preserved as a boundary marker).
fn strip_module_doc(src: &str) -> String {
    let mut lines = src.lines();
    let mut rest: Vec<&str> = Vec::new();
    let mut in_header = true;
    for line in lines.by_ref() {
        if in_header && line.trim_start().starts_with("//!") {
            continue;
        }
        in_header = false;
        rest.push(line);
    }
    rest.join("\n").trim_start().to_string()
}

fn assert_matches(emitted: &str, committed_path: &Path, tag: &str) {
    let committed = fs::read_to_string(committed_path)
        .unwrap_or_else(|e| panic!("read committed {}: {e}", committed_path.display()));
    let formatted = rustfmt(emitted, tag);
    let got = strip_module_doc(&formatted);
    let want = strip_module_doc(&committed);
    if got != want {
        // Surface the first differing line for a readable failure.
        let g: Vec<&str> = got.lines().collect();
        let w: Vec<&str> = want.lines().collect();
        let mut first = 0;
        while first < g.len() && first < w.len() && g[first] == w[first] {
            first += 1;
        }
        let ctx = |v: &[&str]| {
            let start = first.saturating_sub(2);
            let end = (first + 4).min(v.len());
            v[start..end].join("\n")
        };
        panic!(
            "emitted {tag} does not match committed at line ~{first}\n--- emitted ---\n{}\n--- committed ---\n{}",
            ctx(&g),
            ctx(&w)
        );
    }
}

#[test]
fn node_shims_match_committed() {
    let ir = lower_ir();
    let node = emit_bindings(&ir, Toolchain::Node).expect("emit node");
    let base = repo_root().join("rust/bindings/node/src");
    assert_matches(&node.args_rs, &base.join("args.rs"), "node_args");
    assert_matches(
        &node.decisions_rs,
        &base.join("decisions.rs"),
        "node_decisions",
    );
    assert_matches(
        &node.payload_builders_rs,
        &base.join("payload_builders.rs"),
        "node_payload",
    );
    assert_matches(
        &node.client_rs,
        &base.join("native_client.rs"),
        "node_client",
    );
}

#[test]
fn wasm_shims_match_committed() {
    let ir = lower_ir();
    let wasm = emit_bindings(&ir, Toolchain::Wasm).expect("emit wasm");
    let base = repo_root().join("rust/bindings/wasm/src");
    assert_matches(&wasm.args_rs, &base.join("args.rs"), "wasm_args");
    assert_matches(
        &wasm.decisions_rs,
        &base.join("decisions.rs"),
        "wasm_decisions",
    );
    assert_matches(
        &wasm.payload_builders_rs,
        &base.join("payload_builders.rs"),
        "wasm_payload",
    );
    assert_matches(&wasm.client_rs, &base.join("wasm_client.rs"), "wasm_client");
}
