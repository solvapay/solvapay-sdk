package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

const testBearer = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9."
const testPublicOrigin = "https://weather.example.test"

func withProtocolMeta(params any) map[string]any {
	out := map[string]any{}
	if m, ok := params.(map[string]any); ok {
		for k, v := range m {
			out[k] = v
		}
	}
	meta, _ := out["_meta"].(map[string]any)
	if meta == nil {
		meta = map[string]any{}
	}
	meta["io.modelcontextprotocol/protocolVersion"] = "2026-07-28"
	meta["io.modelcontextprotocol/clientInfo"] = map[string]any{"name": "weather-test", "version": "v0.0.1"}
	meta["io.modelcontextprotocol/clientCapabilities"] = map[string]any{}
	out["_meta"] = meta
	return out
}

func postMCP(handler http.Handler, method string, params any, headers map[string]string) *httptest.ResponseRecorder {
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  method,
		"params":  withProtocolMeta(params),
	})
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", method)
	if method == "tools/call" {
		if m, ok := params.(map[string]any); ok {
			if name, _ := m["name"].(string); name != "" {
				req.Header.Set("Mcp-Name", name)
			}
		}
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func newTestHandler(t *testing.T) http.Handler {
	t.Helper()
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits":  true,
				"remaining":     42,
				"plan":          "pl_pro",
				"creditBalance": 5000,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			_, _ = io.Copy(io.Discard, r.Body)
			_, _ = w.Write([]byte(`{"reference":"usg_test","outcome":"success"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			_, _ = w.Write([]byte(`{"reference":"cus_1","email":"a@example.com"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(backend.Close)

	client, err := solvapay.NewClient(context.Background(), "sk_test", solvapay.WithBaseURL(backend.URL))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(context.Background()) })

	handler, err := newHTTPHandler(client, httpServeConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: testPublicOrigin,
		Source:        newFixtureSource("fixtures/wttr-london.json"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return handler
}

func TestPostMcpToolsCallReturnsJSONRPCResult(t *testing.T) {
	rec := postMCP(newTestHandler(t), "tools/call", map[string]any{
		"name":      toolCurrentWeather,
		"arguments": map[string]any{"city": "London"},
	}, map[string]string{"Authorization": testBearer})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	result, _ := parsed["result"].(map[string]any)
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["temperatureC"] != float64(12) {
		t.Fatalf("structuredContent = %#v", sc)
	}
}

func TestGetCurrentWeatherGatesAgainstBearerCustomer(t *testing.T) {
	var limitsRefs []string
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		switch {
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits":
			body, _ := io.ReadAll(r.Body)
			var payload map[string]any
			_ = json.Unmarshal(body, &payload)
			if ref, _ := payload["customerRef"].(string); ref != "" {
				limitsRefs = append(limitsRefs, ref)
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits":  true,
				"remaining":     42,
				"plan":          "pl_pro",
				"creditBalance": 5000,
			})
		case r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages":
			_, _ = io.Copy(io.Discard, r.Body)
			_, _ = w.Write([]byte(`{"reference":"usg_test","outcome":"success"}`))
		case r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers":
			_, _ = w.Write([]byte(`{"reference":"cus_1","email":"a@example.com"}`))
		default:
			http.NotFound(w, r)
		}
	}))
	t.Cleanup(backend.Close)

	client, err := solvapay.NewClient(context.Background(), "sk_test", solvapay.WithBaseURL(backend.URL))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(context.Background()) })

	handler, err := newHTTPHandler(client, httpServeConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: testPublicOrigin,
		Source:        newFixtureSource("fixtures/wttr-london.json"),
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := postMCP(handler, "tools/call", map[string]any{
		"name":      toolCurrentWeather,
		"arguments": map[string]any{"city": "London"},
	}, map[string]string{"Authorization": testBearer})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["error"] != nil {
		t.Fatalf("rpc error: %s", rec.Body.String())
	}
	if len(limitsRefs) == 0 {
		t.Fatal("expected /v1/sdk/limits to be called")
	}
	for _, ref := range limitsRefs {
		if ref == "anonymous" {
			t.Fatal("weather tool gated as anonymous; OAuth bearer identity was dropped")
		}
		if !strings.HasPrefix(ref, "cus_") {
			t.Fatalf("limits customerRef = %q, want cus_*", ref)
		}
	}
}

