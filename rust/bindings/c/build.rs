//! Regenerates the committed `include/solvapay.h` via cbindgen.

use std::env;
use std::path::PathBuf;

fn main() {
    let crate_dir = PathBuf::from(env::var("CARGO_MANIFEST_DIR").unwrap_or_else(|_| ".".into()));
    let config_path = crate_dir.join("cbindgen.toml");
    let header_path = crate_dir.join("include/solvapay.h");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=cbindgen.toml");
    println!("cargo:rerun-if-changed=include/solvapay.h");

    let config = match cbindgen::Config::from_file(&config_path) {
        Ok(cfg) => cfg,
        Err(err) => {
            eprintln!("cbindgen config error: {err}");
            std::process::exit(1);
        }
    };

    match cbindgen::Builder::new()
        .with_crate(&crate_dir)
        .with_config(config)
        .generate()
    {
        Ok(bindings) => {
            // Returns true when the file changed, false when already up to date.
            let _changed = bindings.write_to_file(&header_path);
        }
        Err(err) => {
            eprintln!("cbindgen generate error: {err}");
            std::process::exit(1);
        }
    }
}
