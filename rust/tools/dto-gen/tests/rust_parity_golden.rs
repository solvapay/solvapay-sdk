//! Golden test for generated Rust signature parity.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::Command;

use dto_gen::emit_parity_suite_rs;
use dto_gen::ir::{Ir, IrErrorTemplates};
use dto_gen::{lower_bindings, lower_catalog, Manifest};

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
    let committed =
        fs::read_to_string(root().join("rust/crates/solvapay/tests/signature_parity_generated.rs"))
            .expect("committed parity");
    assert_eq!(rustfmt(&emitted), committed);
    assert!(emitted.contains("assert_eq!(OPERATION_SIGNATURES.len(), 36)"));
    assert!(!emitted.contains("2 == 2"));
    assert!(!emitted.contains("or true"));
}
