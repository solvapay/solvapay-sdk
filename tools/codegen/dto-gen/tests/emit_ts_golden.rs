//! Golden tests for `emit_overlays_ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_overlays_ts;
use dto_gen::ir::IrOverlay;

#[test]
fn emit_overlays_ts_matches_committed_below_header() {
    let ir = support::lower_test_ir();
    let emitted = emit_overlays_ts(&ir).expect("emit ts");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("tsOverlays")
            .expect("tsOverlays"),
    )
    .expect("committed overlays");
    assert!(emitted.contains("@generated"));
    assert_eq!(
        support::strip_generated_header(&emitted),
        support::strip_generated_header(&committed)
    );
}

#[test]
fn emit_overlays_ts_mutated_overlay_changes_output() {
    let ir = support::lower_test_ir();
    let baseline = emit_overlays_ts(&ir).expect("emit");
    let mut mutated = ir;
    mutated.overlays.insert(
        "CodegenPerturbSentinel".into(),
        IrOverlay::Unit {
            name: "CodegenPerturbSentinel".into(),
            doc: "perturbation probe".into(),
        },
    );
    let perturbed = emit_overlays_ts(&mutated).expect("emit mutated");
    assert_ne!(baseline, perturbed);
}
