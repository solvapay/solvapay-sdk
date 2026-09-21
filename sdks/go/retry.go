package solvapay

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/solvapay/solvapay-sdk/sdks/go/internal/nativecall"
)

// RetryOptions configures [WithRetry]. Delay math is computed in the guest.
type RetryOptions struct {
	MaxRetries      uint32
	InitialDelay    time.Duration
	BackoffStrategy string
	ShouldRetry     func(err error, attempt uint32) bool
	OnRetry         func(err error, attempt uint32, delay time.Duration)
	Sleep           func(ctx context.Context, d time.Duration) error
}

func DefaultRetryOptions() RetryOptions {
	return RetryOptions{
		MaxRetries:      DefaultMaxRetries,
		InitialDelay:    time.Duration(DefaultInitialDelayMs) * time.Millisecond,
		BackoffStrategy: RetryBackoff,
	}
}

// WithRetry runs op until it succeeds or the native retry policy is exhausted.
func WithRetry[T any](ctx context.Context, op func() (T, error), opts RetryOptions) (T, error) {
	var zero T
	if opts.BackoffStrategy == "" {
		return zero, fmt.Errorf("BackoffStrategy is required")
	}
	sleep := opts.Sleep
	if sleep == nil {
		sleep = func(ctx context.Context, d time.Duration) error {
			if d == 0 {
				return nil
			}
			timer := time.NewTimer(d)
			defer timer.Stop()
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-timer.C:
				return nil
			}
		}
	}
	return RunGeneratedWithRetryLoop(RetryLoopHost[T]{
		MaxRetries:      int(opts.MaxRetries),
		InitialDelayMs:  int(opts.InitialDelay.Milliseconds()),
		BackoffStrategy: opts.BackoffStrategy,
		Invoke:          op,
		Sleep: func(delayMs int) error {
			return sleep(ctx, time.Duration(delayMs)*time.Millisecond)
		},
		NextDelayMs: func(attempt int, maxRetries int, initialDelayMs int, backoffStrategy string) (int, bool, error) {
			delayArgs, marshalErr := json.Marshal(map[string]any{
				"attempt":         attempt,
				"maxRetries":      maxRetries,
				"initialDelay":    initialDelayMs,
				"backoffStrategy": backoffStrategy,
			})
			if marshalErr != nil {
				return 0, false, marshalErr
			}
			delayVal, delayErr := nativecall.CallSync(ctx, "sv_retry_next_delay_ms", string(delayArgs))
			if delayErr != nil {
				return 0, false, delayErr
			}
			if delayVal == nil {
				return 0, false, nil
			}
			delayMs, ok := delayVal.(float64)
			if !ok {
				return 0, false, fmt.Errorf("retry_next_delay_ms returned %T", delayVal)
			}
			return int(delayMs), true, nil
		},
		ShouldRetry: func(err error, attempt int) bool {
			if opts.ShouldRetry == nil {
				return true
			}
			return opts.ShouldRetry(err, uint32(attempt))
		},
		OnRetry: func(err error, attempt int, delayMs int) {
			if opts.OnRetry != nil {
				opts.OnRetry(err, uint32(attempt), time.Duration(delayMs)*time.Millisecond)
			}
		},
	})
}
