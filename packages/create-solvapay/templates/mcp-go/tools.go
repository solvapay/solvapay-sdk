package main

// The tools this server offers. Replace the placeholder work with yours.
//
// The work lives in plain functions (answer, about) so tests can call it
// without SolvaPay; the handlers wrap it with rc.Respond.

import (
	"context"
	"encoding/json"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// answer is the paid tool's work.
func answer(query string) map[string]any {
	return map[string]any{"query": query, "answer": "Replace this with the real answer to: " + query}
}

// about is the free tool's work.
func about() map[string]any {
	return map[string]any{"server": "__SERVER_NAME__", "paid": "__TOOL_NAME__", "free": "about"}
}

func registerTools(server *solvapay.MCPServer) error {
	// Paid: each call is checked against the customer's plan before the
	// handler runs. Without a plan, the customer gets the paywall instead.
	err := server.RegisterPayable("__TOOL_NAME__", solvapay.PaidTool{
		Title:       "__TOOL_NAME__",
		Description: "Answers a query. Replace this description with what the tool does.",
		InputSchema: map[string]any{
			"type": "object",
			"properties": map[string]any{
				"query": map[string]any{"type": "string", "description": "What to look up."},
			},
			"required": []any{"query"},
		},
		Handler: func(_ context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
			var in struct {
				Query string `json:"query"`
			}
			if err := json.Unmarshal(args, &in); err != nil {
				return nil, err
			}
			return rc.Respond(answer(in.Query), solvapay.RespondOptions{}), nil
		},
	})
	if err != nil {
		return err
	}

	// Free up to a cap per customer, then the same paywall as a paid tool.
	return server.RegisterFree("about", solvapay.FreeLimit{
		Cap:        20,
		Scope:      "rolling_window",
		WindowDays: 30,
	}, solvapay.PaidTool{
		Description: "What this server offers.",
		Handler: func(_ context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
			return rc.Respond(about(), solvapay.RespondOptions{}), nil
		},
	})
}
