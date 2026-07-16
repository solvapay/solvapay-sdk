//! Pure SolvaPay SDK logic.
//!
//! Dependency discipline (§4.3): `serde`, `hmac`/`sha2`, `subtle` only.
//! No HTTP, no tokio, no wasm-bindgen. Public API lands in steps 9+.

// Keep allowed deps linked so the wasm32 graph stays honest from step 8.
#[allow(unused_imports)]
use hmac as _;
#[allow(unused_imports)]
use serde as _;
#[allow(unused_imports)]
use sha2 as _;
#[allow(unused_imports)]
use subtle as _;
