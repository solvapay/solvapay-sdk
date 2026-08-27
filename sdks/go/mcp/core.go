package mcp

import (
	"context"
	"encoding/json"

	"github.com/solvapay/solvapay-go/internal/nativecall"
)

// CallSync invokes a Rust MCP op through the wazero guest (`sv_solvapay_call_binding`).
func CallSync(ctx context.Context, op string, args any) (json.RawMessage, error) {
	payload := map[string]any{"op": op, "args": args}
	raw, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}
	return nativecall.CallValueJSON(ctx, "sv_solvapay_call_binding", string(raw))
}
