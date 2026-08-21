//! Golden test: emitted Python signature-parity suite matches committed output
//! (Step 41-e).

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;

use dto_gen::emit_parity_suite_py::emit_parity_suite_py;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::lower_catalog::lower_catalog;
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
    lower_catalog(&mut ir, &manifest).expect("lower catalog");
    ir
}

fn strip_generated_header(src: &str) -> String {
    let mut lines = src.lines();
    if let Some(first) = lines.next() {
        if first.contains("@generated") {
            let rest: Vec<&str> = lines.collect();
            return rest.join("\n").trim_start_matches('\n').to_string();
        }
    }
    src.to_string()
}

#[test]
fn python_parity_suite_matches_committed() {
    let ir = lower_ir();
    let emitted = emit_parity_suite_py(&ir).expect("emit py parity");
    let path = paths().generated_path("pyParity").expect("pyParity");
    let committed = fs::read_to_string(&path).expect("read committed parity suite");
    assert_eq!(
        strip_generated_header(&emitted),
        strip_generated_header(&committed),
        "python parity suite drifted — regenerate with --py-parity-out"
    );
    assert!(emitted.contains("check_limits"));
    assert!(emitted.contains("10000"));
    assert!(!emitted.contains("or True"));
    assert!(!emitted.contains("2 == 2"));
}
