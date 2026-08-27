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
	args := map[string]any{}
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 && string(req.Params.Arguments) != "null" {
		if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
			return nil, fmt.Errorf("decode tool arguments: %w", err)
		}
	}
	return InvokePayable(ctx, args, opts)
}

// InvokePayable runs the payable decision sequence for one tool call.
func InvokePayable(ctx context.Context, args map[string]any, opts Options) (*mcpsdk.CallToolResult, error) {
	if args == nil {
		args = map[string]any{}
	}
	customerRef, err := resolveCustomerRef(ctx, args, opts.GetCustomerRef)
	if err != nil {
		return nil, err
	}
	var state any
	event := map[string]any{
		"kind":        "start",
		"customerRef": customerRef,
		"product":     opts.Product,
		"usageType":   opts.UsageType,
		"startedMs":   time.Now().UnixMilli(),
	}
	var allow *solvapay.Allow
	for {
		outRaw, err := callLayer2(ctx, "sv_invoke_payable_next_binding", map[string]any{
			"state": state,
			"event": event,
		})
		if err != nil {
			return nil, err
		}
		var out struct {
			State  any             `json:"state"`
			Action json.RawMessage `json:"action"`
		}
		if err := json.Unmarshal(outRaw, &out); err != nil {
			return nil, fmt.Errorf("decode invokePayableNext: %w", err)
		}
		state = out.State
		var head struct {
			Kind string `json:"kind"`
		}
		if err := json.Unmarshal(out.Action, &head); err != nil {
			return nil, fmt.Errorf("decode invokePayableNext action: %w", err)
		}
		switch head.Kind {
		case "runGate":
			{
				var action struct {
					CustomerRef string `json:"customerRef"`
					Product     string `json:"product"`
					UsageType   string `json:"usageType"`
				}
				if err := json.Unmarshal(out.Action, &action); err != nil {
					return nil, err
				}
				outcome, err := opts.Client.Gate(ctx, action.CustomerRef, solvapay.GateOpts{
					Product:   action.Product,
					UsageType: action.UsageType,
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
					if formatGateOverrideActive() {
						return payloadToCallToolResult(payload)
					}
					var gate any
					if err := json.Unmarshal(typed.Gate, &gate); err != nil {
						return nil, err
					}
					event = map[string]any{
						"kind":    "gatePaywall",
						"gate":    gate,
						"message": message,
					}
				case *solvapay.Allow:
					allow = typed
					snap := typed.Customer()
					event = map[string]any{
						"kind":        "gateAllow",
						"customerRef": snap.Ref,
						"limits": map[string]any{
							"creditBalance": snap.Balance,
							"remaining":     snap.Remaining,
							"withinLimits":  snap.WithinLimits,
							"plan":          snap.Plan,
						},
					}
				default:
					return nil, fmt.Errorf("unexpected gate result %T", outcome)
				}
			}
		case "invokeHandler":
			{
				var action struct {
					CustomerRef string          `json:"customerRef"`
					Limits      json.RawMessage `json:"limits"`
				}
				if err := json.Unmarshal(out.Action, &action); err != nil {
					return nil, err
				}
				var limits map[string]any
				if len(action.Limits) > 0 && string(action.Limits) != "null" {
					if err := json.Unmarshal(action.Limits, &limits); err != nil {
						return nil, err
					}
				}
				if limits == nil {
					limits = map[string]any{}
				}
				rc := &ResponseContext{
					ctx: ctx,
					Customer: CustomerView{
						Ref:          action.CustomerRef,
						Balance:      limits["creditBalance"],
						Remaining:    limits["remaining"],
						WithinLimits: limits["withinLimits"],
						Plan:         limits["plan"],
					},
					Product:    ProductView{Reference: opts.Product, Name: opts.Product},
					productRef: opts.Product,
				}
				if rc.Customer.Balance == nil {
					rc.Customer.Balance = 0
				}
				if rc.Customer.WithinLimits == nil {
					rc.Customer.WithinLimits = true
				}
				returned, err := opts.Handler(ctx, args, rc)
				var signal *GateSignal
				if errors.As(err, &signal) {
					payload, ferr := formatGate(ctx, signal.Reason, signal.Gate)
					if ferr != nil {
						return nil, ferr
					}
					if formatGateOverrideActive() {
						return payloadToCallToolResult(payload)
					}
					var gate any
					if err := json.Unmarshal(signal.Gate, &gate); err != nil {
						return nil, err
					}
					event = map[string]any{
						"kind":    "handlerPaywall",
						"gate":    gate,
						"message": signal.Reason,
					}
					continue
				}
				if err != nil {
					event = map[string]any{
						"kind":    "handlerErr",
						"message": err.Error(),
						"nowMs":   time.Now().UnixMilli(),
					}
					continue
				}
				if !returned.valid() {
					event = map[string]any{
						"kind":    "handlerErr",
						"message": "handler must return ctx.Respond(...)",
						"nowMs":   time.Now().UnixMilli(),
					}
					continue
				}
				envelope, err := assertResponseResult(ctx, returned.payload)
				if err != nil {
					event = map[string]any{
						"kind":    "handlerErr",
						"message": err.Error(),
						"nowMs":   time.Now().UnixMilli(),
					}
					continue
				}
				event = map[string]any{
					"kind":     "handlerOk",
					"envelope": json.RawMessage(envelope),
					"nowMs":    time.Now().UnixMilli(),
				}
			}
		case "done":
			var doneAction struct {
				Result json.RawMessage `json:"result"`
				Track  *struct {
					Outcome    string  `json:"outcome"`
					DurationMs float64 `json:"durationMs"`
				} `json:"track"`
			}
			if err := json.Unmarshal(out.Action, &doneAction); err != nil {
				return nil, err
			}
			if doneAction.Track != nil && allow != nil {
				elapsed := doneAction.Track.DurationMs
				if doneAction.Track.Outcome == "success" {
					if err := allow.TrackSuccess(ctx, solvapay.TrackOpts{Duration: &elapsed}); err != nil {
						return nil, err
					}
				} else {
					if err := allow.TrackFail(ctx, errors.New(doneAction.Track.Outcome), solvapay.TrackOpts{Duration: &elapsed}); err != nil {
						return nil, err
					}
				}
			}
			return payloadToCallToolResult(doneAction.Result)
		default:
			return nil, fmt.Errorf("invokePayableNext unknown action kind %s", head.Kind)
		}
	}
}

func formatGateOverrideActive() bool {
	return fmt.Sprintf("%p", formatGate) != fmt.Sprintf("%p", paywallToolResult)
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
