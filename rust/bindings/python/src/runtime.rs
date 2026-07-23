//! Binding-owned tokio multi-thread runtime via `pyo3-async-runtimes` (Step 40).
//!
//! Python owns the main thread; the binding initializes a shared runtime for
//! `future_into_py` and blocking `block_on` twins (§7.5 / §15 note 2).

/// Initializes the shared multi-thread tokio runtime (idempotent).
///
/// Called from `#[pymodule]` so the first async / blocking client call has a
/// runtime ready. Uses `pyo3-async-runtimes`'s once-init so `future_into_py`
/// and [`get_runtime`] share the same executor.
pub fn init() {
    let mut builder = tokio::runtime::Builder::new_multi_thread();
    builder.enable_all();
    pyo3_async_runtimes::tokio::init(builder);
}

/// Returns the shared runtime handle used by async + blocking twins.
pub fn get_runtime() -> &'static tokio::runtime::Runtime {
    pyo3_async_runtimes::tokio::get_runtime()
}
