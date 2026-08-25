package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

func run(ctx context.Context, withinLimits bool, message string) (map[string]any, error) {
	remaining := 0
	if withinLimits {
		remaining = 5
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits": withinLimits,
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

	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "paid-mcp-example", Version: "v0.0.1"}, nil)
	if err := solvapaymcp.RegisterPayableTool(server, "echo_paid", solvapaymcp.Options{
		Client:  client,
		Product: "prd_demo",
		Title:   "Echo paid",
		Handler: func(_ context.Context, args map[string]any, rc *solvapaymcp.ResponseContext) (solvapaymcp.Response, error) {
			text := message
			if v, ok := args["text"].(string); ok && v != "" {
				text = v
			}
			return rc.Respond(map[string]any{"echo": text}, nil)
		},
		GetCustomerRef: func(context.Context, map[string]any) (string, error) {
			return "cus_demo", nil
		},
	}); err != nil {
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
		Name:      "echo_paid",
		Arguments: map[string]any{"text": message},
	})
	if err != nil {
		return nil, err
	}
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

func main() {
	gate := flag.Bool("gate", false, "force a paywall result")
	message := flag.String("message", "hello", "echo payload")
	flag.Parse()
	dumped, err := run(context.Background(), !*gate, *message)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
	enc := json.NewEncoder(os.Stdout)
	enc.SetIndent("", "  ")
	_ = enc.Encode(dumped)
}
