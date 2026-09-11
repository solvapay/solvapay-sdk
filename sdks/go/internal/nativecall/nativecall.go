// Package nativecall invokes guest exports on the shared clientless runtime.
//
// It is used by fixture replay and by production facade plumbing (Gate,
// payable-MCP layer-2 payload builders) that must call sync decision helpers
// without a configured API client.
package nativecall

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"

	"github.com/solvapay/solvapay-sdk/sdks/go/internal/runtime"
)

type sharedFn func(ctx context.Context) (*runtime.Runtime, error)

var (
	mu     sync.Mutex
	shared sharedFn
)

// Bind installs the clientless shared runtime getter. Called from package solvapay.
func Bind(fn sharedFn) {
	mu.Lock()
	defer mu.Unlock()
	shared = fn
}

func runtimeFor(ctx context.Context) (*runtime.Runtime, error) {
	mu.Lock()
	fn := shared
	mu.Unlock()
	if fn == nil {
		return nil, errors.New("nativecall: shared runtime is not bound")
	}
	return fn(ctx)
}

// CallEnvelope invokes a guest export and returns the raw JSON envelope string.
func CallEnvelope(ctx context.Context, fn, argsJSON string) (string, error) {
	rt, err := runtimeFor(ctx)
	if err != nil {
		return "", err
	}
	return rt.CallEnvelope(ctx, fn, argsJSON)
}

// GuestError is an unwrapped SdkError envelope from a guest export.
type GuestError struct {
	Kind      string
	Message   string
	Code      string
	Status    int
	Retryable bool
}

func (e *GuestError) Error() string { return e.Message }

type envelope struct {
	OK    bool            `json:"ok"`
	Value json.RawMessage `json:"value"`
	Error *envelopeError  `json:"error"`
}

type envelopeError struct {
	Kind      string          `json:"kind"`
	Message   string          `json:"message"`
	Code      json.RawMessage `json:"code"`
	Status    *int            `json:"status"`
	Retryable bool            `json:"retryable"`
}

// CallValueJSON invokes a guest export and returns the success value as raw JSON.
func CallValueJSON(ctx context.Context, fn, argsJSON string) (json.RawMessage, error) {
	raw, err := CallEnvelope(ctx, fn, argsJSON)
	if err != nil {
		return nil, err
	}
	if raw == "" {
		return nil, &GuestError{Code: "internal_error", Message: "empty envelope from guest"}
	}
	var env envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return nil, fmt.Errorf("nativecall: decode envelope: %w", err)
	}
	if !env.OK {
		return nil, envelopeToError(env.Error)
	}
	if len(env.Value) == 0 {
		return nil, nil
	}
	return env.Value, nil
}

// CallSync invokes a guest export and unwraps the envelope into a value or *GuestError.
func CallSync(ctx context.Context, fn, argsJSON string) (any, error) {
	valueJSON, err := CallValueJSON(ctx, fn, argsJSON)
	if err != nil {
		return nil, err
	}
	if len(valueJSON) == 0 || string(valueJSON) == "null" {
		return nil, nil
	}
	var value any
	if err := json.Unmarshal(valueJSON, &value); err != nil {
		return nil, fmt.Errorf("nativecall: decode value: %w", err)
	}
	return value, nil
}

func envelopeToError(e *envelopeError) error {
	if e == nil {
		return &GuestError{Code: "internal_error", Message: "malformed error envelope"}
	}
	code := decodeCode(e.Code)
	if code == "" {
		code = e.Kind
	}
	out := &GuestError{Kind: e.Kind, Code: code, Message: e.Message, Retryable: e.Retryable}
	if e.Status != nil {
		out.Status = *e.Status
	}
	return out
}

func decodeCode(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var code string
	if err := json.Unmarshal(raw, &code); err != nil {
		return ""
	}
	return code
}
