//! Golden: generated core/server dispatch wrappers match committed files
//! below the `@generated` header (Phase 3c / 3d).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::path::Path;

use dto_gen::emit_core_wrappers_ts::{emit_core_wrappers_ts, CoreWrapperKind};
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::manifest::Manifest;

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

fn lower_ir() -> Ir {
    let manifest_path = paths().contract_input("sdkManifest").expect("sdkManifest");
    let raw = fs::read_to_string(&manifest_path).expect("read manifest");
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

fn strip_leading_jsdocs(src: &str) -> String {
    let mut rest = src;
    loop {
        let trimmed = rest.trim_start_matches([' ', '\t', '\n', '\r']);
        if !trimmed.starts_with("/**") {
            return trimmed.to_string();
        }
        let close = trimmed
            .find("*/")
            .unwrap_or_else(|| panic!("unterminated JSDoc in golden input"));
        rest = &trimmed[close + 2..];
    }
}

fn assert_matches(emitted: &str, committed_path: &Path, tag: &str) {
    let committed = fs::read_to_string(committed_path)
        .unwrap_or_else(|e| panic!("read committed {}: {e}", committed_path.display()));
    let got = strip_leading_jsdocs(emitted);
    let want = strip_leading_jsdocs(&committed);
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
    let ir = lower_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::Dispatch).expect("emit");
    assert_matches(
        &emitted,
        &paths()
            .generated_path("coreDispatchTs")
            .expect("coreDispatchTs"),
        "native-dispatch.ts",
    );
}

#[test]
fn core_native_ts_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeCore).expect("emit");
    assert_matches(
        &emitted,
        &paths()
            .generated_path("coreNativeTs")
            .expect("coreNativeTs"),
        "native-core.ts",
    );
}

#[test]
fn core_helpers_ts_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeHelpers).expect("emit");
    assert_matches(
        &emitted,
        &paths()
            .generated_path("coreHelpersTs")
            .expect("coreHelpersTs"),
        "native-helpers.ts",
    );
}

#[test]
fn server_decisions_ts_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_core_wrappers_ts(&ir, CoreWrapperKind::NativeDecisions).expect("emit");
    assert_matches(
        &emitted,
        &paths()
            .generated_path("serverDecisionsTs")
            .expect("serverDecisionsTs"),
        "native-decisions.ts",
    );
}