func TestOptionsMcpReturnsPreflightForBrowserOrigin(t *testing.T) {
	req := httptest.NewRequest(http.MethodOptions, "/mcp", nil)
	req.Header.Set("Origin", "http://localhost:6274")
	req.Header.Set("Access-Control-Request-Method", "POST")
	rec := httptest.NewRecorder()
	newTestHandler(t).ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("status %d, want 204", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:6274" {
		t.Fatalf("Allow-Origin = %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
	if rec.Header().Get("Access-Control-Allow-Methods") == "" {
		t.Fatal("missing Access-Control-Allow-Methods")
	}
}

func TestUnauthenticatedToolsCallChallengesWithCors(t *testing.T) {
	rec := postMCP(newTestHandler(t), "tools/call", map[string]any{
		"name":      toolCurrentWeather,
		"arguments": map[string]any{"city": "London"},
	}, map[string]string{"Origin": "http://localhost:6274"})
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	www := rec.Header().Get("WWW-Authenticate")
	if !strings.Contains(www, "resource_metadata=") {
		t.Fatalf("WWW-Authenticate = %q", www)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:6274" {
		t.Fatalf("Allow-Origin = %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestGetMcpReturns405WithCors(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/mcp", nil)
	req.Header.Set("Origin", "http://localhost:6274")
	rec := httptest.NewRecorder()
	newTestHandler(t).ServeHTTP(rec, req)
	if rec.Code != http.StatusMethodNotAllowed {
		t.Fatalf("status %d, want 405", rec.Code)
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:6274" {
		t.Fatalf("Allow-Origin = %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestProtectedResourceDiscoveryIsReachable(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil)
	rec := httptest.NewRecorder()
	newTestHandler(t).ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), testPublicOrigin) {
		t.Fatalf("discovery body missing %s: %s", testPublicOrigin, rec.Body.String())
	}
}

func TestHealthAndRootRoutes(t *testing.T) {
	handler := newTestHandler(t)

	health := httptest.NewRecorder()
	handler.ServeHTTP(health, httptest.NewRequest(http.MethodGet, "/health", nil))
	if health.Code != http.StatusOK {
		t.Fatalf("health status %d", health.Code)
	}

	root := httptest.NewRecorder()
	handler.ServeHTTP(root, httptest.NewRequest(http.MethodGet, "/", nil))
	if root.Code != http.StatusNotFound {
		t.Fatalf("root status %d", root.Code)
	}
	if !strings.Contains(root.Body.String(), "/mcp") {
		t.Fatalf("root body should name /mcp: %s", root.Body.String())
	}
}

func TestToolsListIncludesWeatherTools(t *testing.T) {
	rec := postMCP(newTestHandler(t), "tools/list", map[string]any{}, nil)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	result, _ := parsed["result"].(map[string]any)
	tools, _ := result["tools"].([]any)
	have := map[string]bool{}
	for _, item := range tools {
		tool, _ := item.(map[string]any)
		name, _ := tool["name"].(string)
		have[name] = true
	}
	if !have[toolCurrentWeather] || !have[toolForecast] {
		t.Fatalf("weather tools missing from tools/list: %v", have)
	}
	if result["resultType"] != "complete" {
		t.Fatalf("tools/list missing resultType=complete: %s", rec.Body.String())
	}
	if _, ok := result["ttlMs"].(float64); !ok {
		t.Fatalf("tools/list missing ttlMs: %s", rec.Body.String())
	}
	if scope, _ := result["cacheScope"].(string); scope != "public" && scope != "private" {
		t.Fatalf("tools/list cacheScope = %v", result["cacheScope"])
	}
	for _, item := range tools {
		tool, _ := item.(map[string]any)
		if tool["title"] == nil {
			t.Fatalf("tool %q has null title", tool["name"])
		}
	}
}

func TestPayableGateFailureStaysJSONRPC(t *testing.T) {
	backend := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits" {
			w.WriteHeader(http.StatusNotFound)
			_, _ = w.Write([]byte(`{"message":"Customer not found: cus_1","statusCode":404}`))
			return
		}
		if r.Method == http.MethodGet && r.URL.Path == "/v1/sdk/customers" {
			_, _ = w.Write([]byte(`{"customerRef":"cus_1"}`))
			return
		}
		http.NotFound(w, r)
	}))
	t.Cleanup(backend.Close)
	client, err := solvapay.NewClient(context.Background(), "sk_test", solvapay.WithBaseURL(backend.URL))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(context.Background()) })
	handler, err := newHTTPHandler(client, httpServeConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: testPublicOrigin,
		Source:        newFixtureSource("fixtures/wttr-london.json"),
	})
	if err != nil {
		t.Fatal(err)
	}

	rec := postMCP(handler, "tools/call", map[string]any{
		"name":      toolCurrentWeather,
		"arguments": map[string]any{"city": "London"},
	}, map[string]string{"Authorization": testBearer})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d (want 200 JSON-RPC), body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	rpcErr, _ := parsed["error"].(map[string]any)
	if rpcErr["message"] == nil {
		t.Fatalf("expected JSON-RPC error, got %s", rec.Body.String())
	}
}

