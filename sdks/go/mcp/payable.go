package mcp

import (
	"context"
	cryptorand "crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strings"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-sdk/sdks/go"
)

func randUnit() float64 {
	n, err := cryptorand.Int(cryptorand.Reader, big.NewInt(1<<53))
	if err != nil {
		return 0
	}
	return float64(n.Int64()) / float64(int64(1)<<53)
}

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
	OutputSchema   map[string]any
	UsageType      string
	GetCustomerRef GetCustomerRef
}

type customerRefSources struct {
	verifiedJwtSub      string
	headerUserID        string
	headerCustomerRef   string
	mcpExtraCustomerRef string
}

type formatGateFn func(ctx context.Context, message string, gate json.RawMessage) (json.RawMessage, error)

var formatGate formatGateFn = paywallToolResult

func validatePayableOptions(name string, opts *Options) error {
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
	return nil
}

// RegisterPayableTool registers a paywalled tool on a low-level MCP server.
func RegisterPayableTool(server *mcpsdk.Server, name string, opts Options) error {
	if server == nil {
		return fmt.Errorf("mcp server is required")
	}
	if err := validatePayableOptions(name, &opts); err != nil {
		return err
	}
	tool, err := payableMCPTool(name, opts)
	if err != nil {
		return err
	}
	server.AddTool(tool, func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		result, err := dispatchPayable(ctx, req, opts)
		if err != nil {
			return nil, err
		}
		return result, nil
	})
	return nil
}

func compileInputSchema(fields map[string]any) (json.RawMessage, error) {
	raw, err := solvapay.CompileStringFieldInputSchema(context.Background(), fields)
	if err != nil {
		return nil, err
	}
	var probe map[string]any
	if err := json.Unmarshal(raw, &probe); err != nil {
		return nil, err
	}
	if probe["error"] == "Transport" {
		if details, ok := probe["details"].(string); ok && details != "" {
			return nil, fmt.Errorf("%s", details)
		}
		return nil, fmt.Errorf("compile input schema failed")
	}
	return raw, nil
}

func dispatchPayable(ctx context.Context, req *mcpsdk.CallToolRequest, opts Options) (*mcpsdk.CallToolResult, error) {
	args := map[string]any{}
	if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 && string(req.Params.Arguments) != "null" {
		if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
			return nil, fmt.Errorf("decode tool arguments: %w", err)
		}
	}
	return invokePayable(ctx, args, opts, sourcesFromCall(req))
}

// InvokePayable runs the payable decision sequence for one tool call.
func InvokePayable(ctx context.Context, args map[string]any, opts Options) (*mcpsdk.CallToolResult, error) {
	return invokePayable(ctx, args, opts, customerRefSources{})
}

func invokePayable(ctx context.Context, args map[string]any, opts Options, sources customerRefSources) (*mcpsdk.CallToolResult, error) {
	if args == nil {
		args = map[string]any{}
	}
	customerRef, err := resolveCustomerRef(ctx, args, opts.GetCustomerRef, sources)
	if err != nil {
		return nil, err
	}
	host := payableHost{opts: opts, args: args}
	result, err := solvapay.RunGeneratedPayableLoop(
		ctx,
		func(state any, event map[string]any) (any, map[string]any, error) {
			outRaw, err := callLayer2(ctx, "sv_invoke_payable_next_binding", map[string]any{
				"state": state,
				"event": event,
			})
			if err != nil {
				return nil, nil, err
			}
			var out struct {
				State  any             `json:"state"`
				Action json.RawMessage `json:"action"`
			}
			if err := json.Unmarshal(outRaw, &out); err != nil {
				return nil, nil, fmt.Errorf("decode invokePayableNext: %w", err)
			}
			var action map[string]any
			if err := json.Unmarshal(out.Action, &action); err != nil {
				return nil, nil, fmt.Errorf("decode invokePayableNext action: %w", err)
			}
			return out.State, action, nil
		},
		&host,
		map[string]any{
			"kind":        "start",
			"customerRef": customerRef,
			"product":     opts.Product,
			"usageType":   opts.UsageType,
			"startedMs":   time.Now().UnixMilli(),
		},
	)
	if err != nil {
		return nil, err
	}
	switch typed := result.(type) {
	case *mcpsdk.CallToolResult:
		return typed, nil
	case json.RawMessage:
		return payloadToCallToolResult(typed)
	default:
		raw, err := json.Marshal(typed)
		if err != nil {
			return nil, err
		}
		return payloadToCallToolResult(raw)
	}
}

type payableHost struct {
	opts Options
	args map[string]any
}

func (h *payableHost) NowMs() int64        { return time.Now().UnixMilli() }
func (h *payableHost) RandomUnit() float64 { return randUnit() }

