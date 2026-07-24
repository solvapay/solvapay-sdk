//! Golden test for generated Go signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{emit_parity_suite_go, lower_bindings, lower_catalog, Manifest};

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
    lower_catalog(&mut ir, &manifest).expect("lower catalog");
    lower_bindings(&mut ir, &manifest).expect("lower bindings");
    ir
}

#[test]
fn go_parity_matches_committed_and_has_real_defaults() {
    let ir = ir();
    let emitted = emit_parity_suite_go(&ir).expect("emit parity");
    let committed = fs::read_to_string(
        root().join("rust/bindings/go/signature_parity_generated_test.go"),
    )
    .expect("committed parity");
    assert_eq!(emitted, committed);
    assert!(emitted.contains("len(operationSignatures); got != 36"));
    assert!(emitted.contains("expectedLimitsCacheTTLMs = 10000"));
    assert!(emitted.contains("expectedMaxRetries = 2"));
    assert!(emitted.contains("expectedInitialDelayMs = 500"));
    assert!(emitted.contains("_ = (*solvapay.Client).CheckLimits"));
    assert!(emitted.contains("TestSyncOnlyMatrix"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("|| true"));
}
