package mcp

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
)

// Handler is the merchant payable tool implementation.
type Handler func(ctx context.Context, args map[string]any, rc *ResponseContext) (Response, error)

// GetCustomerRef resolves the customer identity from the tool call.
type GetCustomerRef func(ctx context.Context, args map[string]any) (string, error)

// Options configures RegisterPayableTool.
type Options struct {
	Client         *solvapay.Client
	Product        string
	Handler        Handler
	Title          string
	Description    string
	InputSchema    map[string]any
	UsageType      string
	GetCustomerRef GetCustomerRef
}

type formatGateFn func(ctx context.Context, message string, gate json.RawMessage) (json.RawMessage, error)

var formatGate formatGateFn = paywallToolResult

// RegisterPayableTool registers a paywalled tool on a low-level MCP server.
func RegisterPayableTool(server *mcpsdk.Server, name string, opts Options) error {
	if server == nil {
		return fmt.Errorf("mcp server is required")
	}
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if opts.Client == nil {
		return fmt.Errorf("Client is required")
	}
	if opts.Product == "" {
		return fmt.Errorf("Product is required")
	}
	if opts.Handler == nil {
		return fmt.Errorf("Handler is required")
	}
	if opts.UsageType == "" {
		opts.UsageType = "requests"
	}
	schema, err := compileInputSchema(opts.InputSchema)
	if err != nil {
		return err
	}
	server.AddTool(&mcpsdk.Tool{
		Name:        name,
		Title:       opts.Title,
		Description: opts.Description,
		InputSchema: schema,
	}, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		result, err := dispatchPayable(ctx, req, opts)
		if err != nil {
			return nil, err
		}
		return result, nil
	})
	return nil
}

func compileInputSchema(fields map[string]any) (json.RawMessage, error) {
	if fields == nil {
		return json.RawMessage(`{"type":"object","properties":{}}`), nil
	}
	properties := map[string]any{}
	required := make([]string, 0, len(fields))
	for key, spec := range fields {
		obj, ok := spec.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("unsupported inputSchema for field %s", key)
		}
		typ, _ := obj["type"].(string)
		if typ != "string" {
			return nil, fmt.Errorf("unsupported inputSchema for field %s", key)
		}
		properties[key] = map[string]any{"type": "string"}
		required = append(required, key)
	}
	schema := map[string]any{"type": "object", "properties": properties}
	if len(required) > 0 {
		schema["required"] = required
	}
	return json.Marshal(schema)
}

func dispatchPayable(ctx context.Context, req *mcpsdk.CallToolRequest, opts Options) (*mcpsdk.CallToolResult, error) {
	started := time.Now()
	args := map[string]any{}
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 && string(req.Params.Arguments) != "null" {
		if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
			return nil, fmt.Errorf("decode tool arguments: %w", err)
		}
	}
	customerRef, err := resolveCustomerRef(ctx, args, opts.GetCustomerRef)
	if err != nil {
		return nil, err
	}
	outcome, err := opts.Client.Gate(ctx, customerRef, solvapay.GateOpts{
		Product:   opts.Product,
		UsageType: opts.UsageType,
	})
	if err != nil {
		return nil, err
	}
	switch typed := outcome.(type) {
	case *solvapay.Paywall:
		message := gateMessage(typed.Gate)
		payload, err := formatGate(ctx, message, typed.Gate)
		if err != nil {
			return nil, err
		}
		return payloadToCallToolResult(payload)
	case *solvapay.Allow:
		return runAllow(ctx, started, typed, args, opts)
	default:
		return nil, fmt.Errorf("unexpected gate result %T", outcome)
	}
}

func runAllow(ctx context.Context, started time.Time, allow *solvapay.Allow, args map[string]any, opts Options) (*mcpsdk.CallToolResult, error) {
	snap := allow.Customer()
	rc := &ResponseContext{
		ctx: ctx,
		Customer: CustomerView{
			Ref:          snap.Ref,
			Balance:      snap.Balance,
			Remaining:    snap.Remaining,
			WithinLimits: snap.WithinLimits,
			Plan:         snap.Plan,
		},
		Product:    ProductView{Reference: opts.Product, Name: opts.Product},
		productRef: opts.Product,
	}
	returned, err := opts.Handler(ctx, args, rc)
	var signal *GateSignal
	if errors.As(err, &signal) {
		payload, ferr := formatGate(ctx, signal.Reason, signal.Gate)
		if ferr != nil {
			return nil, ferr
		}
		return payloadToCallToolResult(payload)
	}
	elapsed := float64(time.Since(started).Milliseconds())
	if elapsed < 0 {
		elapsed = 0
	}
	if err != nil {
		if trackErr := allow.TrackFail(ctx, err, solvapay.TrackOpts{Duration: &elapsed}); trackErr != nil {
			return nil, trackErr
		}
		return errorToolResult(err.Error())
	}
	if !returned.valid() {
		inner := fmt.Errorf("handler must return ctx.Respond(...)")
		if trackErr := allow.TrackFail(ctx, inner, solvapay.TrackOpts{Duration: &elapsed}); trackErr != nil {
			return nil, trackErr
		}
		return errorToolResult(inner.Error())
	}
	envelope, err := assertResponseResult(ctx, returned.payload)
	if err != nil {
		if trackErr := allow.TrackFail(ctx, err, solvapay.TrackOpts{Duration: &elapsed}); trackErr != nil {
			return nil, trackErr
		}
		return errorToolResult(err.Error())
	}
	payload, err := buildPayableToolResult(ctx, envelope)
	if err != nil {
		if trackErr := allow.TrackFail(ctx, err, solvapay.TrackOpts{Duration: &elapsed}); trackErr != nil {
			return nil, trackErr
		}
		return errorToolResult(err.Error())
	}
	if err := allow.TrackSuccess(ctx, solvapay.TrackOpts{Duration: &elapsed}); err != nil {
		return nil, err
	}
	return payloadToCallToolResult(payload)
}

func resolveCustomerRef(ctx context.Context, args map[string]any, hook GetCustomerRef) (string, error) {
	if hook != nil {
		return hook(ctx, args)
	}
	if raw, ok := args["customer_ref"].(string); ok && raw != "" {
		return raw, nil
	}
	return "anonymous", nil
}

func gateMessage(gate json.RawMessage) string {
	var parsed struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(gate, &parsed); err != nil {
		return "Payment required"
	}
	if parsed.Message == "" {
		return "Payment required"
	}
	return parsed.Message
}
