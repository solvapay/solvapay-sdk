package mcp

import (
	"context"
	"encoding/json"
	"fmt"
)

// Response is the branded envelope from ResponseContext.Respond.
// The payload field is unexported so a merchant handler cannot fabricate one.
type Response struct {
	payload json.RawMessage
}

func (r Response) valid() bool {
	return len(r.payload) > 0
}

// CustomerView is the merchant-facing customer snapshot on ResponseContext.
type CustomerView struct {
	Ref          string `json:"ref"`
	Balance      any    `json:"balance"`
	Remaining    any    `json:"remaining"`
	WithinLimits any    `json:"withinLimits"`
	Plan         any    `json:"plan"`
}

// ProductView is the read-only product projection on ResponseContext.
type ProductView struct {
	Reference string `json:"reference"`
	Name      string `json:"name"`
}

// GateSignal is returned from ResponseContext.Gate; the adapter detects it with errors.As.
type GateSignal struct {
	Reason string
	Gate   json.RawMessage
}

func (g *GateSignal) Error() string {
	if g == nil || g.Reason == "" {
		return "Payment required"
	}
	return g.Reason
}

// ResponseContext is the merchant-facing payable context (respond / gate / emit).
type ResponseContext struct {
	Customer CustomerView
	Product  ProductView

	ctx        context.Context
	productRef string
	emitted    []json.RawMessage
}

// Emit queues a content block flushed before the text block at Respond time.
func (rc *ResponseContext) Emit(block map[string]any) error {
	raw, err := json.Marshal(block)
	if err != nil {
		return err
	}
	rc.emitted = append(rc.emitted, raw)
	return nil
}

// Respond produces the branded allow envelope via layer-2 makeResponseResult.
func (rc *ResponseContext) Respond(data any, options map[string]any) (Response, error) {
	dataJSON, err := marshalData(data)
	if err != nil {
		return Response{}, err
	}
	payload, err := makeResponseResult(rc.ctx, dataJSON, options, append([]json.RawMessage(nil), rc.emitted...))
	if err != nil {
		return Response{}, err
	}
	return Response{payload: payload}, nil
}

// Gate stops the handler and formats a paywall result. Default reason is Payment required.
func (rc *ResponseContext) Gate(reason string) error {
	args := map[string]any{"product": rc.productRef}
	if reason != "" {
		args["reason"] = reason
	}
	gate, err := CallSync(rc.ctx, "mcpDefaultGate", args)
	if err != nil {
		return err
	}
	var parsed struct {
		Message string `json:"message"`
	}
	if err := json.Unmarshal(gate, &parsed); err != nil {
		return err
	}
	message := parsed.Message
	if message == "" {
		message = "Payment required"
	}
	return &GateSignal{Reason: message, Gate: gate}
}

func marshalData(data any) (json.RawMessage, error) {
	switch d := data.(type) {
	case json.RawMessage:
		if len(d) == 0 {
			return json.RawMessage("null"), nil
		}
		return d, nil
	case []byte:
		if json.Valid(d) {
			return json.RawMessage(d), nil
		}
	}
	raw, err := json.Marshal(data)
	if err != nil {
		return nil, fmt.Errorf("respond data: %w", err)
	}
	return raw, nil
}
