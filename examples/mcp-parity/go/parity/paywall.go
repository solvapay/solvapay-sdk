package parity

import (
	"context"
	"encoding/json"
	"log"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

// PaywallServer is the paywall server with get_quote; the agents command puts
// the agent route in front of it.
func PaywallServer(publicBaseURL, name string) *solvapay.MCPServer {
	for _, setting := range []string{"SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"} {
		Required(setting)
	}
	client, err := solvapay.NewClient(solvapay.Config{})
	if err != nil {
		log.Fatal(err)
	}
	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
		Client:        client,
		PublicBaseURL: publicBaseURL,
		Name:          name,
		ResourceURI:   "ui://mcp-parity/mcp-app.html",
	})
	if err != nil {
		log.Fatal(err)
	}
	err = server.RegisterPayable("get_quote", solvapay.PaidTool{
		Title:       "Get quote",
		Description: "A made-up price for a ticker symbol. One unit per call.",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"symbol": map[string]any{"type": "string", "minLength": 1, "maxLength": 8}},
			"required":   []any{"symbol"},
		},
		Handler: func(_ context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
			var in struct{ Symbol string }
			if err := json.Unmarshal(args, &in); err != nil {
				return nil, err
			}
			return rc.Respond(Quote(in.Symbol), solvapay.RespondOptions{}), nil
		},
	})
	if err != nil {
		log.Fatal(err)
	}
	return server
}
