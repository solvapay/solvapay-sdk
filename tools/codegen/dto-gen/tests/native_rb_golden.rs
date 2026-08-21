//! Golden test for generated Ruby native dispatch.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::emit_native_rb;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::manifest::Manifest;

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

fn ir() -> Ir {
    let raw = fs::read_to_string(paths().contract_input("sdkManifest").expect("sdkManifest"))
        .expect("manifest");
    let manifest: Manifest = serde_norway::from_str(&raw).expect("parse manifest");
    let mut ir = Ir {
        types: Default::default(),
        overlay_helpers: Default::default(),
        overlays: Default::default(),
        routes: vec![],
        error_templates: IrErrorTemplates::default(),
        entry_points: Default::default(),
        binding_symbols: Default::default(),
        core_types: Default::default(),
        core_types_ts: Default::default(),
        core_fns: Default::default(),
        transport_fns: Default::default(),
    };
    let residue = dto_gen::load_binding_residue(
        &paths()
            .contract_input("bindingResidue")
            .expect("bindingResidue"),
    )
    .expect("residue");
    dto_gen::lower_all_bindings(
        &mut ir,
        &manifest,
        &paths().contract_input("coreSrc").expect("coreSrc"),
        &residue,
        Some(
            &paths()
                .contract_input("transportSrc")
                .expect("transportSrc"),
        ),
    )
    .expect("lower bindings");
    ir
}

#[test]
fn native_rb_matches_committed_and_is_deterministic() {
    let ir = ir();
    let first = emit_native_rb(&ir).expect("emit");
    let second = emit_native_rb(&ir).expect("emit twice");
    assert_eq!(first, second);
    let committed = fs::read_to_string(paths().generated_path("nativeRb").expect("nativeRb"))
        .expect("committed native ruby");
    assert_eq!(first, committed, "_native.rb drifted");
    assert_eq!(first.matches("\n      get_merchant\n").count(), 1);
    assert!(first.contains("def reconstruct_error"));
}
