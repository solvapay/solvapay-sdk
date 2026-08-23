//! Golden test for generated Go signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{emit_parity_suite_go, lower_catalog, Manifest};

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
fn go_parity_matches_committed_and_has_real_defaults() {
    let ir = ir();
    let emitted = emit_parity_suite_go(&ir).expect("emit parity");
    let committed = fs::read_to_string(paths().generated_path("goParity").expect("goParity"))
        .expect("committed parity");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("len(operationSignatures); got != 36"));
    assert!(emitted.contains("expectedLimitsCacheTTLMs = 10000"));
    assert!(emitted.contains("expectedMaxRetries = 2"));
    assert!(emitted.contains("expectedInitialDelayMs = 500"));
    assert!(emitted.contains("_ = (*solvapay.Client).CheckLimits"));
    assert!(emitted.contains("TestSyncOnlyMatrix"));
    assert!(emitted.contains("paramTypes"));
    assert!(emitted.contains("TestExportedClientMethodsMatchCensus"));
    assert!(emitted.contains("map[string]interface {}"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("|| true"));
}
