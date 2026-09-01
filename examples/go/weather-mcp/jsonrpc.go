package main

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
)

const fixtureHs256Secret = "solvapay-mcp-fixture-hs256-secret-32b!!"
const demoBearer = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJpc3MiOiJodHRwczovL3dlYXRoZXIuZXhhbXBsZS50ZXN0IiwiYXVkIjoiaHR0cHM6Ly93ZWF0aGVyLmV4YW1wbGUudGVzdC9tY3AiLCJleHAiOjQxMDI0NDQ4MDAsInN1YiI6ImN1c19kZW1vIn0.QoVuKIIYOeg12mZSdk7Plgvx7erXzk69uV46BfWmrN8"

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
