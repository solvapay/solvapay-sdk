package main

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"

	solvapay "github.com/solvapay/solvapay-go"
	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

type demoOptions struct {
	withinLimits bool
	city         string
	tool         string
	source       Source
	args         map[string]any
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
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
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
	defer backend.Close()

	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(backend.URL))
	if err != nil {
		return nil, err
	}
	defer func() { _ = client.Close(ctx) }()

	src := opts.source
	if src == nil {
		src = newFixtureSource()
	}
	server, err := newSolvaPayServer(ctx, client, "prd_demo", "https://weather.example.test", src,
		func(context.Context, map[string]any) (string, error) {
			return "cus_demo", nil
		},
		fixtureHs256Secret,
	)
	if err != nil {
		return nil, err
	}
	handler := solvapaymcp.NewStreamableHandler(server)

	listedRec := postMCP(handler, "tools/list", map[string]any{}, nil)
	listed, err := decodeJSONRPCResult(listedRec)
	if err != nil {
		return nil, fmt.Errorf("tools/list: %w", err)
	}
	tools, _ := listed["tools"].([]any)
	names := make([]string, 0, len(tools))
	for _, item := range tools {
		toolItem, _ := item.(map[string]any)
		if name, _ := toolItem["name"].(string); name != "" {
			names = append(names, name)
		}
	}

	arguments := opts.args
	if arguments == nil {
		arguments = map[string]any{"city": opts.city}
	}
	callRec := postMCP(handler, "tools/call", map[string]any{
		"name":      tool,
		"arguments": arguments,
	}, map[string]string{"Authorization": demoBearer})
	call, err := decodeJSONRPCResult(callRec)
	if err != nil {
		return nil, fmt.Errorf("tools/call: %w", err)
	}
	projected := projectCallToolMap(call)
	projected["tools"] = names
	return projected, nil
}

func decodeJSONRPCResult(rec *httptest.ResponseRecorder) (map[string]any, error) {
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		return nil, fmt.Errorf("HTTP %d: %s", rec.Code, rec.Body.String())
	}
	if rpcErr, ok := parsed["error"].(map[string]any); ok {
		return nil, fmt.Errorf("%v", rpcErr["message"])
	}
	result, _ := parsed["result"].(map[string]any)
	if result == nil {
		return nil, fmt.Errorf("HTTP %d missing result: %s", rec.Code, rec.Body.String())
	}
	return result, nil
}

func projectCallToolMap(result map[string]any) map[string]any {
	projected := map[string]any{"content": result["content"]}
	if sc, ok := result["structuredContent"]; ok {
		projected["structuredContent"] = sc
	}
	if result["isError"] == true {
		projected["isError"] = true
	} else if result["isError"] == false {
		projected["isError"] = false
	} else if sc, ok := result["structuredContent"].(map[string]any); ok {
		if kind, _ := sc["kind"].(string); kind == "payment_required" || kind == "activation_required" {
			projected["isError"] = false
		}
	}
	return projected
}
