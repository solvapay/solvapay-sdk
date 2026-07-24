//! Shared `.env` loading for Rust examples under `examples/rust/`.

use std::path::{Path, PathBuf};

/// Path to `examples/rust/get-merchant/.env` (hardcoded relative to this crate).
pub fn get_merchant_dotenv_path() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../get-merchant/.env")
}

/// Load `KEY=value` pairs from a dotenv file into the process environment.
///
/// # Errors
///
/// Returns an error when the file cannot be read.
pub fn load_dotenv_from(path: &Path) -> Result<(), String> {
    let text =
        std::fs::read_to_string(path).map_err(|err| format!("read {}: {err}", path.display()))?;
    for line in text.lines() {
        let line = line.trim();
        if line.is_empty() || line.starts_with('#') {
            continue;
        }
        let Some((key, value)) = line.split_once('=') else {
            continue;
        };
        // SAFETY: example / local dev processes only.
        unsafe { std::env::set_var(key, value) };
    }
    Ok(())
}

/// Load [`get_merchant_dotenv_path`].
pub fn load_get_merchant_dotenv() -> Result<(), String> {
    load_dotenv_from(&get_merchant_dotenv_path())
}
