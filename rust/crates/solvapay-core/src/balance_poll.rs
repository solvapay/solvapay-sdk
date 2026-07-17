//! Balance-poll delay tables and observation decision (Step 28).
//!
//! Timers and the `getBalance` callback stay host-side — this module owns
//! the frozen delay schedules and the pure increase check (strict `>`).

/// Top-up payment-intent balance poll backoff (ms).
pub const TOPUP_BALANCE_POLL_DELAYS_MS: [u64; 4] = [500, 1000, 2000, 4000];

/// Client-side balance reconciliation backoff after async credit top-ups (ms).
pub const BALANCE_RECONCILE_DELAYS_MS: [u64; 6] = [500, 1000, 2000, 4000, 8000, 16000];

/// Policy wrapper over a delay table for host-side poll loops.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BalancePollPolicy {
    /// Delay schedule in milliseconds.
    delays: &'static [u64],
}

impl BalancePollPolicy {
    /// Policy using [`TOPUP_BALANCE_POLL_DELAYS_MS`].
    ///
    /// # Returns
    ///
    /// A policy that walks the top-up delay table.
    pub fn topup() -> Self {
        Self {
            delays: &TOPUP_BALANCE_POLL_DELAYS_MS,
        }
    }

    /// Policy using [`BALANCE_RECONCILE_DELAYS_MS`].
    ///
    /// # Returns
    ///
    /// A policy that walks the reconcile delay table.
    pub fn reconcile() -> Self {
        Self {
            delays: &BALANCE_RECONCILE_DELAYS_MS,
        }
    }

    /// Policy over an explicit static delay slice.
    ///
    /// # Arguments
    ///
    /// * `delays` - Millisecond delays consumed one per poll attempt.
    ///
    /// # Returns
    ///
    /// A policy that walks `delays`.
    pub fn from_delays(delays: &'static [u64]) -> Self {
        Self { delays }
    }

    /// Delay before poll attempt `attempt` (0-based), or `None` when exhausted.
    ///
    /// # Arguments
    ///
    /// * `attempt` - Zero-based index into the delay table.
    ///
    /// # Returns
    ///
    /// `Some(ms)` when a delay remains; `None` when the table is exhausted.
    pub fn next_delay(&self, attempt: u32) -> Option<u64> {
        let index = usize::try_from(attempt).ok()?;
        self.delays.get(index).copied()
    }

    /// Full delay table as a slice.
    ///
    /// # Returns
    ///
    /// The underlying millisecond delay schedule.
    pub fn delays(&self) -> &'static [u64] {
        self.delays
    }
}

/// Decide whether observed credits constitute an increase over `baseline`.
///
/// Uses strict greater-than (equal credits are not an increase), matching the
/// TypeScript `pollBalanceUntilIncreased` contract.
///
/// # Arguments
///
/// * `baseline` - Credits before polling began.
/// * `credits` - Credits observed on the current poll.
///
/// # Returns
///
/// `Some(credits - baseline)` when `credits > baseline`; otherwise `None`.
pub fn evaluate_balance_observation(baseline: f64, credits: f64) -> Option<f64> {
    (credits > baseline).then_some(credits - baseline)
}

#[cfg(test)]
mod tests {
    #![allow(
        clippy::unwrap_used,
        clippy::expect_used,
        clippy::panic,
        clippy::missing_docs_in_private_items
    )]

    use super::*;

    #[test]
    fn topup_table_matches_ts() {
        assert_eq!(TOPUP_BALANCE_POLL_DELAYS_MS, [500, 1000, 2000, 4000]);
    }

    #[test]
    fn reconcile_table_matches_ts() {
        assert_eq!(
            BALANCE_RECONCILE_DELAYS_MS,
            [500, 1000, 2000, 4000, 8000, 16000]
        );
    }

    #[test]
    fn next_delay_walks_table_then_exhausts() {
        let policy = BalancePollPolicy::from_delays(&[500, 1000, 2000]);
        assert_eq!(policy.next_delay(0), Some(500));
        assert_eq!(policy.next_delay(1), Some(1000));
        assert_eq!(policy.next_delay(2), Some(2000));
        assert_eq!(policy.next_delay(3), None);
    }

    #[test]
    fn evaluate_strictly_greater_returns_delta() {
        assert_eq!(evaluate_balance_observation(400.0, 10000.0), Some(9600.0));
        assert_eq!(evaluate_balance_observation(0.0, 500.0), Some(500.0));
    }

    #[test]
    fn evaluate_equal_or_less_returns_none() {
        assert_eq!(evaluate_balance_observation(400.0, 400.0), None);
        assert_eq!(evaluate_balance_observation(400.0, 100.0), None);
    }
}
