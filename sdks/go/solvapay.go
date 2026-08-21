// Package solvapay is the wazero-backed Go binding for the SolvaPay SDK.
//
// It embeds a WASI build of solvapay-core + solvapay-transport
// (solvapay_core.wasm) and runs it under github.com/tetratelabs/wazero, with a
// net/http host transport and a bounded instance pool. Package-level helpers
// cover Version and VerifyWebhook; the full Groups A–C client surface lives in
// the generated client_generated.go facade.
package solvapay

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"sync"

	"github.com/solvapay/solvapay-go/internal/runtime"
)

//go:embed solvapay_core.wasm
var wasmModule []byte

// defaultMaxInstances bounds the shared (clientless) runtime's pool.
const defaultMaxInstances = 4

// shared is the lazily-initialized clientless runtime backing the package-level
// Version and VerifyWebhook helpers.
var (
	sharedOnce sync.Once
	sharedRT   *runtime.Runtime
	sharedErr  error
)

func shared(ctx context.Context) (*runtime.Runtime, error) {
	sharedOnce.Do(func() {
		sharedRT, sharedErr = runtime.New(ctx, wasmModule, runtime.Config{
			MaxInstances: defaultMaxInstances,
		})
	})
	return sharedRT, sharedErr
}

// Version returns the embedded guest crate version (CARGO_PKG_VERSION).
func Version(ctx context.Context) (string, error) {
	rt, err := shared(ctx)
	if err != nil {
		return "", err
	}
	return rt.Version(ctx)
}

// VerifyWebhook verifies a SolvaPay webhook signature and returns the parsed
// event body. On failure it returns an *Error whose Code is one of the stable
// snake_case webhook codes (missing_signature, malformed_signature,
// timestamp_too_old, invalid_signature, invalid_payload).
func VerifyWebhook(ctx context.Context, body, signature, secret string, nowUnixSecs int64) (map[string]any, error) {
	rt, err := shared(ctx)
	if err != nil {
		return nil, err
	}
	args, err := json.Marshal(map[string]any{
		"body":        body,
		"signature":   signature,
		"secret":      secret,
		"nowUnixSecs": nowUnixSecs,
	})
	if err != nil {
		return nil, err
	}
	envelope, err := rt.CallEnvelope(ctx, "sv_verify_webhook", string(args))
	if err != nil {
		return nil, err
	}
	var event map[string]any
	if err := decodeEnvelope(envelope, &event); err != nil {
		return nil, err
	}
	return event, nil
}

// Option configures a Client.
type Option func(*runtime.Config)

// WithBaseURL overrides the SolvaPay API origin (defaults to the guest default).
func WithBaseURL(baseURL string) Option {
	return func(c *runtime.Config) { c.BaseURL = baseURL }
}

// WithMaxInstances bounds the client's guest instance pool (defaults to 4).
func WithMaxInstances(n int) Option {
	return func(c *runtime.Config) { c.MaxInstances = n }
}

// Client is a configured SolvaPay client backed by its own guest instance pool.
type Client struct {
	rt *runtime.Runtime
}

// NewClient builds a client authenticated with apiKey.
//
// The caller owns the returned Client and must Close it to release the runtime.
func NewClient(ctx context.Context, apiKey string, opts ...Option) (*Client, error) {
	if apiKey == "" {
		return nil, &Error{Code: "invalid_config", Message: "apiKey must not be empty"}
	}
	cfg := runtime.Config{APIKey: apiKey, MaxInstances: defaultMaxInstances}
	for _, opt := range opts {
		opt(&cfg)
	}
	rt, err := runtime.New(ctx, wasmModule, cfg)
	if err != nil {
		return nil, err
	}
	return &Client{rt: rt}, nil
}

// Close releases the client's runtime and all pooled instances.
func (c *Client) Close(ctx context.Context) error {
	return c.rt.Close(ctx)
}

// envelope is the guest's `{"ok":…,"value":…,"error":…}` wire shape.
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

// decodeEnvelope unmarshals a success value into out, or returns an *Error.
func decodeEnvelope(raw string, out any) error {
	if raw == "" {
		return &Error{Code: "internal_error", Message: "empty envelope from guest"}
	}
	var env envelope
	if err := json.Unmarshal([]byte(raw), &env); err != nil {
		return fmt.Errorf("solvapay: decode envelope: %w", err)
	}
	if !env.OK {
		return envelopeToError(env.Error)
	}
	if out == nil || len(env.Value) == 0 || string(env.Value) == "null" {
		return nil
	}
	if err := json.Unmarshal(env.Value, out); err != nil {
		return fmt.Errorf("solvapay: decode value: %w", err)
	}
	return nil
}

// envelopeToError converts an error envelope into a public *Error.
func envelopeToError(e *envelopeError) *Error {
	if e == nil {
		return &Error{Code: "internal_error", Message: "malformed error envelope"}
	}
	code := decodeCode(e.Code)
	if code == "" {
		code = e.Kind
	}
	out := &Error{Code: code, Message: e.Message, Retryable: e.Retryable}
	if e.Status != nil {
		out.Status = *e.Status
	}
	return out
}

// decodeCode extracts a string code from the SdkError `code` field, which is a
// snake_case string for webhook errors and a string/null for API errors.
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