func (h *payableHost) RunGate(ctx context.Context, customerRef, product, usageType string) (solvapay.PayableGateHostResult, error) {
	outcome, err := h.opts.Client.Gate(ctx, customerRef, solvapay.GateOpts{
		Product:   product,
		UsageType: usageType,
	})
	if err != nil {
		return solvapay.PayableGateHostResult{}, err
	}
	switch typed := outcome.(type) {
	case *solvapay.Paywall:
		message := gateMessage(typed.Gate)
		payload, err := formatGate(ctx, message, typed.Gate)
		if err != nil {
			return solvapay.PayableGateHostResult{}, err
		}
		if formatGateOverrideActive() {
			result, err := payloadToCallToolResult(payload)
			if err != nil {
				return solvapay.PayableGateHostResult{}, err
			}
			return solvapay.PayableGateHostResult{Kind: "return", Result: result}, nil
		}
		var gate any
		if err := json.Unmarshal(typed.Gate, &gate); err != nil {
			return solvapay.PayableGateHostResult{}, err
		}
		return solvapay.PayableGateHostResult{Kind: "paywall", Gate: gate, Message: message}, nil
	case *solvapay.Allow:
		return solvapay.PayableGateHostResult{
			Kind:        "allow",
			CustomerRef: typed.Customer().Ref,
			Limits:      typed.Limits(),
		}, nil
	default:
		return solvapay.PayableGateHostResult{}, fmt.Errorf("unexpected gate result %T", outcome)
	}
}

func (h *payableHost) InvokeHandler(ctx context.Context, customerRef string, limits any) (solvapay.PayableHandlerHostResult, error) {
	limitsMap, _ := limits.(map[string]any)
	if limitsMap == nil {
		limitsMap = map[string]any{}
	}
	limitsRaw, err := json.Marshal(limits)
	if err != nil {
		return solvapay.PayableHandlerHostResult{}, err
	}
	snapVal, err := solvapay.BuildCustomerSnapshot(ctx, customerRef, limitsMap)
	if err != nil {
		return solvapay.PayableHandlerHostResult{}, err
	}
	snapRaw, err := json.Marshal(snapVal)
	if err != nil {
		return solvapay.PayableHandlerHostResult{}, err
	}
	var customer CustomerView
	if err := json.Unmarshal(snapRaw, &customer); err != nil {
		return solvapay.PayableHandlerHostResult{}, err
	}
	rc := &ResponseContext{
		ctx:        ctx,
		Customer:   customer,
		Product:    ProductView{Reference: h.opts.Product, Name: h.opts.Product},
		productRef: h.opts.Product,
		limits:     limitsRaw,
	}
	returned, err := h.opts.Handler(ctx, h.args, rc)
	var signal *GateSignal
	if errors.As(err, &signal) {
		payload, ferr := formatGate(ctx, signal.Reason, signal.Gate)
		if ferr != nil {
			return solvapay.PayableHandlerHostResult{}, ferr
		}
		if formatGateOverrideActive() {
			result, rerr := payloadToCallToolResult(payload)
			if rerr != nil {
				return solvapay.PayableHandlerHostResult{}, rerr
			}
			return solvapay.PayableHandlerHostResult{Kind: "return", Result: result}, nil
		}
		var gate any
		if err := json.Unmarshal(signal.Gate, &gate); err != nil {
			return solvapay.PayableHandlerHostResult{}, err
		}
		return solvapay.PayableHandlerHostResult{Kind: "paywall", Gate: gate, Message: signal.Reason}, nil
	}
	if err != nil {
		return solvapay.PayableHandlerHostResult{Kind: "err", Message: err.Error()}, nil
	}
	if !returned.valid() {
		return solvapay.PayableHandlerHostResult{Kind: "err", Message: "handler must return ctx.Respond(...)"}, nil
	}
	envelope, err := assertResponseResult(ctx, returned.payload)
	if err != nil {
		return solvapay.PayableHandlerHostResult{Kind: "err", Message: err.Error()}, nil
	}
	return solvapay.PayableHandlerHostResult{Kind: "ok", Envelope: json.RawMessage(envelope)}, nil
}

func (h *payableHost) TrackUsage(ctx context.Context, request any) error {
	req, _ := request.(map[string]any)
	if req == nil {
		return nil
	}
	_, err := h.opts.Client.TrackUsage(ctx, req)
	return err
}

func formatGateOverrideActive() bool {
	return fmt.Sprintf("%p", formatGate) != fmt.Sprintf("%p", paywallToolResult)
}

