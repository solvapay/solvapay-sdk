package solvapay

// RegisterPayable and RegisterFree: a merchant's own paid and free tools.
// Ported from @solvapay/mcp (registerPayableTool.ts, registerFreeTool.ts)
// and @solvapay/mcp-core (payable-handler.ts).
//
// Each call is checked against the customer's plan first: a call that may go
// ahead runs the handler and records the usage; one that may not answers the
// paywall (isError false, the message as text, the gate as
// structuredContent). The customer comes from the verified access token, or
// from PaidTool.GetCustomerRef. A call with no customer is refused: a tool
// argument is never trusted as the customer, and there is no anonymous
// fallback.

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// PaidToolHint is what a paid tool's description ends with.
const PaidToolHint = "Paid tool — call `account` for current balance and cost per call."

// PaidToolHandler answers one allowed call. args are the call's arguments,
// already checked against the tool's input schema. Return rc.Respond(…), or
// rc.Gate(reason) as the error to show a paywall instead. Any other error is
// answered as a tool error with its message.
type PaidToolHandler func(ctx context.Context, args json.RawMessage, rc *ResponseContext) (*ToolResponse, error)

// PaidTool describes a merchant tool for RegisterPayable or RegisterFree.
type PaidTool struct {
	Handler     PaidToolHandler
	Description string
	Title       string
	// Annotations override the defaults (read-only and open-world) hint by hint.
	Annotations *ToolAnnotations
	Meta        mcp.Meta
	// InputSchema is the arguments' JSON Schema (a map, a json.RawMessage or
	// a *jsonschema.Schema) with type object; nil means no arguments.
	InputSchema any
	// Product; "" means the server's product.
	Product string
	// GetCustomerRef overrides who the customer is for this tool.
	GetCustomerRef CustomerRefFunc
}

// FreeToolDescriptionSuffix is what a free tool's description ends with.
func FreeToolDescriptionSuffix(limit FreeLimit, sharedWith []string) string {
	window := "lifetime"
	if limit.Scope != "lifetime" {
		window = fmt.Sprintf("%d days", limit.WindowDays)
	}
	base := fmt.Sprintf("Free tool — %d calls per %s, then a plan is required. Call `account` for remaining usage.", limit.Cap, window)
	if len(sharedWith) == 0 {
		return base
	}
	names := make([]string, len(sharedWith))
	for i, name := range sharedWith {
		names[i] = "`" + name + "`"
	}
	return base + " Shares a free allowance with " + strings.Join(names, ", ") + "."
}

func withHint(description, hint string) string {
	if description == "" {
		return hint
	}
	return strings.TrimRightFunc(description, isJSWhitespace) + " " + hint
}

// RegisterPayable adds a paid tool on the server's product (or tool.Product):
// each call is checked against the customer's plan.
func (s *MCPServer) RegisterPayable(name string, tool PaidTool) error {
	return s.registerPaid(name, tool, nil, withHint(tool.Description, PaidToolHint))
}

// RegisterFree adds a free tool: limit.Cap calls per window, then a plan is
// required. Tools that name the same meter must declare the same limit.
func (s *MCPServer) RegisterFree(name string, limit FreeLimit, tool PaidTool) error {
	normalised, err := limit.normalised()
	if err != nil {
		return err
	}
	s.mu.Lock()
	meter, shared := s.freeMeters[normalised.Meter]
	var sharedWith []string
	if shared {
		if meter.limit != normalised {
			s.mu.Unlock()
			return newError("invalid_free_limit", fmt.Sprintf("Free tools '%s' and '%s' declare meter '%s' with different caps",
				strings.Join(meter.tools, ", "), name, normalised.Meter))
		}
		sharedWith = append(sharedWith, meter.tools...)
	}
	s.mu.Unlock()
	if err := s.registerPaid(name, tool, &normalised, withHint(tool.Description, FreeToolDescriptionSuffix(normalised, sharedWith))); err != nil {
		return err
	}
	s.mu.Lock()
	if shared {
		meter.tools = append(meter.tools, name)
	} else {
		s.freeMeters[normalised.Meter] = &freeMeter{limit: normalised, tools: []string{name}}
	}
	s.mu.Unlock()
	return nil
}

func (s *MCPServer) registerPaid(name string, tool PaidTool, freeLimit *FreeLimit, description string) error {
	if tool.Handler == nil {
		return newError("invalid_handler", fmt.Sprintf("The tool %s needs a Handler", name))
	}
	product, err := s.paywall.requireProduct(tool.Product)
	if tool.Product == "" {
		product, err = s.productRef, nil
	}
	if err != nil {
		return err
	}
	// Read-only and open-world unless the merchant says otherwise.
	annotations := ToolAnnotations{ReadOnlyHint: Hint(true), OpenWorldHint: Hint(true)}.over(tool.Annotations)
	return s.addTool(toolSpec{
		name:        name,
		title:       tool.Title,
		description: description,
		annotations: annotations,
		meta:        withResourceURIKey(tool.Meta),
		inputSchema: tool.InputSchema,
		handler: func(ctx context.Context, req *mcp.CallToolRequest, _ map[string]any) (*mcp.CallToolResult, error) {
			customerRef, err := s.customerRef(ctx, req, tool.GetCustomerRef)
			if err != nil {
				return nil, err
			}
			if customerRef == "" {
				if freeLimit != nil {
					// registerFreeTool's answer, before the paywall runs.
					return toolErrorResult("Unauthorized", 401, unauthorizedDetails), nil
				}
				return errorResult(name + " needs a signed-in customer: connect to this server with OAuth first."), nil
			}
			decision, err := s.paywall.Decide(ctx, DecideParams{CustomerRef: customerRef, Product: product, FreeLimit: freeLimit, ToolName: name})
			if err != nil {
				return errorResult(errorMessage(err)), nil
			}
			if decision.Gate != nil {
				return gateResult(decision.Gate), nil
			}
			rc := newResponseContext(s.client, decision.CustomerRef, decision.Limits, product, freeLimit)
			var response *ToolResponse
			args := json.RawMessage("{}")
			if req.Params != nil && len(req.Params.Arguments) > 0 {
				args = req.Params.Arguments
			}
			err = s.paywall.RunAllow(ctx, decision, RunParams{Product: product, FreeLimit: freeLimit, ToolName: name}, func(ctx context.Context) error {
				var handlerErr error
				response, handlerErr = tool.Handler(ctx, args, rc)
				if handlerErr == nil && response == nil {
					handlerErr = newError("invalid_handler", fmt.Sprintf("The tool %s answered no response: return rc.Respond(…)", name))
				}
				return handlerErr
			})
			var gated *PaywallError
			if errors.As(err, &gated) {
				return gateResult(gated.Gate), nil
			}
			if err != nil {
				// The TypeScript adapter's formatError, as a tool error.
				return errorResult(errorMessage(err)), nil
			}
			return response.unwrap()
		},
	})
}

// errorMessage is an error's text for a person: an *Error's Message, else err.Error().
func errorMessage(err error) string {
	var sdkErr *Error
	if errors.As(err, &sdkErr) {
		return sdkErr.Message
	}
	return err.Error()
}
