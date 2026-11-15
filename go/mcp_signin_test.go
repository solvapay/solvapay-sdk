package solvapay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// A signed-in request reaches the MCP server as the customer SolvaPay's
// userinfo names, and the account tool's built-in tools see that customer.
// (No conformance case covers the verified path: the cases have no live token.)
func TestMCPHandlerServesAVerifiedCustomer(t *testing.T) {
	userinfoCalls := 0
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/customer/auth/userinfo":
			userinfoCalls++
			if r.Header.Get("Authorization") != "Bearer "+testToken {
				w.WriteHeader(http.StatusUnauthorized)
				return
			}
			_, _ = io.WriteString(w, `{"sub":"cus_VERIFIED","email":"a@example.com"}`)
		case "/v1/sdk/purchases":
			if got := r.URL.Query().Get("customerRef"); got != "cus_VERIFIED" {
				t.Errorf("purchases for %q, want the verified customer", got)
			}
			_, _ = io.WriteString(w, `{"purchases":[]}`)
		case "/v1/sdk/credits/activity":
			_, _ = io.WriteString(w, `{"entries":[],"hasMore":false}`)
		default:
			t.Errorf("unexpected API call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	defer api.Close()
	client, err := NewClient(Config{APIKey: "sk_test", APIBaseURL: api.URL})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewMCPServer(MCPServerOptions{Client: client, ProductRef: "prd_1", PublicBaseURL: "https://mcp.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	handler := server.Handler()
	post := func(session, body string) *http.Response {
		r := httptest.NewRequest(http.MethodPost, "https://mcp.example.com/mcp", strings.NewReader(body))
		r.Header.Set("Authorization", "Bearer "+testToken)
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Accept", "application/json, text/event-stream")
		if session != "" {
			r.Header.Set("Mcp-Session-Id", session)
			r.Header.Set("Mcp-Protocol-Version", "2025-06-18")
		}
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, r)
		return w.Result()
	}
	init := post("", `{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`)
	if init.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(init.Body)
		t.Fatalf("initialize: %d %s", init.StatusCode, body)
	}
	session := init.Header.Get("Mcp-Session-Id")
	post(session, `{"jsonrpc":"2.0","method":"notifications/initialized"}`)
	call := post(session, `{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"get_history","arguments":{}}}`)
	body, _ := io.ReadAll(call.Body)
	if call.StatusCode != http.StatusOK || !strings.Contains(string(body), `\"charges\":[]`) {
		t.Fatalf("tools/call: %d %s", call.StatusCode, body)
	}
	if userinfoCalls != 1 {
		t.Fatalf("userinfo asked %d times; a verified token is cached", userinfoCalls)
	}
}

var testToken = func() string {
	payload, _ := json.Marshal(map[string]any{"sub": "cus_CLAIMED"})
	return "eyJhbGciOiJIUzI1NiJ9." + base64.RawURLEncoding.EncodeToString(payload) + ".sig"
}()

// Behind a tunnel or reverse proxy on the same machine (ngrok, cloudflared,
// nginx), a request reaches the server on a loopback address with the public
// Host. It is served like any other: the MCP endpoint answers nothing without
// a token SolvaPay verified, as in TypeScript and Python.
func TestMCPHandlerServesBehindALocalProxy(t *testing.T) {
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/v1/customer/auth/userinfo" {
			t.Errorf("unexpected API call %s %s", r.Method, r.URL.Path)
		}
		_, _ = io.WriteString(w, `{"sub":"cus_VERIFIED"}`)
	}))
	defer api.Close()
	client, err := NewClient(Config{APIKey: "sk_test", APIBaseURL: api.URL})
	if err != nil {
		t.Fatal(err)
	}
	server, err := NewMCPServer(MCPServerOptions{Client: client, ProductRef: "prd_1", PublicBaseURL: "https://mcp.example.com"})
	if err != nil {
		t.Fatal(err)
	}
	r := httptest.NewRequest(http.MethodPost, "https://mcp.example.com/mcp",
		strings.NewReader(`{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"test","version":"1"}}}`))
	r.Header.Set("Authorization", "Bearer "+testToken)
	r.Header.Set("Content-Type", "application/json")
	r.Header.Set("Accept", "application/json, text/event-stream")
	r = r.WithContext(context.WithValue(r.Context(), http.LocalAddrContextKey, &net.TCPAddr{IP: net.IPv4(127, 0, 0, 1), Port: 3062}))
	w := httptest.NewRecorder()
	server.Handler().ServeHTTP(w, r)
	if w.Code != http.StatusOK {
		t.Fatalf("initialize behind a local proxy: %d %s", w.Code, w.Body.String())
	}
}