func payableMCPTool(name string, opts Options) (*mcpsdk.Tool, error) {
	ctx := context.Background()
	schema, err := compileInputSchema(opts.InputSchema)
	if err != nil {
		return nil, err
	}
	description, err := appendPaidDescription(ctx, opts.Description)
	if err != nil {
		return nil, err
	}
	tool := &mcpsdk.Tool{
		Name:        name,
		Title:       opts.Title,
		Description: description,
		InputSchema: schema,
	}
	if opts.OutputSchema != nil {
		unioned, err := unionPayableOutputSchema(ctx, opts.OutputSchema)
		if err != nil {
			return nil, err
		}
		tool.OutputSchema = unioned
	}
	return tool, nil
}

func appendPaidDescription(ctx context.Context, description string) (string, error) {
	var input any
	if strings.TrimSpace(description) != "" {
		input = description
	}
	raw, err := solvapay.AppendPaidToolDescription(ctx, input)
	if err != nil {
		return "", err
	}
	text, ok := raw.(string)
	if !ok {
		return "", fmt.Errorf("appendPaidToolDescription returned %T", raw)
	}
	return text, nil
}

func unionPayableOutputSchema(ctx context.Context, merchant map[string]any) (any, error) {
	paywall, err := solvapay.PaywallStructuredContentSchema(ctx)
	if err != nil {
		return nil, err
	}
	ensured, err := CallSync(ctx, "ensureOutputSchemaObjectType", map[string]any{
		"schema": map[string]any{
			"type":  "object",
			"oneOf": []any{merchant, paywall},
		},
	})
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(ensured, &out); err != nil {
		return nil, err
	}
	return out, nil
}

func sourcesFromCall(req *mcpsdk.CallToolRequest) customerRefSources {
	var sources customerRefSources
	if req == nil || req.Extra == nil {
		return sources
	}
	if req.Extra.Header != nil {
		sources.headerUserID = strings.TrimSpace(req.Extra.Header.Get("x-user-id"))
		sources.headerCustomerRef = strings.TrimSpace(req.Extra.Header.Get("x-customer-ref"))
	}
	if req.Extra.TokenInfo != nil {
		sources.verifiedJwtSub = strings.TrimSpace(req.Extra.TokenInfo.UserID)
		if ref, ok := req.Extra.TokenInfo.Extra["customer_ref"].(string); ok {
			sources.mcpExtraCustomerRef = strings.TrimSpace(ref)
		}
	}
	return sources
}

func sourcesFromEnvelope(envelope map[string]any) customerRefSources {
	ref, ok := asString(envelope["customerRef"])
	if !ok {
		return customerRefSources{}
	}
	ref = strings.TrimSpace(ref)
	if ref == "" {
		return customerRefSources{}
	}
	return customerRefSources{mcpExtraCustomerRef: ref}
}

func putCustomerRef(callArgs map[string]any, key, value string) {
	trimmed := strings.TrimSpace(value)
	if trimmed != "" {
		callArgs[key] = trimmed
	}
}

func argsAuthCustomerRef(args map[string]any) string {
	auth, ok := args["auth"].(map[string]any)
	if !ok {
		return ""
	}
	ref, _ := auth["customer_ref"].(string)
	return ref
}

func resolveCustomerRef(ctx context.Context, args map[string]any, hook GetCustomerRef, sources customerRefSources) (string, error) {
	callArgs := map[string]any{}
	if hook != nil {
		ref, err := hook(ctx, args)
		if err != nil {
			return "", err
		}
		putCustomerRef(callArgs, "hookRef", ref)
	}
	putCustomerRef(callArgs, "verifiedJwtSub", sources.verifiedJwtSub)
	putCustomerRef(callArgs, "headerUserId", sources.headerUserID)
	putCustomerRef(callArgs, "headerCustomerRef", sources.headerCustomerRef)
	putCustomerRef(callArgs, "mcpExtraCustomerRef", sources.mcpExtraCustomerRef)
	putCustomerRef(callArgs, "argsAuthCustomerRef", argsAuthCustomerRef(args))
	if raw, ok := args["customer_ref"].(string); ok {
		putCustomerRef(callArgs, "argsCustomerRef", raw)
	}
	raw, err := CallSync(ctx, "resolveCustomerRef", callArgs)
	if err != nil {
		return "", err
	}
	var ref string
	if err := json.Unmarshal(raw, &ref); err != nil {
		return "", err
	}
	if ref == "" || ref == "anonymous" {
		return "", fmt.Errorf("customer_ref missing from MCP auth context")
	}
	return ref, nil
}

func gateMessage(gate json.RawMessage) string {
	var parsed struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(gate, &parsed); err != nil {
		return solvapay.PaymentRequiredMessage
	}
	if parsed.Message == "" {
		return solvapay.PaymentRequiredMessage
	}
	return parsed.Message
}
