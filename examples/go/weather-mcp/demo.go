package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

type demoOptions struct {
	withinLimits bool
	city         string
	tool         string
	source       Source
}

type mcpServerRegistry struct {
	server *mcpsdk.Server
	client *solvapay.Client
}

func (r mcpServerRegistry) RegisterPayable(name string, opts solvapaymcp.Options) error {
	if opts.Client == nil {
		opts.Client = r.client
	}
	return solvapaymcp.RegisterPayableTool(r.server, name, opts)
}

func runDemo(ctx context.Context, opts demoOptions) (map[string]any, error) {
	tool := opts.tool
	if tool == "" {
		tool = toolCurrentWeather
	}
	remaining := 0
	if opts.withinLimits {
		remaining = 5
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits": opts.withinLimits,
				"remaining":    remaining,
				"meterName":    "requests",
				"checkoutUrl":  "https://pay.example/x",
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			_, _ = io.Copy(io.Discard, r.Body)
			_, _ = w.Write([]byte(`{"reference":"usg_demo"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			_, _ = w.Write([]byte(`{"reference":"cus_demo","email":"demo@example.com"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	defer srv.Close()

	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(srv.URL))
	if err != nil {
		return nil, err
	}
	defer func() { _ = client.Close(ctx) }()

	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "weather-mcp", Version: "v0.0.1"}, nil)
	src := opts.source
	if src == nil {
		src = newFixtureSource("fixtures/wttr-london.json")
	}
	if err := registerTools(mcpServerRegistry{server: server, client: client}, src, "prd_demo",
		func(context.Context, map[string]any) (string, error) {
			return "cus_demo", nil
		},
	); err != nil {
		return nil, err
	}

	t1, t2 := mcpsdk.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		return nil, err
	}
	mcpClient := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "example-client", Version: "v0.0.1"}, nil)
	session, err := mcpClient.Connect(ctx, t2, nil)
	if err != nil {
		return nil, err
	}
	defer func() { _ = session.Close() }()

	result, err := session.CallTool(ctx, &mcpsdk.CallToolParams{
		Name:      tool,
		Arguments: map[string]any{"city": opts.city},
	})
	if err != nil {
		return nil, err
	}
	return projectCallToolResult(result)
}

func projectCallToolResult(result *mcpsdk.CallToolResult) (map[string]any, error) {
	raw, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var dumped map[string]any
	if err := json.Unmarshal(raw, &dumped); err != nil {
		return nil, err
	}
	projected := map[string]any{"content": dumped["content"]}
	if sc, ok := dumped["structuredContent"]; ok {
		projected["structuredContent"] = sc
	}
	if dumped["isError"] == true {
		projected["isError"] = true
	} else if dumped["isError"] == false {
		projected["isError"] = false
	} else if sc, ok := dumped["structuredContent"].(map[string]any); ok {
		if kind, _ := sc["kind"].(string); kind == "payment_required" || kind == "activation_required" {
			projected["isError"] = false
		}
	}
	return projected, nil
}
