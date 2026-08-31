package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
)

func TestStdioServerListsSolvaPayIntentTools(t *testing.T) {
	ctx := context.Background()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits": true,
				"remaining":    5,
				"meterName":    "requests",
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
	t.Cleanup(backend.Close)

	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(backend.URL))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(ctx) })

	server, err := buildStdioServer(ctx, client, "prd_demo", testPublicOrigin, newFixtureSource())
	if err != nil {
		t.Fatal(err)
	}

	t1, t2 := mcpsdk.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		t.Fatal(err)
	}
	mcpClient := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "example-client", Version: "v0.0.1"}, nil)
	session, err := mcpClient.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })

	listed, err := session.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	have := map[string]bool{}
	for _, tool := range listed.Tools {
		have[tool.Name] = true
	}
	for _, name := range []string{"upgrade", "manage_account", "topup", "activate_plan"} {
		if !have[name] {
			t.Fatalf("stdio tools/list missing %s; have %v", name, have)
		}
	}
}
