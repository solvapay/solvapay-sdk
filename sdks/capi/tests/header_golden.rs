//! cbindgen header drift gate — regenerated output must match committed `include/solvapay.h`.

#![allow(clippy::unwrap_used, clippy::expect_used, clippy::panic)]

use std::path::PathBuf;

fn crate_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

fn strip_banner(header: &str) -> &str {
    // Compare below the autogen warning line so minor banner wording can evolve
    // without failing the golden — still require `@generated` presence.
    assert!(
        header.contains("@generated"),
        "committed header must contain @generated"
    );
    if let Some(idx) = header.find("#include") {
        &header[idx..]
    } else {
        header
    }
}

#[test]
fn cbindgen_header_matches_committed() {
    let crate_dir = crate_dir();
    let config =
        cbindgen::Config::from_file(crate_dir.join("cbindgen.toml")).expect("load cbindgen.toml");
    let bindings = cbindgen::Builder::new()
        .with_crate(&crate_dir)
        .with_config(config)
        .generate()
        .expect("cbindgen generate");
    let mut generated = Vec::new();
    bindings.write(&mut generated);
    let generated = String::from_utf8(generated).expect("utf-8 header");

    let committed =
        std::fs::read_to_string(crate_dir.join("include/solvapay.h")).expect("read solvapay.h");

    assert_eq!(
        strip_banner(&generated),
        strip_banner(&committed),
        "include/solvapay.h is stale — run: cargo build -p solvapay-c"
    );
}
