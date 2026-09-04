//! Guest-memory ABI: `sv_alloc` / `sv_dealloc` plus packed `(ptr << 32) | len`
//! return values and the string read/pack helpers shared by every export.
//!
//! All allocations use alignment 1 so the host and guest agree on the
//! [`std::alloc::Layout`] used to free them.

use std::alloc::{alloc, dealloc, Layout};

/// Allocates `len` bytes on the guest heap and returns the pointer.
///
/// The host calls this to hand the guest an args buffer, and the guest calls it
/// to publish result / request buffers back to the host.
///
/// # Safety
///
/// The returned pointer must be freed exactly once via [`sv_dealloc`] with the
/// same `len`. Returns a dangling (non-null) pointer for `len == 0` and null on
/// allocation failure.
#[no_mangle]
pub unsafe extern "C" fn sv_alloc(len: usize) -> *mut u8 {
    if len == 0 {
        return std::ptr::NonNull::dangling().as_ptr();
    }
    match Layout::from_size_align(len, 1) {
        Ok(layout) => alloc(layout),
        Err(_) => std::ptr::null_mut(),
    }
}

/// Frees a guest allocation previously returned by [`sv_alloc`] / [`pack`].
///
/// # Safety
///
/// `ptr` / `len` must come from a matching [`sv_alloc`] call and must not have
/// been freed already. No-op for `len == 0` or a null pointer.
#[no_mangle]
pub unsafe extern "C" fn sv_dealloc(ptr: *mut u8, len: usize) {
    if len == 0 || ptr.is_null() {
        return;
    }
    if let Ok(layout) = Layout::from_size_align(len, 1) {
        dealloc(ptr, layout);
    }
}

/// Copies `s` into a fresh guest allocation and returns a packed
/// `(ptr << 32) | len` handle for the host to read and then [`sv_dealloc`].
///
/// Returns `0` for an empty string or on allocation failure (the host treats a
/// zero handle as "no bytes").
pub fn pack(s: String) -> u64 {
    let bytes = s.into_bytes();
    let len = bytes.len();
    if len == 0 {
        return 0;
    }
    // SAFETY: `len > 0`; `sv_alloc` returns a valid align-1 buffer of `len`.
    let ptr = unsafe { sv_alloc(len) };
    if ptr.is_null() {
        return 0;
    }
    // SAFETY: `ptr` addresses `len` freshly allocated bytes, disjoint from `bytes`.
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr, len);
    }
    ((ptr as u64) << 32) | (len as u64)
}

/// Reads a UTF-8 string from a guest allocation and frees it.
///
/// Invalid UTF-8 is replaced lossily rather than panicking.
///
/// # Safety
///
/// `ptr` / `len` must describe a live allocation from [`sv_alloc`]; the buffer
/// is freed before returning, so the caller must not reuse it afterwards.
pub unsafe fn read_string(ptr: *mut u8, len: usize) -> String {
    if len == 0 || ptr.is_null() {
        return String::new();
    }
    let slice = std::slice::from_raw_parts(ptr, len);
    let text = String::from_utf8_lossy(slice).into_owned();
    sv_dealloc(ptr, len);
    text
}
