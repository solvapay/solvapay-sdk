package mcp

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	solvapay "github.com/solvapay/solvapay-go"
)

func asyncOpFixtures() []string {
	var out []string
	for _, rel := range mcpAuthoringFixtures {
		if isAsyncClientFixture(rel) {
			out = append(out, rel)
		}
	}
	return out
}

func loadFixtureJSON(t *testing.T, rel string) map[string]any {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(lookupMcpFixtures(t), filepath.FromSlash(rel)))
	if err != nil {
		t.Fatal(err)
	}
	var env map[string]any
	if err := json.Unmarshal(raw, &env); err != nil {
		t.Fatal(err)
	}
	return env
}

func inputArgs(env map[string]any) map[string]any {
	input, _ := env["input"].(map[string]any)
	args, _ := input["args"].(map[string]any)
	if args == nil {
		return map[string]any{}
	}
	return args
}

func expectResult(env map[string]any) any {
	expect, _ := env["expect"].(map[string]any)
	return expect["result"]
}

func fixtureHTTP(t *testing.T, env map[string]any) *httptest.Server {
	t.Helper()
	expect, _ := env["expect"].(map[string]any)
	result, _ := expect["result"].(map[string]any)
	if result["status"] == float64(502) {
		if body, _ := result["body"].(map[string]any); body["error"] == "upstream_unreachable" {
			return nil
		}
	}
	stubs, _ := env["http"].([]any)
	input, _ := env["input"].(map[string]any)
	if input["fn"] == "mcpBootstrap" && len(stubs) == 0 {
		stubs = []any{
			map[string]any{"method": "GET", "path": "/v1/sdk/platform-config", "status": float64(200), "body": map[string]any{"stripePublishableKey": "pk_test"}},
			map[string]any{"method": "GET", "path": "/v1/sdk/merchant", "status": float64(200), "body": map[string]any{"displayName": "Acme"}},
			map[string]any{"method": "GET", "path": "/v1/sdk/products/prd_demo", "status": float64(200), "body": map[string]any{"name": "Demo"}},
			map[string]any{"method": "GET", "path": "/v1/sdk/products/prd_demo/plans", "status": float64(200), "body": map[string]any{"plans": []any{map[string]any{"name": "Pro"}}}},
		}
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		if r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/limits" {
			_ = json.NewEncoder(w).Encode(map[string]any{
				"withinLimits": true, "remaining": 42, "plan": "pl_pro", "creditBalance": 5000,
			})
			return
		}
		if r.Method == http.MethodPost && r.URL.Path == "/v1/sdk/usages" {
			_, _ = w.Write([]byte(`{"reference":"usg_test","outcome":"success"}`))
			return
		}
		for _, raw := range stubs {
			stub, _ := raw.(map[string]any)
			if stub["method"] == r.Method && stub["path"] == r.URL.Path {
				status := int(stub["status"].(float64))
				w.WriteHeader(status)
				_ = json.NewEncoder(w).Encode(stub["body"])
				return
			}
		}
		http.NotFound(w, r)
	}))
}

func newTestClient(t *testing.T, base string) *solvapay.Client {
	t.Helper()
	ctx := context.Background()
	client, err := solvapay.NewClient(ctx, "sk_test_fixture", solvapay.WithBaseURL(base))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = client.Close(ctx) })
	return client
}

func TestReplaysAsyncOps(t *testing.T) {
	ctx := context.Background()
	for _, rel := range asyncOpFixtures() {
		t.Run(rel, func(t *testing.T) {
			env := loadFixtureJSON(t, rel)
			input, _ := env["input"].(map[string]any)
			fn, _ := input["fn"].(string)
			args := inputArgs(env)
			want := expectResult(env)
			srv := fixtureHTTP(t, env)
			base := "http://127.0.0.1:1"
			if srv != nil {
				t.Cleanup(srv.Close)
				base = srv.URL
			}
			client := newTestClient(t, base)
			var (
				got any
				err error
			)
			switch fn {
			case "mcpCallBuiltinTool":
				got, err = client.McpCallBuiltinTool(ctx, args)
			case "mcpOauthRequest":
				got, err = client.McpOauthRequest(ctx, args)
			case "mcpDispatch":
				got, err = client.McpDispatch(ctx, args)
			case "mcpBootstrap":
				got, err = client.McpBootstrap(ctx, args)
			default:
				t.Fatalf("unexpected fn %s", fn)
			}
			if err != nil {
				t.Fatal(err)
			}
			assertAsyncResult(t, rel, fn, got, want, srv)
		})
	}
}

func assertAsyncResult(t *testing.T, rel, fn string, got, want any, srv *httptest.Server) {
	t.Helper()
	if fn == "mcpOauthRequest" {
		gotMap := asMap(got)
		wantMap := asMap(want)
		if gotMap["status"] != wantMap["status"] {
			t.Fatalf("status got %#v want %#v", gotMap["status"], wantMap["status"])
		}
		if !reflect.DeepEqual(gotMap["body"], wantMap["body"]) {
			t.Fatalf("body mismatch\ngot %#v\nwant %#v", gotMap["body"], wantMap["body"])
		}
		if strings.Contains(rel, "authorize") {
			loc, _ := asString(asMap(gotMap["headers"])["location"])
			if !strings.HasSuffix(loc, "/v1/customer/auth/authorize?client_id=abc") {
				t.Fatalf("location %q base %s", loc, srv.URL)
			}
			return
		}
		for k, v := range asMap(wantMap["headers"]) {
			if asMap(gotMap["headers"])[k] != v {
				t.Fatalf("header %s got %#v want %#v", k, asMap(gotMap["headers"])[k], v)
			}
		}
		return
	}
	if (fn == "mcpDispatch") && strings.HasSuffix(rel, "invoke-handler.json") {
		gotMap := asMap(got)
		wantMap := asMap(want)
		if gotMap["kind"] != "invokeHandler" {
			t.Fatalf("kind = %v", gotMap["kind"])
		}
		if gotMap["tool"] != wantMap["tool"] || !reflect.DeepEqual(gotMap["args"], wantMap["args"]) || gotMap["customerRef"] != wantMap["customerRef"] {
			t.Fatalf("invokeHandler mismatch\ngot %#v\nwant %#v", gotMap, wantMap)
		}
		token, _ := gotMap["token"].(string)
		if len(token) < 8 {
			t.Fatalf("token too short: %q", token)
		}
		return
	}
	if !reflect.DeepEqual(got, want) {
		if reflect.DeepEqual(normalizeJSONTextBlocks(got), normalizeJSONTextBlocks(want)) {
			return
		}
		g, _ := json.MarshalIndent(got, "", "  ")
		w, _ := json.MarshalIndent(want, "", "  ")
		t.Fatalf("mismatch\ngot:\n%s\nwant:\n%s", g, w)
	}
}

func normalizeJSONTextBlocks(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var parsed any
	if err := json.Unmarshal(raw, &parsed); err != nil {
		return v
	}
	walkJSONText(parsed)
	return parsed
}

func walkJSONText(v any) {
	switch typed := v.(type) {
	case map[string]any:
		if text, ok := typed["text"].(string); ok && (strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[")) {
			var inner any
			if json.Unmarshal([]byte(text), &inner) == nil {
				typed["text"] = inner
			}
		}
		for _, child := range typed {
			walkJSONText(child)
		}
	case []any:
		for _, child := range typed {
			walkJSONText(child)
		}
	}
}

func stringOr(v any, fallback string) string {
	if s, ok := v.(string); ok && s != "" {
		return s
	}
	return fallback
}
