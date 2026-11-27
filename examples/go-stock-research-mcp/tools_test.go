package main

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync/atomic"
	"testing"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-sdk/go"
)

var researchToolArgs = map[string][]string{
	"top_ranked_assets":      nil,
	"company_brief":          {"symbol"},
	"research_top_assets":    nil,
	"verify_catalyst_claims": nil,
	"detect_stale_rankings":  nil,
	"compare_symbols":        {"symbols"},
}

// fakeAPI answers /v1/sdk/limits with limits and counts the billed calls
// (usage records with outcome "success"; a refusal is recorded as "paywall").
func fakeAPI(t *testing.T, limits string) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	var usages atomic.Int32
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/sdk/limits":
			_, _ = io.WriteString(w, limits)
		case "/v1/sdk/usages":
			var usage struct {
				Outcome string `json:"outcome"`
			}
			if err := json.NewDecoder(r.Body).Decode(&usage); err != nil {
				t.Errorf("usage body: %v", err)
			}
			if usage.Outcome == "success" {
				usages.Add(1)
			}
			_, _ = io.WriteString(w, `{"success":true}`)
		default:
			t.Errorf("unexpected API call %s %s", r.Method, r.URL.Path)
			w.WriteHeader(http.StatusNotFound)
		}
	}))
	t.Cleanup(api.Close)
	return api, &usages
}

func connect(t *testing.T, apiURL string) *mcp.ClientSession {
	t.Helper()
	client, err := solvapay.NewClient(solvapay.Config{APIKey: "sk_sandbox_test", APIBaseURL: apiURL})
	if err != nil {
		t.Fatal(err)
	}
	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
		Client: client, ProductRef: "prd_1", PublicBaseURL: "https://mcp.test",
	})
	if err != nil {
		t.Fatal(err)
	}
	customer := func(context.Context, mcp.Request) (string, error) { return "cus_1", nil }
	if err := registerTools(server, StubMarketData{Dir: "fixtures"}, customer); err != nil {
		t.Fatal(err)
	}
	serverTransport, clientTransport := mcp.NewInMemoryTransports()
	ctx := context.Background()
	if _, err := server.Server().Connect(ctx, serverTransport, nil); err != nil {
		t.Fatal(err)
	}
	session, err := mcp.NewClient(&mcp.Implementation{Name: "test", Version: "1"}, nil).Connect(ctx, clientTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = session.Close() })
	return session
}

func call(t *testing.T, session *mcp.ClientSession, name string, args map[string]any) (*mcp.CallToolResult, map[string]any) {
	t.Helper()
	result, err := session.CallTool(context.Background(), &mcp.CallToolParams{Name: name, Arguments: args})
	if err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(result.StructuredContent)
	if err != nil {
		t.Fatal(err)
	}
	var structured map[string]any
	_ = json.Unmarshal(raw, &structured)
	return result, structured
}

func TestEveryToolIsPaidAndHasItsSchema(t *testing.T) {
	api, _ := fakeAPI(t, `{}`)
	session := connect(t, api.URL)
	list, err := session.ListTools(context.Background(), nil)
	if err != nil {
		t.Fatal(err)
	}
	tools := map[string]*mcp.Tool{}
	for _, tool := range list.Tools {
		tools[tool.Name] = tool
	}
	for _, builtIn := range []string{"account", "activate_plan"} {
		if tools[builtIn] == nil {
			t.Errorf("SolvaPay's %s tool is missing", builtIn)
		}
	}
	for name, wantRequired := range researchToolArgs {
		tool := tools[name]
		if tool == nil {
			t.Errorf("%s is not listed", name)
			continue
		}
		schema, _ := json.Marshal(tool.InputSchema)
		var parsed struct {
			Required []string `json:"required"`
		}
		_ = json.Unmarshal(schema, &parsed)
		if !slices.Equal(parsed.Required, wantRequired) {
			t.Errorf("%s requires %v, want %v", name, parsed.Required, wantRequired)
		}
		if !strings.Contains(tool.Description, "Paid tool") || !strings.Contains(tool.Description, "not financial advice") {
			t.Errorf("%s description %q lacks the paid hint or disclaimer", name, tool.Description)
		}
	}
}

func TestAPaidCallReturnsResearchAndBillsOneUnit(t *testing.T) {
	api, usages := fakeAPI(t, `{"withinLimits":true,"remaining":10,"meterName":"requests"}`)
	session := connect(t, api.URL)
	result, structured := call(t, session, "company_brief", map[string]any{"symbol": "aapl"})
	if result.IsError {
		t.Fatalf("tool error: %+v", result.Content)
	}
	if structured["symbol"] != "AAPL" {
		t.Fatalf("symbol %v, want AAPL", structured["symbol"])
	}
	if got := usages.Load(); got != 1 {
		t.Fatalf("%d usage records, want 1", got)
	}
}

func TestACustomerOutOfCallsGetsThePaywall(t *testing.T) {
	api, usages := fakeAPI(t, `{"withinLimits":false,"remaining":0,"checkoutUrl":"https://pay.test/c"}`)
	session := connect(t, api.URL)
	result, structured := call(t, session, "research_top_assets", map[string]any{})
	if structured["kind"] != "payment_required" {
		t.Fatalf("kind %v, want payment_required", structured["kind"])
	}
	text := result.Content[0].(*mcp.TextContent).Text
	if !strings.Contains(text, "[Open checkout](https://pay.test/c)") {
		t.Fatalf("paywall text %q has no checkout link", text)
	}
	if got := usages.Load(); got != 0 {
		t.Fatalf("%d calls billed for a refused call", got)
	}
}

func TestCompareReportsUnknownTickers(t *testing.T) {
	api, _ := fakeAPI(t, `{"withinLimits":true,"remaining":10,"meterName":"requests"}`)
	session := connect(t, api.URL)
	_, structured := call(t, session, "compare_symbols", map[string]any{"symbols": []string{"AAPL", "BOGUSXYZ"}})
	statuses := map[string]any{}
	for _, row := range structured["symbols"].([]any) {
		obj := row.(map[string]any)
		statuses[obj["symbol"].(string)] = obj["status"]
	}
	if statuses["AAPL"] != "ok" || statuses["BOGUSXYZ"] != "not_found" || len(statuses) != 2 {
		t.Fatalf("statuses %v", statuses)
	}
}

func TestEveryToolAnswersFromFixtures(t *testing.T) {
	api, usages := fakeAPI(t, `{"withinLimits":true,"remaining":10,"meterName":"requests"}`)
	session := connect(t, api.URL)
	args := map[string]map[string]any{
		"company_brief":   {"symbol": "DELL"},
		"compare_symbols": {"symbols": []string{"AAPL", "GE"}},
	}
	for name := range researchToolArgs {
		result, _ := call(t, session, name, args[name])
		if result.IsError {
			t.Errorf("%s: %+v", name, result.Content[0])
		}
	}
	if got := usages.Load(); got != int32(len(researchToolArgs)) {
		t.Fatalf("%d usage records, want %d", got, len(researchToolArgs))
	}
}
