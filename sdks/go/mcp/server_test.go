package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"strings"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

const testBearerCus1 = "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9."
const testBearerNoIdentity = "Bearer eyJhbGciOiJub25lIn0.e30."

func newTestServer(t *testing.T) *Server {
	t.Helper()
	backend := newMockBackend(map[string]any{
		"withinLimits":  true,
		"remaining":     42,
		"plan":          "pl_pro",
		"creditBalance": 5000,
	})
	httpSrv := backend.server()
	t.Cleanup(httpSrv.Close)
	client := newTestClient(t, httpSrv.URL)
	srv, err := NewServer(context.Background(), client, ServerConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: "https://app.example.com",
		ResourceURI:   "ui://widget.html",
		ServerName:    "test-mcp",
		ServerVersion: "v0.0.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	return srv
}

func connectTestSession(t *testing.T, srv *Server) *mcpsdk.ClientSession {
	t.Helper()
	ctx := context.Background()
	t1, t2 := mcpsdk.NewInMemoryTransports()
	if _, err := srv.MCP.Connect(ctx, t1, nil); err != nil {
		t.Fatal(err)
	}
	client := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "test-client", Version: "v0.0.1"}, nil)
	session, err := client.Connect(ctx, t2, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func TestResourcesReadReturnsWidgetHTML(t *testing.T) {
	srv := newTestServer(t)
	session := connectTestSession(t, srv)

	result, err := session.ReadResource(context.Background(), &mcpsdk.ReadResourceParams{
		URI: "ui://widget.html",
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(result.Contents) == 0 {
		t.Fatal("empty contents")
	}
	text := result.Contents[0].Text
	if !strings.HasPrefix(strings.TrimSpace(text), "<") {
		t.Fatalf("expected HTML, got %q", trimForErr(text))
	}
	if text != DefaultMCPAppHTML() {
		t.Fatal("contents text != DefaultMCPAppHTML()")
	}
	t.Run("_meta.ui.csp present on read contents", func(t *testing.T) {
		assertUIMetaCSP(t, result.Contents[0].Meta)
	})
}

func TestResourcesListIncludesWidgetCSP(t *testing.T) {
	srv := newTestServer(t)
	session := connectTestSession(t, srv)

	listed, err := session.ListResources(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	var widget *mcpsdk.Resource
	for _, r := range listed.Resources {
		if r.URI == "ui://widget.html" {
			widget = r
			break
		}
	}
	if widget == nil {
		t.Fatal("widget resource missing from resources/list")
	}
	assertUIMetaCSP(t, widget.Meta)
}

func assertUIMetaCSP(t *testing.T, meta mcpsdk.Meta) {
	t.Helper()
	if meta == nil {
		t.Fatal("missing _meta")
	}
	ui, _ := meta["ui"].(map[string]any)
	if ui == nil {
		t.Fatalf("_meta.ui missing: %#v", meta)
	}
	csp, _ := ui["csp"].(map[string]any)
	if csp == nil {
		t.Fatalf("_meta.ui.csp missing: %#v", ui)
	}
	if _, ok := csp["resourceDomains"]; !ok {
		t.Fatalf("csp.resourceDomains missing: %#v", csp)
	}
}

func trimForErr(s string) string {
	if len(s) > 120 {
		return s[:120] + "…"
	}
	return s
}

func TestBuiltinUpgradeToolCall(t *testing.T) {
	env := loadFixtureJSON(t, "builtin-tools/upgrade.json")
	backend := fixtureHTTP(t, env)
	if backend == nil {
		t.Fatal("expected fixture HTTP stubs")
	}
	t.Cleanup(backend.Close)
	client := newTestClient(t, backend.URL)
	srv, err := NewServer(context.Background(), client, ServerConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: "https://app.example.com",
		ResourceURI:   "ui://test/view.html",
	})
	if err != nil {
		t.Fatal(err)
	}
	handler := NewStreamableHandler(srv)
	rec := postMCP(t, handler, "tools/call", map[string]any{
		"name":      "upgrade",
		"arguments": map[string]any{"mode": "text"},
	}, map[string]string{
		"Authorization": "Bearer eyJhbGciOiJub25lIn0.eyJzdWIiOiJjdXNfMSJ9.",
	})
	result := decodeRPCResult(t, rec)
	content, _ := result["content"].([]any)
	if len(content) == 0 {
		t.Fatalf("empty content: %s", rec.Body.String())
	}
	first, _ := content[0].(map[string]any)
	text, _ := first["text"].(string)
	if !strings.Contains(text, "Upgrade") {
		t.Fatalf("unexpected content text: %q", text)
	}
	meta, _ := result["_meta"].(map[string]any)
	ui, _ := meta["ui"].(map[string]any)
	if ui["resourceUri"] != "ui://test/view.html" {
		t.Fatalf("resourceUri = %#v meta=%#v", ui["resourceUri"], meta)
	}
}

func TestPayableToolsListContainsBoth(t *testing.T) {
	srv := newTestServer(t)
	if err := srv.RegisterPayable("get_current_weather", Options{
		Client:  srv.client,
		Product: "prd_demo",
		Title:   "Get current weather",
		Handler: func(_ context.Context, args map[string]any, rc *ResponseContext) (Response, error) {
			return rc.Respond(map[string]any{"ok": true}, nil)
		},
	}); err != nil {
		t.Fatal(err)
	}
	session := connectTestSession(t, srv)
	listed, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	have := map[string]string{}
	for _, tool := range listed.Tools {
		have[tool.Name] = tool.Title
	}
	if _, ok := have["upgrade"]; !ok {
		t.Fatal("missing builtin upgrade")
	}
	if title := have["get_current_weather"]; title == "" {
		t.Fatalf("payable missing or empty title: %#v", have)
	}
}

func registerEchoPaid(t *testing.T, srv *Server) {
	t.Helper()
	if err := srv.RegisterPayable("echo_paid", Options{
		Product: "prd_demo",
		Title:   "Echo",
		Handler: func(_ context.Context, args map[string]any, rc *ResponseContext) (Response, error) {
			return rc.Respond(map[string]any{"echo": args["n"]}, nil)
		},
	}); err != nil {
		t.Fatal(err)
	}
}

func newPayableHTTP(t *testing.T) (*mockBackend, http.Handler) {
	t.Helper()
	backend := newMockBackend(map[string]any{
		"withinLimits":  true,
		"remaining":     42,
		"plan":          "pl_pro",
		"creditBalance": 5000,
	})
	httpSrv := backend.server()
	t.Cleanup(httpSrv.Close)
	client := newTestClient(t, httpSrv.URL)
	srv, err := NewServer(context.Background(), client, ServerConfig{
		ProductRef:    "prd_demo",
		PublicBaseURL: "https://app.example.com",
		ResourceURI:   "ui://widget.html",
		ServerName:    "test-mcp",
		ServerVersion: "v0.0.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	registerEchoPaid(t, srv)
	return backend, NewStreamableHandler(srv)
}

func TestPayableToolCallRoutesToInvokePayable(t *testing.T) {
	backend, handler := newPayableHTTP(t)
	rec := postMCP(t, handler, "tools/call", map[string]any{
		"name":      "echo_paid",
		"arguments": map[string]any{"n": 7},
	}, map[string]string{
		"Authorization": testBearerCus1,
	})
	result := decodeRPCResult(t, rec)
	sc, _ := result["structuredContent"].(map[string]any)
	if sc["echo"] != float64(7) {
		t.Fatalf("structuredContent = %#v", sc)
	}
	calls := backend.limitsCalls()
	if len(calls) == 0 {
		t.Fatal("expected /v1/sdk/limits to be called")
	}
	for _, body := range calls {
		if body["customerRef"] == "anonymous" {
			t.Fatal("limits gated as anonymous; bearer identity was dropped")
		}
		if body["customerRef"] != "cus_1" {
			t.Fatalf("limits customerRef = %#v, want cus_1", body["customerRef"])
		}
	}
}

func TestPayableToolCallRejectsBearerWithoutIdentity(t *testing.T) {
	backend, handler := newPayableHTTP(t)
	rec := postMCP(t, handler, "tools/call", map[string]any{
		"name":      "echo_paid",
		"arguments": map[string]any{"n": 7},
	}, map[string]string{
		"Authorization": testBearerNoIdentity,
	})
	var parsed map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &parsed); err != nil {
		t.Fatalf("decode body: %v (%s)", err, rec.Body.String())
	}
	rpcErr, _ := parsed["error"].(map[string]any)
	msg, _ := rpcErr["message"].(string)
	if !strings.Contains(msg, "echo_paid") || !strings.Contains(msg, "customer identity") {
		t.Fatalf("expected loud identity error, got %s", rec.Body.String())
	}
	if calls := backend.limitsCalls(); len(calls) != 0 {
		t.Fatalf("limits must not run without identity: %#v", calls)
	}
}

func TestPayableToolCallUnauthenticatedChallenges(t *testing.T) {
	_, handler := newPayableHTTP(t)
	rec := postMCP(t, handler, "tools/call", map[string]any{
		"name":      "echo_paid",
		"arguments": map[string]any{"n": 7},
	}, nil)
	if rec.Code != http.StatusUnauthorized {
		t.Fatalf("status %d body %s", rec.Code, rec.Body.String())
	}
	www := rec.Header().Get("WWW-Authenticate")
	if !strings.Contains(www, `resource_metadata="`) {
		t.Fatalf("WWW-Authenticate = %q", www)
	}
}
