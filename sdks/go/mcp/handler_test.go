package mcp

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func newTestHandler(t *testing.T) (*Server, http.Handler) {
	t.Helper()
	srv := newTestServer(t)
	return srv, NewStreamableHandler(srv)
}

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
	meta["io.modelcontextprotocol/clientInfo"] = map[string]any{"name": "test-client", "version": "v0.0.1"}
	meta["io.modelcontextprotocol/clientCapabilities"] = map[string]any{}
	out["_meta"] = meta
	return out
}

func postMCP(t *testing.T, handler http.Handler, method string, params any, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
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
	if method == "resources/read" {
		if m, ok := params.(map[string]any); ok {
			if uri, _ := m["uri"].(string); uri != "" {
				req.Header.Set("Mcp-Name", uri)
			}
		}
	}
	req.RemoteAddr = "127.0.0.1:54321"
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	return rec
}

func decodeRPCResult(t *testing.T, rec *httptest.ResponseRecorder) map[string]any {
	t.Helper()
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	if parsed["error"] != nil {
		t.Fatalf("rpc error: %s", rec.Body.String())
	}
	result, _ := parsed["result"].(map[string]any)
	if result == nil {
		t.Fatalf("missing result: %s", rec.Body.String())
	}
	return result
}

func TestHandlerCacheEnvelope(t *testing.T) {
	_, handler := newTestHandler(t)
	cases := []struct {
		name   string
		method string
		params any
	}{
		{"tools/list", "tools/list", map[string]any{}},
		{"resources/list", "resources/list", map[string]any{}},
		{"prompts/list", "prompts/list", map[string]any{}},
		{"resources/read", "resources/read", map[string]any{"uri": "ui://widget.html"}},
		{"server/discover", "server/discover", map[string]any{
			"_meta": map[string]any{"io.modelcontextprotocol/protocolVersion": "2026-07-28"},
		}},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := postMCP(t, handler, tc.method, tc.params, nil)
			result := decodeRPCResult(t, rec)
			if result["resultType"] != "complete" {
				t.Fatalf("resultType = %#v", result["resultType"])
			}
			ttl, ok := result["ttlMs"].(float64)
			if !ok {
				t.Fatalf("ttlMs missing: %s", rec.Body.String())
			}
			if tc.method != "server/discover" && ttl <= 0 {
				t.Fatalf("ttlMs = %v, want > 0", ttl)
			}
			scope, _ := result["cacheScope"].(string)
			if scope != "public" && scope != "private" {
				t.Fatalf("cacheScope = %#v", result["cacheScope"])
			}
		})
	}
}

func TestHandlerResourcesReadFixesMCPJam(t *testing.T) {
	_, handler := newTestHandler(t)
	rec := postMCP(t, handler, "resources/read", map[string]any{"uri": "ui://widget.html"}, nil)
	result := decodeRPCResult(t, rec)
	if _, ok := result["ttlMs"].(float64); !ok {
		t.Fatalf("ttlMs = %#v", result["ttlMs"])
	}
	scope, _ := result["cacheScope"].(string)
	if scope != "public" && scope != "private" {
		t.Fatalf("cacheScope = %#v", result["cacheScope"])
	}
	contents, _ := result["contents"].([]any)
	if len(contents) == 0 {
		t.Fatal("empty contents")
	}
	first, _ := contents[0].(map[string]any)
	text, _ := first["text"].(string)
	if !strings.HasPrefix(strings.TrimSpace(text), "<") {
		t.Fatalf("expected HTML, got %q", trimForErr(text))
	}
}

func TestHandlerUnauthenticatedToolsCallChallenges(t *testing.T) {
	_, handler := newTestHandler(t)
	rec := postMCP(t, handler, "tools/call", map[string]any{
		"name":      "upgrade",
		"arguments": map[string]any{},
	}, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	www := rec.Header().Get("WWW-Authenticate")
	if !strings.Contains(www, `resource_metadata="`) {
		t.Fatalf("WWW-Authenticate = %q", www)
	}
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatal(err)
	}
	rpcErr, _ := parsed["error"].(map[string]any)
	if rpcErr["code"] != float64(-32001) {
		t.Fatalf("error = %#v", rpcErr)
	}
}

func TestHandlerNonLoopbackHostIsServed(t *testing.T) {
	_, handler := newTestHandler(t)
	body, _ := json.Marshal(map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "tools/list",
		"params":  withProtocolMeta(map[string]any{}),
	})
	req := httptest.NewRequest(http.MethodPost, "/mcp", bytes.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json, text/event-stream")
	req.Header.Set("MCP-Protocol-Version", "2026-07-28")
	req.Header.Set("Mcp-Method", "tools/list")
	req.Host = "weather.ngrok-free.app"
	req.RemoteAddr = "127.0.0.1:54321"
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code == http.StatusForbidden {
		t.Fatalf("localhost protection blocked ngrok Host: %s", rec.Body.String())
	}
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
}

func TestHandlerOAuthProtectedResourceDiscovery(t *testing.T) {
	_, handler := newTestHandler(t)
	req := httptest.NewRequest(http.MethodGet, "/.well-known/oauth-protected-resource", nil)
	rec := httptest.NewRecorder()
	handler.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "https://app.example.com") {
		t.Fatalf("discovery body: %s", rec.Body.String())
	}
}