func TestServerDiscoverReturnsCompleteResult(t *testing.T) {
	rec := postMCP(newTestHandler(t), "server/discover", map[string]any{}, map[string]string{
		"Origin": "http://localhost:6274",
	})
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["error"] != nil {
		t.Fatalf("discover error: %s", rec.Body.String())
	}
	result, _ := parsed["result"].(map[string]any)
	if result["resultType"] != "complete" {
		t.Fatalf("resultType = %v", result["resultType"])
	}
	if rec.Header().Get("Access-Control-Allow-Origin") != "http://localhost:6274" {
		t.Fatalf("missing CORS on discover: %q", rec.Header().Get("Access-Control-Allow-Origin"))
	}
}

func TestNotificationInitializedReturns202(t *testing.T) {
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"method":  "notifications/initialized",
		"params":  withProtocolMeta(map[string]any{}),
	})
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "notifications/initialized")
	rec := httptest.NewRecorder()
	newTestHandler(t).ServeHTTP(rec, req)
	if rec.Code != http.StatusAccepted {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestLoggingSetLevelReturnsJSONRPCNot502(t *testing.T) {
	// logging/setLevel is deprecated under 2026-07-28 (SEP-2577). The
	// official SDK may answer method-not-found; the important contract is
	// that the response stays JSON-RPC and never HTTP 5xx.
	rec := postMCP(newTestHandler(t), "logging/setLevel", map[string]any{"level": "info"}, nil)
	if rec.Code == http.StatusBadGateway || rec.Code >= 500 {
		t.Fatalf("HTTP %d drops MCPJam; body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if parsed["error"] == nil && parsed["result"] == nil {
		t.Fatalf("expected JSON-RPC result or error, got %s", rec.Body.String())
	}
}

func TestUnknownMethodIsJSONRPCNot502(t *testing.T) {
	rec := postMCP(newTestHandler(t), "subscriptions/listen", map[string]any{}, nil)
	if rec.Code == http.StatusBadGateway {
		t.Fatalf("HTTP 502 drops MCPJam; body %s", rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	rpcErr, _ := parsed["error"].(map[string]any)
	if rpcErr == nil {
		t.Fatalf("expected JSON-RPC error, got %s", rec.Body.String())
	}
}
