package main

import (
	"context"

	solvapaymcp "github.com/solvapay/solvapay-sdk/sdks/go/mcp"
)

func registerTools(srv *solvapaymcp.Server, product string) error {
	return srv.RegisterPayable("__TOOL_NAME__", solvapaymcp.Options{
		Product:     product,
		Title:       "__TOOL_NAME__",
		Description: "Placeholder paid tool — echoes the input message so you can verify the paywall is wired before writing real logic. 1 credit per call; when gated, text-only narration names `account` (or `activate_plan` when a planRef is known).",
		InputSchema: map[string]any{"message": map[string]any{"type": "string"}},
		Handler: func(ctx context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
			message := "hello"
			if raw, ok := args["message"].(string); ok && raw != "" {
				message = raw
			}
			return rc.Respond(map[string]any{"ok": true, "echoed": message}, nil)
		},
	})
}
