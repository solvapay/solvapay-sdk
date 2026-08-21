//! Generation-counted opaque client handle table (§7.6).
//!
//! Handles are packed `{index, generation}` values cast to `*mut SolvapayClient`.
//! Free bumps the generation so a stale pointer resolves to [`SolvapayStatus::InvalidHandle`]
//! and never dereferences freed memory.

use std::sync::Mutex;

use solvapay_transport::SolvaPayClient;

use crate::SolvapayClient as OpaqueClient;
use crate::SolvapayStatus;

/// One live client slot in the registry.
struct ClientEntry {
    /// Generation counter; bumped on free so stale packed handles fail lookup.
    generation: u32,
    /// Live client, if the slot is occupied.
    client: Option<SolvaPayClient>,
}

/// Process-wide client registry.
static REGISTRY: Mutex<Vec<ClientEntry>> = Mutex::new(Vec::new());

/// Packs `(index, generation)` into an opaque handle pointer (never a real allocation).
pub fn pack_handle(index: u32, generation: u32) -> *mut OpaqueClient {
    // Non-zero so null remains reserved for "no handle".
    let packed = ((u64::from(index) + 1) << 32) | u64::from(generation);
    packed as *mut OpaqueClient
}

/// Unpacks an opaque handle into `(index, generation)`.
///
/// Returns [`None`] for null or malformed packed values.
pub fn unpack_handle(handle: *mut OpaqueClient) -> Option<(u32, u32)> {
    if handle.is_null() {
        return None;
    }
    let packed = handle as u64;
    let index_plus = (packed >> 32) as u32;
    if index_plus == 0 {
        return None;
    }
    let index = index_plus - 1;
    let generation = packed as u32;
    Some((index, generation))
}

/// Registers a client and returns an opaque handle.
///
/// # Errors
///
/// Returns [`SolvapayStatus::Panic`] when the registry mutex is poisoned.
pub fn register(client: SolvaPayClient) -> Result<*mut OpaqueClient, SolvapayStatus> {
    let Ok(mut table) = REGISTRY.lock() else {
        return Err(SolvapayStatus::Panic);
    };

    // Prefer reusing a free slot (generation already bumped on free).
    for (index, entry) in table.iter_mut().enumerate() {
        if entry.client.is_none() {
            entry.client = Some(client);
            let generation = entry.generation;
            // index fits: table length is bounded by process lifetime allocations.
            #[allow(clippy::cast_possible_truncation)]
            let index_u32 = index as u32;
            return Ok(pack_handle(index_u32, generation));
        }
    }

    let index = table.len();
    if index > u32::MAX as usize {
        return Err(SolvapayStatus::Panic);
    }
    #[allow(clippy::cast_possible_truncation)]
    let index_u32 = index as u32;
    table.push(ClientEntry {
        generation: 1,
        client: Some(client),
    });
    Ok(pack_handle(index_u32, 1))
}

/// Frees a handle. Null and stale handles are no-ops (idempotent).
pub fn free(handle: *mut OpaqueClient) {
    let Some((index, generation)) = unpack_handle(handle) else {
        return;
    };
    let Ok(mut table) = REGISTRY.lock() else {
        return;
    };
    let Some(entry) = table.get_mut(index as usize) else {
        return;
    };
    if entry.generation != generation || entry.client.is_none() {
        return;
    }
    entry.client = None;
    entry.generation = entry.generation.wrapping_add(1);
    if entry.generation == 0 {
        // Keep generation non-zero so pack_handle stays non-null when index==0.
        entry.generation = 1;
    }
}

/// Runs `f` with a shared reference to the live client for `handle`.
///
/// # Errors
///
/// Returns [`SolvapayStatus::InvalidHandle`] when the packed generation does not
/// match a live slot, or [`SolvapayStatus::Panic`] when the mutex is poisoned.
pub fn with_client<R, F>(handle: *mut OpaqueClient, f: F) -> Result<R, SolvapayStatus>
where
    F: FnOnce(&SolvaPayClient) -> R,
{
    let Some((index, generation)) = unpack_handle(handle) else {
        return Err(SolvapayStatus::InvalidHandle);
    };
    let Ok(table) = REGISTRY.lock() else {
        return Err(SolvapayStatus::Panic);
    };
    let Some(entry) = table.get(index as usize) else {
        return Err(SolvapayStatus::InvalidHandle);
    };
    if entry.generation != generation {
        return Err(SolvapayStatus::InvalidHandle);
    }
    let Some(client) = entry.client.as_ref() else {
        return Err(SolvapayStatus::InvalidHandle);
    };
    Ok(f(client))
}

#[cfg(test)]
#[allow(
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic,
    clippy::missing_docs_in_private_items
)]
mod tests {
    use super::*;
    use solvapay_transport::{ClientShell, SharedTransport, Transport};
    use std::sync::Arc;

    struct NoopTransport;

    impl Transport for NoopTransport {
        fn send(
            &self,
            _request: solvapay_transport::HttpRequest,
        ) -> solvapay_transport::BoxFuture<
            '_,
            Result<solvapay_transport::HttpResponse, solvapay_core::SdkError>,
        > {
            Box::pin(async { Err(solvapay_core::SdkError::transport("noop transport", false)) })
        }
    }

    fn dummy_client() -> SolvaPayClient {
        let transport: SharedTransport = Arc::new(NoopTransport);
        let shell = ClientShell::new(transport, "sk_test");
        SolvaPayClient::new(shell)
    }

    #[test]
    fn register_free_stale_is_invalid_handle() {
        let handle = register(dummy_client()).expect("register");
        assert!(!handle.is_null());
        with_client(handle, |_| ()).expect("live handle works");

        free(handle);
        assert_eq!(
            with_client(handle, |_| ()).unwrap_err(),
            SolvapayStatus::InvalidHandle
        );
        // Idempotent free.
        free(handle);
        free(std::ptr::null_mut());
    }

    #[test]
    fn index_reuse_gets_new_generation() {
        let first = register(dummy_client()).expect("register first");
        let (index_a, gen_a) = unpack_handle(first).expect("unpack first");
        free(first);

        let second = register(dummy_client()).expect("register second");
        let (index_b, gen_b) = unpack_handle(second).expect("unpack second");
        assert_eq!(index_a, index_b, "free slot should be reused");
        assert_ne!(gen_a, gen_b, "generation must bump on free");
        assert_eq!(
            with_client(first, |_| ()).unwrap_err(),
            SolvapayStatus::InvalidHandle
        );
        with_client(second, |_| ()).expect("new handle works");
        free(second);
    }

    #[test]
    fn garbage_pointer_is_invalid_handle() {
        let garbage = 0xDEAD_BEEF_u64 as *mut OpaqueClient;
        assert_eq!(
            with_client(garbage, |_| ()).unwrap_err(),
            SolvapayStatus::InvalidHandle
        );
    }
}
