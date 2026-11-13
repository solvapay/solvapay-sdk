package solvapay

// What a paid MCP tool's handler receives and returns, and the tool results
// SolvaPay's own tools answer with. Ported from @solvapay/mcp-core
// (response-context.ts, response-envelope.ts, payable-handler.ts, helpers.ts).
//
// A handler gets a *ResponseContext and returns rc.Respond(data, …). The SDK
// turns that into the MCP tool result, the same shape the TypeScript SDK's
// buildPayableHandler produces.

import (
	"context"
	"encoding/json"
	"errors"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// NudgeKind is the kind of soft prompt a successful paid call can carry.
type NudgeKind string

const (
	NudgeLowBalance       NudgeKind = "low-balance"
	NudgeCycleEnding      NudgeKind = "cycle-ending"
	NudgeApproachingLimit NudgeKind = "approaching-limit"
)

// Nudge is a soft prompt appended to a successful result, such as a low
// balance. An empty Message takes the paywall's default copy.
type Nudge struct {
	Kind    NudgeKind
	Message string
}

// CustomerSnapshot is the customer as the limits check before this call saw
// them (up to the paywall's cache TTL old). Balance and Remaining are nil
// when the limits answer did not carry them.
type CustomerSnapshot struct {
	Ref           string
	Balance       *float64
	IsCreditBased bool
	Remaining     *float64
	WithinLimits  bool
	Overage       bool
	// Plan is {"reference": planRef} when the limits name a plan, else nil.
	Plan map[string]any

	refresh func(context.Context) (CustomerSnapshot, error)
}

// Fresh asks the API again, bypassing the paywall's cache.
func (c CustomerSnapshot) Fresh(ctx context.Context) (CustomerSnapshot, error) {
	return c.refresh(ctx)
}

func numberPointer(v any) *float64 {
	if n, ok := jsNum(v); ok {
		return &n
	}
	return nil
}

func customerSnapshot(customerRef string, limits, plan map[string]any, refresh func(context.Context) (CustomerSnapshot, error)) CustomerSnapshot {
	signals := readCreditSignals(limits)
	withinLimits := true
	if limits != nil {
		withinLimits = jsTruthy(jsGet(limits, "withinLimits"))
	}
	return CustomerSnapshot{
		Ref:           customerRef,
		Balance:       numberPointer(signals.creditBalance),
		IsCreditBased: signals.isCreditBased,
		Remaining:     numberPointer(jsGet(limits, "remaining")),
		WithinLimits:  withinLimits,
		Overage:       jsGet(limits, "overage") == true,
		Plan:          plan,
		refresh:       refresh,
	}
}

// ProductInfo names the product a paid call is for.
type ProductInfo struct {
	Reference string `json:"reference"`
	Name      string `json:"name"`
}

// ResponseContext is a paid tool's view of the customer and its way to answer.
type ResponseContext struct {
	Customer CustomerSnapshot
	Product  ProductInfo

	limits  map[string]any
	emitted []mcp.Content
}

func newResponseContext(client *Client, customerRef string, limits map[string]any, product string, freeLimit *FreeLimit) *ResponseContext {
	var plan map[string]any
	if ref, ok := jsNonEmptyString(jsGet(limits, "planRef")); ok {
		plan = map[string]any{"reference": ref}
	}
	var refresh func(context.Context) (CustomerSnapshot, error)
	refresh = func(ctx context.Context) (CustomerSnapshot, error) {
		body := map[string]any{"customerRef": customerRef, "productRef": product, "meterName": "requests"}
		if freeLimit != nil {
			body["meterName"] = freeLimit.Meter
			body["freeAllowance"] = freeLimit.wire()
		}
		fresh, err := client.CheckLimits(ctx, body)
		if err != nil {
			return CustomerSnapshot{}, err
		}
		return customerSnapshot(customerRef, fresh, plan, refresh), nil
	}
	return &ResponseContext{
		Customer: customerSnapshot(customerRef, limits, plan, refresh),
		Product:  ProductInfo{Reference: product, Name: product},
		limits:   limits,
	}
}

// RespondOptions shapes a paid tool's answer.
type RespondOptions struct {
	// Text, when set, replaces the JSON of the data in the first content
	// block ("" is a text too: the nudge, if any, is then the whole block).
	Text *string
	// Nudge appends a soft prompt.
	Nudge *Nudge
	// OmitDataText leaves the data out of the content when Text or Nudge is
	// set (by default it follows as a second JSON text block).
	OmitDataText bool
}

// ToolResponse is what Respond returns. Return it from the handler as is.
type ToolResponse struct {
	data    any
	options RespondOptions
	emitted []mcp.Content
	limits  map[string]any
}

// Respond is the tool's answer: data (anything that marshals to JSON) as
// text and, when it is an object, as structured content.
func (rc *ResponseContext) Respond(data any, options RespondOptions) *ToolResponse {
	return &ToolResponse{data: data, options: options, emitted: append([]mcp.Content{}, rc.emitted...), limits: rc.limits}
}

// Gate stops the call and shows a paywall instead: return the error it gives.
// An empty reason reads "Payment required".
func (rc *ResponseContext) Gate(reason string) error {
	if reason == "" {
		reason = "Payment required"
	}
	return NewPaywallError(map[string]any{
		"kind":        "payment_required",
		"product":     rc.Product.Reference,
		"checkoutUrl": "",
		"message":     reason,
	})
}

// Emit queues a content block (text, image or resource) ahead of the answer.
func (rc *ResponseContext) Emit(block mcp.Content) {
	rc.emitted = append(rc.emitted, block)
}

// ---- tool results ----------------------------------------------------------

// toolResult is toolResult: the data as JSON text and as structured content.
func toolResult(data any) (*mcp.CallToolResult, error) {
	text, err := jsonText(data)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, StructuredContent: data}, nil
}

