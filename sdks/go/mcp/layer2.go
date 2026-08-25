package mcp

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/solvapay/solvapay-go/internal/nativecall"
)

func callLayer2(ctx context.Context, fn string, args any) (json.RawMessage, error) {
	raw, err := json.Marshal(args)
	if err != nil {
		return nil, err
	}
	value, err := nativecall.CallValueJSON(ctx, fn, string(raw))
	if err != nil {
		return nil, err
	}
	if len(value) == 0 || string(value) == "null" {
		return nil, fmt.Errorf("native %s returned empty value", fn)
	}
	return value, nil
}

func paywallToolResult(ctx context.Context, message string, gate json.RawMessage) (json.RawMessage, error) {
	if len(gate) == 0 {
		gate = json.RawMessage(`{}`)
	}
	type args struct {
		Message           string          `json:"message"`
		StructuredContent json.RawMessage `json:"structuredContent"`
	}
	return callLayer2(ctx, "sv_paywall_tool_result_binding", args{Message: message, StructuredContent: gate})
}

func makeResponseResult(ctx context.Context, data json.RawMessage, options map[string]any, emitted []json.RawMessage) (json.RawMessage, error) {
	payload := map[string]any{"data": data}
	if options != nil {
		payload["options"] = options
	}
	if len(emitted) > 0 {
		payload["emittedBlocks"] = emitted
	}
	return callLayer2(ctx, "sv_make_response_result_binding", payload)
}

func assertResponseResult(ctx context.Context, value json.RawMessage) (json.RawMessage, error) {
	return callLayer2(ctx, "sv_assert_response_result_binding", map[string]any{"value": value})
}

func buildPayableToolResult(ctx context.Context, envelope json.RawMessage) (json.RawMessage, error) {
	return callLayer2(ctx, "sv_build_payable_tool_result_binding", map[string]any{"envelope": envelope})
}
