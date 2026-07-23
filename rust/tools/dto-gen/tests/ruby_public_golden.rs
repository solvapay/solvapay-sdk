//! Golden tests for generated Ruby client, helpers, and RBS.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::{Path, PathBuf};

use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{emit_client_rb, emit_rbs_rb, lower_bindings, lower_catalog, Manifest};

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
fn public_client_helpers_and_rbs_match_committed() {
    let ir = ir();
    let emitted = emit_client_rb(&ir).expect("emit Ruby public");
    assert_eq!(
        emitted.client_rb,
        fs::read_to_string(root().join("rust/bindings/ruby/lib/solvapay/client.rb"))
            .expect("client")
    );
    assert_eq!(
        emitted.helpers_rb,
        fs::read_to_string(root().join("rust/bindings/ruby/lib/solvapay/helpers.generated.rb"))
            .expect("helpers")
    );
    let rbs = emit_rbs_rb(&ir).expect("emit RBS");
    assert_eq!(
        rbs,
        fs::read_to_string(root().join("rust/bindings/ruby/sig/solvapay.rbs")).expect("RBS")
    );
    assert_eq!(emitted.client_rb.matches("    def ").count(), 37);
    assert!(!rbs.contains("SolvaPay::Native"));
}
