package solvapay

import (
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"math/big"
)

func (c *Client) emitHandlerUsage(ctx context.Context, state any, event map[string]any) error {
	outJSON, err := callDecisionJSON(ctx, "sv_gate_next_binding", map[string]any{
		"state": state,
		"event": event,
	})
	if err != nil {
		return err
	}
	var out struct {
		Action map[string]any `json:"action"`
	}
	if err := json.Unmarshal(outJSON, &out); err != nil {
		return fmt.Errorf("solvapay: gate_next handler usage: %w", err)
	}
	kind, _ := out.Action["kind"].(string)
	if kind == "skipUsage" {
		return nil
	}
	if kind != "emitUsage" {
		return &Error{Code: "internal_error", Message: "gate_next handler event returned unexpected action"}
	}
	request, ok := out.Action["request"].(map[string]any)
	if !ok || request == nil {
		return &Error{Code: "internal_error", Message: "gate_next emitUsage missing request"}
	}
	return c.postUsage(ctx, request)
}

func (c *Client) postUsage(ctx context.Context, request map[string]any) error {
	opts := DefaultRetryOptions()
	opts.ShouldRetry = func(err error, _ uint32) bool {
		retry, classifyErr := shouldRetryUsageError(ctx, err)
		if classifyErr != nil {
			panic(classifyErr)
		}
		return retry
	}
	_, err := WithRetry(ctx, func() (any, error) {
		return c.TrackUsage(ctx, request)
	}, opts)
	return err
}

func shouldRetryUsageError(ctx context.Context, err error) (bool, error) {
	outJSON, callErr := callDecisionJSON(ctx, "sv_should_retry_usage_error_binding", map[string]any{
		"message": err.Error(),
	})
	if callErr != nil {
		return false, callErr
	}
	var retry bool
	if err := json.Unmarshal(outJSON, &retry); err != nil {
		return false, fmt.Errorf("solvapay: should_retry_usage_error: %w", err)
	}
	return retry, nil
}

func mustRandomUnit() float64 {
	n, err := rand.Int(rand.Reader, big.NewInt(1<<53))
	if err != nil {
		panic(fmt.Errorf("solvapay: random unit: %w", err))
	}
	return float64(n.Int64()) / float64(1<<53)
}