// toolErrorResult is toolErrorResult: the recovery text first, the
// {error, status, details} envelope as structured content.
func toolErrorResult(message string, status int, details ...string) *mcp.CallToolResult {
	envelope := map[string]any{"error": message, "status": status}
	text := message
	if len(details) > 0 {
		envelope["details"] = details[0]
		text = details[0]
	}
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, StructuredContent: envelope, IsError: true}
}

// apiErrorResult answers an API failure with its status (500 without one)
// and message.
func apiErrorResult(err error) (*mcp.CallToolResult, error) {
	var sdkErr *Error
	if !errors.As(err, &sdkErr) {
		return nil, err
	}
	status := sdkErr.Status
	if status == 0 {
		status = 500
	}
	return toolErrorResult(sdkErr.Message, status, sdkErr.Message), nil
}

// errorResult is the TypeScript adapter's formatError, as a tool error:
// {"success": false, "error": message}, indented as JSON.stringify(…, null, 2).
func errorResult(message string) *mcp.CallToolResult {
	quoted, _ := marshalJS(message)
	text := "{\n  \"success\": false,\n  \"error\": " + string(quoted) + "\n}"
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}, IsError: true}
}

// gateResult is a paywall as a tool result: not an error, the message as
// text, the gate as structured content.
func gateResult(gate map[string]any) *mcp.CallToolResult {
	return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: jsString(gate["message"])}}, StructuredContent: gate}
}

// unwrap is the tool result for a ToolResponse, as the TypeScript SDK builds it.
func (r *ToolResponse) unwrap() (*mcp.CallToolResult, error) {
	dataText, err := jsonText(r.data)
	if err != nil {
		return nil, err
	}
	primary := dataText
	if r.options.Text != nil {
		primary = *r.options.Text
	}
	nudgeText := ""
	hasNudge := r.options.Nudge != nil
	if hasNudge {
		fallback := StateUpgradeRequired
		if r.options.Nudge.Kind == NudgeLowBalance && readCreditSignals(r.limits).isCreditBased {
			fallback = StateTopupRequired
		}
		nudgeText = r.options.Nudge.Message
		if nudgeText == "" {
			nudgeText = BuildNudgeMessage(fallback, r.limits)
		}
		if primary != "" {
			primary = primary + "\n\n" + nudgeText
		} else {
			primary = nudgeText
		}
	}
	content := append([]mcp.Content{}, r.emitted...)
	content = append(content, &mcp.TextContent{Text: primary})
	if (r.options.Text != nil || hasNudge) && !r.options.OmitDataText {
		content = append(content, &mcp.TextContent{Text: dataText})
	}
	if hasNudge {
		content = append(content, &mcp.EmbeddedResource{Resource: &mcp.ResourceContents{URI: "solvapay://nudge", MIMEType: "text/plain", Text: nudgeText}})
	}
	result := &mcp.CallToolResult{Content: content}
	if value, err := toJSONValue(r.data); err == nil {
		if object, ok := value.(map[string]any); ok {
			result.StructuredContent = object
		}
	}
	return result, nil
}

// decodeArguments reads a tool call's arguments as a JSON object ({} when absent).
func decodeArguments(req *mcp.CallToolRequest) (map[string]any, error) {
	args := map[string]any{}
	if req.Params == nil || len(req.Params.Arguments) == 0 {
		return args, nil
	}
	if err := json.Unmarshal(req.Params.Arguments, &args); err != nil {
		return nil, &Error{Code: "invalid_argument", Message: "The tool arguments are not a JSON object: " + err.Error()}
	}
	if args == nil {
		args = map[string]any{}
	}
	return args, nil
}

// textArg is `typeof x === 'string' && x ? x : undefined`, as "".
func textArg(args map[string]any, key string) string {
	text, _ := jsNonEmptyString(args[key])
	return text
}

// trimmedText is a string argument, trimmed as String.prototype.trim does; "" otherwise.
func trimmedText(args map[string]any, key string) string {
	text, _ := args[key].(string)
	return jsTrim(text)
}
