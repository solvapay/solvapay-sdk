//! Golden test for generated Rust signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::io::Write;
use std::process::Command;

use dto_gen::emit_parity_suite_rs;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{lower_catalog, Manifest};

fn paths() -> repo_paths::RepoPaths {
    repo_paths::load().expect("repo-paths")
}

fn ir() -> Ir {
    let raw = fs::read_to_string(paths().contract_input("sdkManifest").expect("sdkManifest"))
        .expect("manifest");
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

fn rustfmt(source: &str) -> String {
    let mut path = std::env::temp_dir();
    path.push(format!("dto_gen_rs_parity_{}.rs", std::process::id()));
    {
        let mut f = fs::File::create(&path).expect("create temp");
        f.write_all(source.as_bytes()).expect("write temp");
    }
    let status = Command::new("rustfmt")
        .arg("--edition=2021")
        .arg(&path)
        .status()
        .expect("spawn rustfmt");
    assert!(status.success(), "rustfmt failed");
    let out = fs::read_to_string(&path).expect("read temp");
    let _ = fs::remove_file(&path);
    out
}

#[test]
fn rust_parity_matches_committed_and_has_real_defaults() {
    let ir = ir();
    let emitted = emit_parity_suite_rs(&ir).expect("emit parity");
    let committed = fs::read_to_string(paths().generated_path("rsParity").expect("rsParity"))
        .expect("committed parity");
    assert_eq!(rustfmt(&emitted), committed);
    assert!(emitted.contains("assert_eq!(OPERATION_SIGNATURES.len(), 36)"));
    assert!(emitted.contains("_assert_typed_surface"));
    assert!(emitted.contains("_parity_sink"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("or true"));
}
