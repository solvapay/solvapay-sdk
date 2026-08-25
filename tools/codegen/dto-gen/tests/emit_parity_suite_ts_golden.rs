//! Golden tests for `emit_parity_suite_ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_parity_suite_ts;

#[test]
fn emit_parity_suite_ts_matches_committed_below_header() {
    let ir = support::lower_test_ir();
    let emitted = emit_parity_suite_ts(&ir).expect("emit ts parity");
    let committed = fs::read_to_string(
        support::paths()
            .generated_path("tsParity")
            .expect("tsParity"),
    )
    .expect("committed parity");
    assert!(emitted.contains("@generated"));
    assert_eq!(
        support::strip_generated_header(&emitted),
        support::strip_generated_header(&committed)
    );
}

#[test]
fn emit_parity_suite_ts_mutated_defaults_change_output() {
    let ir = support::lower_test_ir();
    let baseline = emit_parity_suite_ts(&ir).expect("emit");
    let mut mutated = ir;
    let entry = mutated
        .entry_points
        .values_mut()
        .next()
        .expect("entry point");
    entry.defaults.max_retries = entry.defaults.max_retries.saturating_add(1);
    let perturbed = emit_parity_suite_ts(&mutated).expect("emit mutated");
    assert_ne!(baseline, perturbed);
}
