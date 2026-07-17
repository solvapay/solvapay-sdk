//! Pure retry-policy computation (Step 11).
//!
//! Timers, operation execution, and host callbacks (`shouldRetry` / `onRetry`)
//! stay outside this crate — see the facade weaving notes in the redesign doc.

use std::time::Duration;

/// Default `max_retries` from the SDK contract (`defaults.retry.maxRetries`).
pub const DEFAULT_MAX_RETRIES: u32 = 2;
/// Default initial delay in milliseconds (`defaults.retry.initialDelayMs`).
pub const DEFAULT_INITIAL_DELAY_MS: u64 = 500;

/// Backoff strategy for delay between retries.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum Backoff {
    /// Same delay between all retries (`initial_delay_ms`).
    #[default]
    Fixed,
    /// Delay grows linearly: `initial_delay_ms * (attempt + 1)`.
    Linear,
    /// Delay grows exponentially: `initial_delay_ms * 2^attempt`.
    Exponential,
}

/// Retry policy: how many retries after the initial call, and how long to wait.
///
/// `max_retries` counts retries *after* the initial call (defaults match the
/// SDK contract: 2 retries, 500 ms, fixed). `attempt` passed to
/// [`RetryPolicy::next_delay`] is the zero-based failed-call index.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct RetryPolicy {
    /// Retries after the initial call (not including the first attempt).
    pub max_retries: u32,
    /// Base delay in milliseconds before the first retry.
    pub initial_delay_ms: u64,
    /// How the delay grows across retries.
    pub backoff: Backoff,
}

impl Default for RetryPolicy {
    /// Builds a policy with SDK contract defaults (2 retries, 500 ms, fixed).
    ///
    /// # Returns
    ///
    /// A [`RetryPolicy`] with [`DEFAULT_MAX_RETRIES`], [`DEFAULT_INITIAL_DELAY_MS`],
    /// and [`Backoff::Fixed`].
    fn default() -> Self {
        Self {
            max_retries: DEFAULT_MAX_RETRIES,
            initial_delay_ms: DEFAULT_INITIAL_DELAY_MS,
            backoff: Backoff::Fixed,
        }
    }
}

impl RetryPolicy {
    /// Delay before the next retry after a failed call at `attempt` (0-based).
    ///
    /// When retries are exhausted (`attempt >= max_retries`), returns `None`
    /// without computing a delay. The last attempt therefore never consults
    /// host-side `shouldRetry` / `onRetry` callbacks.
    ///
    /// Delay formulas (saturating on overflow):
    /// - fixed: `d`
    /// - linear: `d * (attempt + 1)`
    /// - exponential: `d * 2^attempt`
    ///
    /// # Arguments
    ///
    /// * `attempt` - Zero-based index of the failed call (0 = first failure)
    ///
    /// # Returns
    ///
    /// `Some(Duration)` to wait before the next try, or `None` when exhausted.
    pub fn next_delay(&self, attempt: u32) -> Option<Duration> {
        if attempt >= self.max_retries {
            return None;
        }
        Some(Duration::from_millis(self.delay_ms(attempt)))
    }

    /// Milliseconds to wait before retrying after failed call `attempt` (0-based).
    ///
    /// Applies the configured [`Backoff`] with saturating arithmetic. Caller must
    /// ensure `attempt < max_retries` (see [`RetryPolicy::next_delay`]).
    ///
    /// # Arguments
    ///
    /// * `attempt` - Zero-based index of the failed call
    ///
    /// # Returns
    ///
    /// Delay in milliseconds (`u64::MAX` if exponential shift overflows).
    fn delay_ms(&self, attempt: u32) -> u64 {
        let d = self.initial_delay_ms;
        match self.backoff {
            Backoff::Fixed => d,
            Backoff::Linear => {
                let factor = u64::from(attempt).saturating_add(1);
                d.saturating_mul(factor)
            }
            Backoff::Exponential => match 1u64.checked_shl(attempt) {
                Some(factor) => d.saturating_mul(factor),
                None => u64::MAX,
            },
        }
    }
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
    fn default_policy_matches_contract() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.max_retries, 2);
        assert_eq!(policy.initial_delay_ms, 500);
        assert_eq!(policy.backoff, Backoff::Fixed);
    }

    #[test]
    fn fixed_default_delays_and_exhaustion() {
        let policy = RetryPolicy::default();
        assert_eq!(policy.next_delay(0), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(1), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(2), None);
    }

    #[test]
    fn max_retries_zero_exhausts_immediately() {
        let policy = RetryPolicy {
            max_retries: 0,
            ..RetryPolicy::default()
        };
        assert_eq!(policy.next_delay(0), None);
    }

    #[test]
    fn fixed_backoff_table() {
        let policy = RetryPolicy {
            max_retries: 4,
            initial_delay_ms: 500,
            backoff: Backoff::Fixed,
        };
        assert_eq!(policy.next_delay(0), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(1), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(2), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(3), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(4), None);
    }

    #[test]
    fn linear_backoff_table() {
        let policy = RetryPolicy {
            max_retries: 4,
            initial_delay_ms: 500,
            backoff: Backoff::Linear,
        };
        // d * (attempt + 1): 500, 1000, 1500, 2000
        assert_eq!(policy.next_delay(0), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(1), Some(Duration::from_millis(1000)));
        assert_eq!(policy.next_delay(2), Some(Duration::from_millis(1500)));
        assert_eq!(policy.next_delay(3), Some(Duration::from_millis(2000)));
        assert_eq!(policy.next_delay(4), None);
    }

    #[test]
    fn exponential_backoff_table() {
        let policy = RetryPolicy {
            max_retries: 4,
            initial_delay_ms: 500,
            backoff: Backoff::Exponential,
        };
        // d * 2^attempt: 500, 1000, 2000, 4000
        assert_eq!(policy.next_delay(0), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(1), Some(Duration::from_millis(1000)));
        assert_eq!(policy.next_delay(2), Some(Duration::from_millis(2000)));
        assert_eq!(policy.next_delay(3), Some(Duration::from_millis(4000)));
        assert_eq!(policy.next_delay(4), None);
    }

    #[test]
    fn custom_initial_delay() {
        let policy = RetryPolicy {
            max_retries: 2,
            initial_delay_ms: 250,
            backoff: Backoff::Exponential,
        };
        assert_eq!(policy.next_delay(0), Some(Duration::from_millis(250)));
        assert_eq!(policy.next_delay(1), Some(Duration::from_millis(500)));
        assert_eq!(policy.next_delay(2), None);
    }

    #[test]
    fn saturating_arithmetic_near_u64_max() {
        let linear = RetryPolicy {
            max_retries: 3,
            initial_delay_ms: u64::MAX,
            backoff: Backoff::Linear,
        };
        // attempt 1: MAX * 2 would overflow; must not panic
        assert_eq!(linear.next_delay(1), Some(Duration::from_millis(u64::MAX)));

        let exponential = RetryPolicy {
            max_retries: 80,
            initial_delay_ms: u64::MAX / 2,
            backoff: Backoff::Exponential,
        };
        // 2^2 * (MAX/2) overflows u64; must not panic
        assert_eq!(
            exponential.next_delay(2),
            Some(Duration::from_millis(u64::MAX))
        );
    }
}
