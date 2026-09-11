//! Native C-string helpers for the SolvaPay C ABI.

use std::borrow::Cow;
use std::ffi::{CStr, CString};
use std::os::raw::c_char;
use std::ptr;

/// Heap-allocates a NUL-terminated C string the caller must free with
/// [`crate::solvapay_free_string`].
///
/// Returns null when `s` contains an interior NUL (should not happen for JSON).
pub fn into_c_string(s: String) -> *mut c_char {
    match CString::new(s) {
        Ok(cstr) => cstr.into_raw(),
        Err(_) => ptr::null_mut(),
    }
}

/// Reads a NUL-terminated C string as UTF-8 (lossy).
///
/// Returns [`None`] when `ptr` is null.
pub fn read_c_str<'a>(ptr: *const c_char) -> Option<Cow<'a, str>> {
    if ptr.is_null() {
        return None;
    }
    // Safety: caller promises a valid NUL-terminated C string for the duration
    // of this call (standard FFI contract for `const char*`).
    let cstr = unsafe { CStr::from_ptr(ptr) };
    Some(cstr.to_string_lossy())
}

/// Frees a string previously returned by [`into_c_string`]. Null is a no-op.
///
/// # Safety
///
/// `ptr` must be null or a pointer previously returned by [`into_c_string`] /
/// an `extern "C"` export that documents the same ownership.
pub unsafe fn free_c_string(ptr: *mut c_char) {
    if ptr.is_null() {
        return;
    }
    // Safety: ownership transferred from into_c_string / export.
    drop(unsafe { CString::from_raw(ptr) });
}
