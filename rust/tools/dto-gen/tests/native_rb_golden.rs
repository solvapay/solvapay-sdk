//! Golden test for generated Ruby native dispatch.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::emit_native_rb;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::lower_bindings;
use dto_gen::manifest::Manifest;

fn root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(3)
        .expect("repo root")
        .to_path_buf()
}

fn ir() -> Ir {
    let raw =
        fs::read_to_string(root().join("contract/manifest/sdk-contract.yaml")).expect("manifest");
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

#[test]
fn native_rb_matches_committed_and_is_deterministic() {
    let ir = ir();
    let first = emit_native_rb(&ir).expect("emit");
    let second = emit_native_rb(&ir).expect("emit twice");
    assert_eq!(first, second);
    let committed = fs::read_to_string(root().join("rust/bindings/ruby/lib/solvapay/_native.rb"))
        .expect("committed native ruby");
    assert_eq!(first, committed, "_native.rb drifted");
    assert_eq!(first.matches("\n      get_merchant\n").count(), 1);
    assert!(first.contains("def reconstruct_error"));
}
