//! Golden test: emitted native.ts / wasm.ts must match the committed
//! marshalling glue once headers are normalized (step 39G-c).
//!
//! Lowers the real contract manifest into IR, emits both toolchains, and
//! compares against the committed files after stripping leading JSDoc
//! blocks (the only sanctioned diff is the `@generated` header).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::emit_bindings_rs::Toolchain;
use dto_gen::emit_bindings_ts::emit_native_ts;
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

/// Drops every leading `/** … */` JSDoc block (and blank lines immediately
/// following each). Used so the `@generated` header is ignored on both sides.
fn strip_leading_jsdocs(src: &str) -> String {
    let mut rest = src;
    loop {
        let trimmed = rest.trim_start_matches([' ', '\t', '\n', '\r']);
        if !trimmed.starts_with("/**") {
            return trimmed.to_string();
        }
        let close = trimmed
            .find("*/")
            .unwrap_or_else(|| panic!("unterminated JSDoc in golden input"));
        rest = &trimmed[close + 2..];
    }
}

fn assert_matches(emitted: &str, committed_path: &Path, tag: &str) {
    let committed = fs::read_to_string(committed_path)
        .unwrap_or_else(|e| panic!("read committed {}: {e}", committed_path.display()));
    let got = strip_leading_jsdocs(emitted);
    let want = strip_leading_jsdocs(&committed);
    if got != want {
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
fn native_ts_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_native_ts(&ir, Toolchain::Node).expect("emit native.ts");
    assert_matches(
        &emitted,
        &repo_root().join("packages/server/src/native.ts"),
        "native.ts",
    );
}

#[test]
fn wasm_ts_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_native_ts(&ir, Toolchain::Wasm).expect("emit wasm.ts");
    assert_matches(
        &emitted,
        &repo_root().join("packages/server/src/wasm.ts"),
        "wasm.ts",
    );
}
