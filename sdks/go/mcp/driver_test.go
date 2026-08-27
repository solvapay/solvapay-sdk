package mcp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
)

func compileHandler(sc scenario) Handler {
	return func(ctx context.Context, _ map[string]any, rc *ResponseContext) (Response, error) {
		switch sc.Handler.Kind {
		case "throw":
			return Response{}, fmt.Errorf("%s", sc.Handler.Message)
		case "gate":
			return Response{}, rc.Gate(sc.Handler.Reason)
		case "respond":
			for _, block := range sc.Handler.Emit {
				if err := rc.Emit(block); err != nil {
					return Response{}, err
				}
			}
			return rc.Respond(sc.Handler.Data, sc.Handler.Options)
		default:
			return Response{}, fmt.Errorf("unreachable handler kind")
		}
	}
}

func callRegisteredPayable(t *testing.T, backend *mockBackend, sc scenario) (map[string]any, error) {
	t.Helper()
	ctx := context.Background()
	httpSrv := backend.server()
	t.Cleanup(httpSrv.Close)
	client, err := solvapay.NewClient(ctx, "sk_test", solvapay.WithBaseURL(httpSrv.URL))
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { _ = client.Close(ctx) })

	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "mcp-authoring-fixtures", Version: "v0.0.1"}, nil)
	opts := Options{
		Client:      client,
		Product:     sc.Product,
		Handler:     compileHandler(sc),
		Title:       sc.Tool.Title,
		Description: sc.Tool.Description,
		InputSchema: sc.Tool.InputSchema,
	}
	if sc.CustomerRefSource == "hook" {
		ref := sc.CustomerRef
		opts.GetCustomerRef = func(context.Context, map[string]any) (string, error) {
			return ref, nil
		}
	}
	if err := RegisterPayableTool(server, sc.Tool.Name, opts); err != nil {
		return nil, err
	}

	t1, t2 := mcpsdk.NewInMemoryTransports()
	if _, err := server.Connect(ctx, t1, nil); err != nil {
		return nil, err
	}
	mcpClient := mcpsdk.NewClient(&mcpsdk.Implementation{Name: "fixture-client", Version: "v0.0.1"}, nil)
	session, err := mcpClient.Connect(ctx, t2, nil)
	if err != nil {
		return nil, err
	}
	t.Cleanup(func() { _ = session.Close() })

	result, err := session.CallTool(ctx, &mcpsdk.CallToolParams{
		Name:      sc.Tool.Name,
		Arguments: sc.Tool.Args,
	})
	if err != nil {
		return nil, err
	}
	return projectToolResult(result)
}

func projectToolResult(result *mcpsdk.CallToolResult) (map[string]any, error) {
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
		kind, _ := sc["kind"].(string)
		if kind == "payment_required" || kind == "activation_required" {
			projected["isError"] = false
		}
	}
	return projected, nil
}

func toolResultsEqual(actual, expected map[string]any) bool {
	a := cloneMap(actual)
	e := cloneMap(expected)
	aErr := isErrorTrue(a)
	eErr := isErrorTrue(e)
	if aErr != eErr {
		return false
	}
	delete(a, "isError")
	delete(e, "isError")
	return reflect.DeepEqual(a, e)
}

func isErrorTrue(m map[string]any) bool {
	v, ok := m["isError"]
	if !ok {
		return false
	}
	b, _ := v.(bool)
	return b
}

func cloneMap(m map[string]any) map[string]any {
	raw, _ := json.Marshal(m)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return out
}

func TestReplaysFixture(t *testing.T) {
	root := lookupMcpFixtures(t)
	for _, rel := range registerPayableFixtures() {
		t.Run(rel, func(t *testing.T) {
			raw, err := os.ReadFile(filepath.Join(root, filepath.FromSlash(rel)))
			if err != nil {
				t.Fatal(err)
			}
			var env struct {
				Input struct {
					Args json.RawMessage `json:"args"`
				} `json:"input"`
				Expect struct {
					Result json.RawMessage `json:"result"`
				} `json:"expect"`
			}
			if err := json.Unmarshal(raw, &env); err != nil {
				t.Fatal(err)
			}
			sc, err := parseScenario(env.Input.Args)
			if err != nil {
				t.Fatal(err)
			}
			obs, err := parseObservation(env.Expect.Result)
			if err != nil {
				t.Fatal(err)
			}
			backend := newMockBackend(sc.Limits)
			toolResult, err := callRegisteredPayable(t, backend, sc)
			if err != nil {
				t.Fatalf("call: %v", err)
			}
			usage, err := projectUsage(backend.usage())
			if err != nil {
				t.Fatal(err)
			}
			if !toolResultsEqual(toolResult, obs.ToolResult) {
				got, _ := json.MarshalIndent(toolResult, "", "  ")
				want, _ := json.MarshalIndent(obs.ToolResult, "", "  ")
				t.Fatalf("toolResult mismatch\ngot:\n%s\nwant:\n%s", got, want)
			}
			wantUsage := usageToMaps(obs.Usage)
			if !reflect.DeepEqual(usage, wantUsage) {
				got, _ := json.MarshalIndent(usage, "", "  ")
				want, _ := json.MarshalIndent(wantUsage, "", "  ")
				t.Fatalf("usage mismatch\ngot:\n%s\nwant:\n%s", got, want)
			}
		})
	}
}

func usageToMaps(items []usageProjection) []map[string]any {
	out := make([]map[string]any, 0, len(items))
	for _, item := range items {
		raw, _ := json.Marshal(item)
		var m map[string]any
		_ = json.Unmarshal(raw, &m)
		out = append(out, m)
	}
	return out
}

func TestRegisterPayableToolRequiredFields(t *testing.T) {
	if err := RegisterPayableTool(nil, "x", Options{}); err == nil {
		t.Fatal("expected error for nil server")
	}
	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "t", Version: "v0"}, nil)
	if err := RegisterPayableTool(server, "x", Options{}); err == nil {
		t.Fatal("expected error for missing Client")
	}
}

func TestResponseContextPublicMembers(t *testing.T) {
	rc := &ResponseContext{}
	_ = rc.Customer
	_ = rc.Product
	_ = rc.Emit
	_ = rc.Respond
	_ = rc.Gate
}

func TestZeroResponseIsLoud(t *testing.T) {
	if (Response{}).valid() {
		t.Fatal("zero Response must not be valid")
	}
}

func TestOrderedErrorJSON(t *testing.T) {
	result, err := errorToolResult("boom")
	if err != nil {
		t.Fatal(err)
	}
	text := result.Content[0].(*mcpsdk.TextContent).Text
	want := "{\n  \"success\": false,\n  \"error\": \"boom\"\n}"
	if text != want {
		t.Fatalf("error JSON = %q, want %q", text, want)
	}
	if !bytes.Contains([]byte(text), []byte(`"success": false`)) {
		t.Fatal("expected success key first")
	}
}
