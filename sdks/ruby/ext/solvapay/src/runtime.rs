//! Binding-owned tokio multi-thread runtime + GVL release helper (Step 43).
//!
//! Ruby owns the main thread; the binding initializes a shared runtime for
//! blocking `block_on` client calls. HTTP waits run inside
//! `without_gvl_envelope` so other Ruby threads can progress (§7.5 / §15 note 3).

use std::ffi::c_void;
use std::mem::MaybeUninit;
use std::panic::AssertUnwindSafe;
use std::sync::OnceLock;

use rb_sys::rb_thread_call_without_gvl;
use tokio::runtime::Runtime;

/// Shared multi-thread tokio runtime (initialized once per process).
static RUNTIME: OnceLock<Runtime> = OnceLock::new();

/// Initializes the shared multi-thread tokio runtime (idempotent).
///
/// Called from `#[magnus::init]` so the first blocking client call has a
/// runtime ready.
pub fn init() {
    let _ = get_runtime();
}

/// Returns the shared runtime used by GVL-releasing blocking client methods.
pub fn get_runtime() -> &'static Runtime {
    RUNTIME.get_or_init(|| {
        match tokio::runtime::Builder::new_multi_thread()
            .enable_all()
            .build()
        {
            Ok(rt) => rt,
            // Binding bootstrap failure — abort rather than poison OnceLock.
            Err(_) => std::process::abort(),
        }
    })
}

/// C trampoline for [`rb_thread_call_without_gvl`]: runs the boxed closure.
///
/// # Safety
///
/// `arg` must point at a live `(Option<F>, MaybeUninit<Result<R>>)` pair.
unsafe extern "C" fn call_trampoline<F, R>(arg: *mut c_void) -> *mut c_void
where
    F: FnOnce() -> R,
{
    // SAFETY: `arg` is the `(Option<F>, MaybeUninit<Result<R>>)` pair allocated
    // on the caller stack in [`call_without_gvl`].
    let data = unsafe { &mut *(arg as *mut (Option<F>, MaybeUninit<std::thread::Result<R>>)) };
    if let Some(func) = data.0.take() {
        data.1
            .write(std::panic::catch_unwind(AssertUnwindSafe(func)));
    }
    std::ptr::null_mut()
}

/// Runs `func` with the Ruby GVL released (`rb_thread_call_without_gvl`).
fn call_without_gvl<F, R>(func: F) -> std::thread::Result<R>
where
    F: FnOnce() -> R,
{
    let mut data: (Option<F>, MaybeUninit<std::thread::Result<R>>) =
        (Some(func), MaybeUninit::uninit());
    let arg = std::ptr::from_mut(&mut data).cast::<c_void>();

    // SAFETY: trampoline only runs while `data` is live on this stack; Ruby
    // re-acquires the GVL before returning.
    unsafe {
        rb_thread_call_without_gvl(
            Some(call_trampoline::<F, R>),
            arg,
            None,
            std::ptr::null_mut(),
        );
    }

    // SAFETY: trampoline wrote the `catch_unwind` result before returning.
    unsafe { data.1.assume_init() }
}

/// Runs `func` with the GVL released and maps a panic to a Transport envelope.
///
/// Magnus ≥0.8 raises an uncatchable `fatal` if a panic reaches its boundary.
/// Client methods must convert here so Ruby sees a language-level error.
pub fn without_gvl_envelope<F>(func: F) -> String
where
    F: FnOnce() -> String,
{
    match call_without_gvl(func) {
        Ok(value) => value,
        Err(payload) => crate::error::envelope_from_panic_payload(payload),
    }
}
