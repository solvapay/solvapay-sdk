//! Per-customer Guerrilla Mail session and expiry math.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use crate::error::ExampleError;

/// Initial inbox lifetime in seconds (published API: one hour).
pub const INITIAL_LIFETIME_SECS: i64 = 3600;
/// Hard cap on total lifetime from `email_timestamp` (published API: two hours).
pub const MAX_LIFETIME_SECS: i64 = 7200;

/// One customer's Guerrilla Mail inbox session.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    /// Session credential (`sid_token` from the JSON body).
    pub sid_token: Option<String>,
    /// Current disposable address, when known.
    pub email_addr: Option<String>,
    /// Guerrilla Mail `email_timestamp` (unix seconds).
    pub email_timestamp: Option<i64>,
}

impl Session {
    /// Empty session (no credential yet).
    #[must_use]
    pub fn new() -> Self {
        Self {
            sid_token: None,
            email_addr: None,
            email_timestamp: None,
        }
    }
}

impl Default for Session {
    fn default() -> Self {
        Self::new()
    }
}

/// Remaining seconds of the initial one-hour window.
///
/// The published doc writes `3600 - Current Timestamp - Email Timestamp`, which
/// subtracts the current timestamp twice. The correct formula is
/// `3600 - (now - email_timestamp)`, clamped at zero once expired.
#[must_use]
pub fn seconds_remaining(email_timestamp: i64, now: i64) -> u64 {
    clamp_non_negative(INITIAL_LIFETIME_SECS - (now - email_timestamp))
}

/// Remaining seconds after a successful `extend` (add one hour, cap at two).
#[must_use]
pub fn seconds_remaining_after_extend(email_timestamp: i64, now: i64) -> u64 {
    let after_extend = (seconds_remaining(email_timestamp, now) as i64) + INITIAL_LIFETIME_SECS;
    let until_cap = MAX_LIFETIME_SECS - (now - email_timestamp);
    clamp_non_negative(after_extend.min(until_cap))
}

/// Clamp a signed remaining-seconds value at zero.
fn clamp_non_negative(value: i64) -> u64 {
    if value < 0 {
        0
    } else {
        value as u64
    }
}

/// In-process sessions keyed by paying `customer_ref`.
#[derive(Clone, Default)]
pub struct SessionStore {
    /// `customer_ref` → session.
    inner: Arc<Mutex<HashMap<String, Session>>>,
}

impl SessionStore {
    /// Empty store.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Load the session for `customer_ref`, if any.
    ///
    /// # Errors
    ///
    /// When the mutex is poisoned.
    pub fn get(&self, customer_ref: &str) -> Result<Option<Session>, ExampleError> {
        let guard = self
            .inner
            .lock()
            .map_err(|_| ExampleError::new("session store lock poisoned"))?;
        Ok(guard.get(customer_ref).cloned())
    }

    /// Insert or replace the session for `customer_ref`.
    ///
    /// # Errors
    ///
    /// When the mutex is poisoned.
    pub fn put(&self, customer_ref: &str, session: Session) -> Result<(), ExampleError> {
        let mut guard = self
            .inner
            .lock()
            .map_err(|_| ExampleError::new("session store lock poisoned"))?;
        guard.insert(customer_ref.to_owned(), session);
        Ok(())
    }
}

#[cfg(test)]
#[allow(
    missing_docs,
    clippy::missing_docs_in_private_items,
    clippy::unwrap_used,
    clippy::expect_used,
    clippy::panic
)]
mod tests {
    use super::*;

    #[test]
    fn remaining_is_one_hour_minus_elapsed() {
        assert_eq!(seconds_remaining(1_000, 1_000), 3600);
        assert_eq!(seconds_remaining(1_000, 2_800), 1800);
    }

    #[test]
    fn remaining_clamps_at_zero_when_expired() {
        assert_eq!(seconds_remaining(1_000, 5_000), 0);
        assert_eq!(seconds_remaining(1_000, 4_600), 0);
    }

    #[test]
    fn extend_adds_one_hour_and_caps_at_two() {
        assert_eq!(seconds_remaining_after_extend(1_000, 1_000), 7200);
        assert_eq!(seconds_remaining_after_extend(1_000, 2_800), 5400);
        assert_eq!(seconds_remaining_after_extend(1_000, 7_000), 1200);
        assert_eq!(seconds_remaining_after_extend(1_000, 9_000), 0);
    }
}
