//! Golden tests for `emit_client_ts`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;

use dto_gen::emit_client_ts;

#[test]
fn emit_client_ts_matches_committed_below_header() {
    let ir = support::lower_test_ir();
    let emitted = emit_client_ts(&ir).expect("emit client ts");
    let committed = fs::read_to_string(support::paths().generated_path("tsClient").expect("tsClient"))
        .expect("committed client");
    assert!(emitted.contains("@generated"));
    assert_eq!(
        support::strip_generated_header(&emitted),
        support::strip_generated_header(&committed)
    );
}

#[test]
fn emit_client_ts_mutated_docs_change_output() {
    let ir = support::lower_test_ir();
    let baseline = emit_client_ts(&ir).expect("emit");
    let mut mutated = ir;
    let entry = mutated
        .entry_points
        .get_mut("checkLimits")
        .expect("checkLimits");
    entry.docs.summary.push_str(" PERTURB");
    let perturbed = emit_client_ts(&mutated).expect("emit mutated");
    assert_ne!(baseline, perturbed);
}
