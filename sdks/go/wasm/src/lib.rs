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
mod decisions;
#[cfg(target_arch = "wasm32")]
mod error;
#[cfg(target_arch = "wasm32")]
mod fixture_host;
#[cfg(target_arch = "wasm32")]
mod host_transport;
#[cfg(target_arch = "wasm32")]
mod mcp;
#[cfg(target_arch = "wasm32")]
mod payload_builders;
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

/// Returns `{version, coreSha}` JSON as a packed handle (not an envelope).
#[cfg(target_arch = "wasm32")]
#[no_mangle]
pub extern "C" fn sv_build_info() -> u64 {
    let version = option_env!("SOLVAPAY_RELEASE_VERSION").unwrap_or(env!("CARGO_PKG_VERSION"));
    let core_sha = option_env!("SOLVAPAY_CORE_SHA").unwrap_or("unknown");
    abi::pack(format!(
        r#"{{"version":"{version}","coreSha":"{core_sha}"}}"#
    ))
}

/// Debug-only panicking export. wasm32 `panic = "abort"` traps the instance;
/// wazero surfaces that as a host error rather than aborting the Go process.
#[cfg(all(target_arch = "wasm32", feature = "panic-probe"))]
#[no_mangle]
pub extern "C" fn sv_panic_probe() -> u64 {
    #[allow(clippy::panic)]
    {
        panic!("SOLVAPAY_PANIC_PROBE");
    }
}
