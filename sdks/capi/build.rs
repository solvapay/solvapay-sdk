//! Regenerates the committed `include/solvapay.h` via cbindgen.

use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=src/fixture_host.rs");
    println!("cargo:rerun-if-changed=cbindgen.toml");
    println!("cargo:rerun-if-changed=cbindgen.fixture-host.toml");
    println!("cargo:rerun-if-changed=include/solvapay.h");
    println!("cargo:rerun-if-changed=include/solvapay_fixture_host.h");

    generate_header(
        &crate_dir,
        "cbindgen.toml",
        "include/solvapay.h",
        "cbindgen generate error",
    );

    if env::var_os("CARGO_FEATURE_FIXTURE_HOST").is_some() {
        generate_header(
            &crate_dir,
            "cbindgen.fixture-host.toml",
            "include/solvapay_fixture_host.h",
            "cbindgen fixture-host generate error",
        );
    }
}

/// Writes one cbindgen header from `config_name` into `header_rel`.
///
/// # Arguments
///
/// * `crate_dir` - `solvapay-c` crate root (contains cbindgen configs and `include/`).
/// * `config_name` - cbindgen TOML file name relative to `crate_dir`.
/// * `header_rel` - Output header path relative to `crate_dir`.
/// * `err_label` - Prefix for generate-failure stderr.
fn generate_header(
    crate_dir: &std::path::Path,
    config_name: &str,
    header_rel: &str,
    err_label: &str,
) {
    let config_path = crate_dir.join(config_name);
    let header_path = crate_dir.join(header_rel);
    let config = match cbindgen::Config::from_file(&config_path) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("cbindgen config error ({config_name}): {err}");
            std::process::exit(1);
        }
    };

    match cbindgen::Builder::new()
        .with_crate(crate_dir)
        .with_config(config)
        .generate()
    {
        Ok(bindings) => {
            let _changed = bindings.write_to_file(&header_path);
        }
        Err(err) => {
            eprintln!("{err_label}: {err}");
            std::process::exit(1);
        }
    }
}
