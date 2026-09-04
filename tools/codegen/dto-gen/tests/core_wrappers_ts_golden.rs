//! Golden: generated core/server dispatch wrappers match committed files
//! below the `@generated` header (Phase 3c / 3d).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;
use std::path::Path;

use dto_gen::emit_core_wrappers_ts::{emit_core_wrappers_ts, CoreWrapperKind};

fn assert_matches(emitted: &str, committed_path: &Path, tag: &str) {
    let committed = fs::read_to_string(committed_path)
        .unwrap_or_else(|e| panic!("read committed {}: {e}", committed_path.display()));
    let got = support::strip_generated_header(emitted);
    let want = support::strip_generated_header(&committed);
    if got != want {
        let g: Vec<&str> = got.lines().collect();
        let w: Vec<&str> = want.lines().collect();
        let mut first = 0;
        while first < g.len() && first < w.len() && g[first] == w[first] {
            first += 1;
        }
        let ctx = |v: &[&str]| {
            let start = first.saturating_sub(2);
            let end = (first + 6).min(v.len());
            v[start..end].join("\n")
        };
        panic!(
            "emitted {tag} does not match committed at line ~{first}\n--- emitted ---\n{}\n--- committed ---\n{}",
            ctx(&g),
            ctx(&w)
        );
    }
}

#[test]
fn core_dispatch_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::Dispatch).expect("emit");
    assert_matches(
        &emitted,
        &support::paths()
            .generated_path("coreDispatchTs")
            .expect("coreDispatchTs"),
        "native-dispatch.ts",
    );
}

#[test]
fn core_native_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeCore).expect("emit");
    assert_matches(
        &emitted,
        &support::paths()
            .generated_path("coreNativeTs")
            .expect("coreNativeTs"),
        "native-core.ts",
    );
}

#[test]
fn core_helpers_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeHelpers).expect("emit");
    assert_matches(
        &emitted,
        &support::paths()
            .generated_path("coreHelpersTs")
            .expect("coreHelpersTs"),
        "native-helpers.ts",
    );
}

#[test]
fn server_decisions_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeDecisions).expect("emit");
    assert_matches(
        &emitted,
        &support::paths()
            .generated_path("serverDecisionsTs")
            .expect("serverDecisionsTs"),
        "native-decisions.ts",
    );
}
