//! Host clock for the Rust facade (native `SystemTime` / Workers `Date.now`).

#![allow(clippy::missing_docs_in_private_items)]

#[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
use std::time::{SystemTime, UNIX_EPOCH};

pub(crate) fn now_ms() -> u64 {
    #[cfg(all(target_arch = "wasm32", target_os = "unknown"))]
    {
        js_sys::Date::now() as u64
    }
    #[cfg(not(all(target_arch = "wasm32", target_os = "unknown")))]
    {
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |d| d.as_millis() as u64)
    }
}

#[cfg(test)]
mod tests {
    use super::now_ms;

    #[test]
    fn now_ms_is_plausible_unix_millis() {
        let now = now_ms();
        assert!(
            now > 1_577_836_800_000,
            "now_ms must be after 2020-01-01 UTC, got {now}"
        );
        assert!(
            now < 4_102_444_800_000,
            "now_ms must be before 2100-01-01 UTC, got {now}"
        );
    }
}
