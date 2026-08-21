//! Golden tests for generated Ruby client, helpers, and RBS.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{emit_client_rb, emit_rbs_rb, lower_catalog, Manifest};

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
    lower_catalog(&mut ir, &manifest).expect("lower catalog");
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
fn public_client_helpers_and_rbs_match_committed() {
    let ir = ir();
    let emitted = emit_client_rb(&ir).expect("emit Ruby public");
    assert_eq!(
        emitted.client_rb,
        fs::read_to_string(paths().generated_path("rbClient").expect("rbClient")).expect("client")
    );
    assert_eq!(
        emitted.helpers_rb,
        fs::read_to_string(paths().generated_path("rubyHelpers").expect("rubyHelpers"))
            .expect("helpers")
    );
    let rbs = emit_rbs_rb(&ir).expect("emit RBS");
    assert_eq!(
        rbs,
        fs::read_to_string(paths().generated_path("rbRbs").expect("rbRbs")).expect("RBS")
    );
    assert_eq!(emitted.client_rb.matches("    def ").count(), 37);
    assert!(!rbs.contains("SolvaPay::Native"));
}
