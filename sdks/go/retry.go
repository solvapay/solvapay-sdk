package solvapay

import (
	"context"
	"encoding/json"
	"fmt"
	"time"

	"github.com/solvapay/solvapay-go/internal/nativecall"
)

// RetryOptions configures [WithRetry]. Delay math is computed in the guest.
type RetryOptions struct {
	MaxRetries       uint32
	InitialDelay     time.Duration
	BackoffStrategy  string
	ShouldRetry      func(err error, attempt uint32) bool
	OnRetry          func(err error, attempt uint32, delay time.Duration)
	Sleep            func(ctx context.Context, d time.Duration) error
}

func DefaultRetryOptions() RetryOptions {
	return RetryOptions{
		MaxRetries:      2,
		InitialDelay:    500 * time.Millisecond,
		BackoffStrategy: "fixed",
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
	var attempt uint32
	for {
		value, err := op()
		if err == nil {
			return value, nil
		}
		delayArgs, marshalErr := json.Marshal(map[string]any{
			"attempt":         attempt,
			"maxRetries":      opts.MaxRetries,
			"initialDelay":    opts.InitialDelay.Milliseconds(),
			"backoffStrategy": opts.BackoffStrategy,
		})
		if marshalErr != nil {
			return zero, marshalErr
		}
		delayVal, delayErr := nativecall.CallSync(ctx, "sv_retry_next_delay_ms", string(delayArgs))
		if delayErr != nil {
			return zero, delayErr
		}
		if delayVal == nil {
			return zero, err
		}
		delayMs, ok := delayVal.(float64)
		if !ok {
			return zero, fmt.Errorf("retry_next_delay_ms returned %T", delayVal)
		}
		if opts.ShouldRetry != nil && !opts.ShouldRetry(err, attempt) {
			return zero, err
		}
		delay := time.Duration(delayMs) * time.Millisecond
		if opts.OnRetry != nil {
			opts.OnRetry(err, attempt, delay)
		}
		if sleepErr := sleep(ctx, delay); sleepErr != nil {
			return zero, sleepErr
		}
		attempt++
	}
}
