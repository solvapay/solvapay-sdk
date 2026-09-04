//! Golden tests for `emit_crate` against committed `solvapay-dto` sources.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_crate;
use dto_gen::ir::IrOverlay;

fn dto_file(name: &str) -> String {
    fs::read_to_string(
        support::paths()
            .generated_path("rustDto")
            .expect("rustDto")
            .join(name),
    )
    .unwrap_or_else(|_| panic!("read {name}"))
}

#[test]
fn emit_crate_matches_committed_below_header() {
    let ir = support::lower_test_ir();
    let emitted = emit_crate(&ir).expect("emit_crate");
    for (name, source) in [
        ("lib.rs", emitted.lib_rs.as_str()),
        ("schemas.rs", emitted.schemas_rs.as_str()),
        ("routes.rs", emitted.routes_rs.as_str()),
        ("overlays.rs", emitted.overlays_rs.as_str()),
        ("error_templates.rs", emitted.error_templates_rs.as_str()),
    ] {
        assert!(
            source.contains("@generated"),
            "{name} missing @generated token"
        );
        assert_eq!(
            support::strip_generated_header(&support::rustfmt_source(source, name)),
            support::strip_generated_header(&dto_file(name)),
            "{name} drifted"
        );
    }
}

#[test]
fn emit_crate_mutated_overlay_changes_output() {
    let ir = support::lower_test_ir();
    let baseline = emit_crate(&ir).expect("emit");
    let mut mutated = ir;
    mutated.overlays.insert(
        "CodegenPerturbSentinel".into(),
        IrOverlay::Unit {
            name: "CodegenPerturbSentinel".into(),
            doc: "perturbation probe".into(),
        },
    );
    let perturbed = emit_crate(&mutated).expect("emit mutated");
    assert_ne!(
        baseline.overlays_rs, perturbed.overlays_rs,
        "mutated IR must change emitted overlays"
    );
}
