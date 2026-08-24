//! Golden test: emitted native.ts / wasm.ts must match the committed
//! marshalling glue once headers are normalized (step 39G-c).
//!
//! Lowers the real contract manifest into IR, emits both toolchains, and
//! compares against the committed files after stripping leading JSDoc
//! blocks (the only sanctioned diff is the `@generated` header).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

mod support;

use std::fs;
use std::path::Path;

use dto_gen::emit_bindings_rs::Toolchain;
use dto_gen::emit_bindings_ts::emit_native_ts;





/// Drops every leading `/** … */` JSDoc block (and blank lines immediately
/// following each). Used so the `@generated` header is ignored on both sides.


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
            let end = (first + 4).min(v.len());
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
fn native_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_native_ts(&ir, Toolchain::Node).expect("emit native.ts");
    assert_matches(
        &emitted,
        &support::paths().generated_path("nativeTs").expect("nativeTs"),
        "native.ts",
    );
}

#[test]
fn wasm_ts_matches_committed() {
    let ir = support::lower_bindings_ir();
    let emitted = emit_native_ts(&ir, Toolchain::Wasm).expect("emit wasm.ts");
    assert_matches(
        &emitted,
        &support::paths().generated_path("wasmTs").expect("wasmTs"),
        "wasm.ts",
    );
}
