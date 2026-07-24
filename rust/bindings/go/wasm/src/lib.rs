//! `solvapay-go-wasm`: the `wasm32-wasip1` guest compiled into the wazero (Go)
//! binding (Step 49).
//!
//! The guest embeds `solvapay-core` (server feature) + `solvapay-transport` and
//! exposes a tiny C ABI over linear memory:
//!
//! - `sv_alloc(len) -> *mut u8` / `sv_dealloc(ptr, len)` — guest heap ownership.
//! - Every exported call takes an `(args_ptr, args_len)` pair addressing a
//!   UTF-8 JSON args string and returns a packed `(ptr << 32) | len` handle to
//!   a JSON envelope string the host reads and then frees with `sv_dealloc`.
//! - HTTP is delegated to the host via the `solvapay_host::transport_send`
//!   import (see [`host_transport`]); there is no Fetch/reqwest in the guest.
//!
//! # Panic safety
//!
//! The `wasm-release` profile sets `panic = "abort"`, so recoverable unwinding
//! is unavailable across the host boundary. The envelope helpers only map
//! `Result`; Clippy `unwrap_used` / `expect_used` / `panic` denies are the
//! primary safety mechanism (§7.6).
//!
//! Everything is gated on `target_arch = "wasm32"` so a host workspace build
//! (`cargo build` / `clippy` / `test`) compiles this crate to an empty library
//! rather than trying to link the WASI host imports.

#![allow(clippy::result_large_err)]

#[cfg(target_arch = "wasm32")]
mod abi;
#[cfg(target_arch = "wasm32")]
mod args;
#[cfg(target_arch = "wasm32")]
mod client;
#[cfg(target_arch = "wasm32")]
mod error;
#[cfg(target_arch = "wasm32")]
mod host_transport;
#[cfg(target_arch = "wasm32")]
mod webhook;

/// Returns the crate version string (`CARGO_PKG_VERSION`) as a packed handle.
///
/// Hello-world smoke export proving the module instantiates under wazero. The
/// value is a plain UTF-8 string (not an envelope) — `Version()` on the Go side
/// returns it verbatim.
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn sv_version() -> u64 {
    abi::pack(env!("CARGO_PKG_VERSION").to_owned())
}
