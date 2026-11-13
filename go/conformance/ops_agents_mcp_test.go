package conformance

// Suite agent-mcp: the MCP route agents call (agents.MCPRoute), driven with
// real HTTP requests to an httptest server, one route for the whole case.
// Mirrors conformance/runners/typescript/src/agent-mcp-ops.ts and
// python/conformance_runner/conformance_agent_mcp.py.
//
// agentMcpRoute builds the route from args.route, args.tools and
// args.freeTools, sends args.requests in order, and returns what each one got
// and every SolvaPay API call the route made. agentRefusalStatuses maps
// refusal reasons to the HTTP status an API answers with.

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"time"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/solvapay/solvapay-sdk/go/agents"
)

// A paid call's request id is a random UUID, the one value a case can't fix.
// Each becomes <uuid-N>, numbered by first appearance.
var uuidPattern = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func withoutUUIDs(value any, seen map[string]string) any {
	switch v := value.(type) {
	case string:
		if !uuidPattern.MatchString(v) {
			return v
		}
		if _, ok := seen[v]; !ok {
			seen[v] = fmt.Sprintf("<uuid-%d>", len(seen)+1)
		}
		return seen[v]
	case []any:
		out := make([]any, len(v))
		for i, item := range v {
			out[i] = withoutUUIDs(item, seen)
		}
		return out
	case map[string]any:
		keys := make([]string, 0, len(v))
		for k := range v {
			keys = append(keys, k)
		}
		sort.Strings(keys)
		out := map[string]any{}
		for _, k := range keys {
			out[k] = withoutUUIDs(v[k], seen)
		}
		return out
	}
	return value
}

// ---- the parts of an answer a case compares -------------------------------------

var schemaKeys = []string{"type", "description", "minimum", "maximum", "minLength", "maxLength"}

func comparableSchema(schema any) map[string]any {
	node, _ := schema.(map[string]any)
	out := map[string]any{}
	for _, key := range schemaKeys {
		if value, ok := node[key]; ok {
			out[key] = value
		}
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		reduced := map[string]any{}
		for name, value := range properties {
			reduced[name] = comparableSchema(value)
		}
		out["properties"] = reduced
		required := []string{}
		if list, ok := node["required"].([]any); ok {
			for _, name := range list {
				required = append(required, name.(string))
			}
		}
		sort.Strings(required)
		out["required"] = required
	}
	return out
}

func parsedJSONText(value any) (any, bool) {
	text, ok := value.(string)
	if !ok || !(strings.HasPrefix(text, "{") || strings.HasPrefix(text, "[")) {
		return nil, false
	}
	parsed, err := decodeJSON([]byte(text))
	return parsed, err == nil
}

// comparableMessage is one JSON-RPC message from the MCP server, reduced to
// what a host reads.
func comparableMessage(message map[string]any) map[string]any {
	out := map[string]any{"id": message["id"]}
	if raw, ok := message["error"]; ok && raw != nil {
		e, _ := raw.(map[string]any)
		// Only the route's own errors (-32001) carry a message the SDKs share.
		if fmt.Sprint(e["code"]) == "-32001" {
			out["error"] = e
		} else {
			out["error"] = map[string]any{"code": e["code"]}
		}
		return out
	}
	result, _ := message["result"].(map[string]any)
	if tools, ok := result["tools"].([]any); ok {
		var reduced []any
		for _, item := range tools {
			tool := item.(map[string]any)
			entry := map[string]any{"inputSchema": comparableSchema(tool["inputSchema"])}
			for _, key := range []string{"name", "title", "description", "annotations"} {
				if value, ok := tool[key]; ok {
					entry[key] = value
				}
			}
			reduced = append(reduced, entry)
		}
		sort.Slice(reduced, func(i, j int) bool {
			return reduced[i].(map[string]any)["name"].(string) < reduced[j].(map[string]any)["name"].(string)
		})
		out["result"] = map[string]any{"tools": reduced}
	} else if info, ok := result["serverInfo"].(map[string]any); ok {
		out["result"] = map[string]any{"serverInfo": map[string]any{"name": info["name"], "version": info["version"]}}
	} else if content, ok := result["content"].([]any); ok {
		var blocks []any
		for _, item := range content {
			block := item.(map[string]any)
			if parsed, ok := parsedJSONText(block["text"]); ok && block["type"] == "text" {
				blocks = append(blocks, map[string]any{"type": "text", "json": parsed})
			} else {
				blocks = append(blocks, block)
			}
		}
		reduced := map[string]any{"content": blocks}
		if structured, ok := result["structuredContent"]; ok {
			reduced["structuredContent"] = structured
		}
		if result["isError"] == true {
			reduced["isError"] = true
		}
		out["result"] = reduced
	} else {
		out["result"] = result
	}
	return out
}

// bodyOf is the JSON body, or the JSON of each data: line of an event stream.
func bodyOf(t *testing.T, text, contentType string) any {
	t.Helper()
	if text == "" {
		return nil
	}
	if strings.HasPrefix(contentType, "text/event-stream") {
		var data []any
		for _, line := range strings.Split(text, "\n") {
			if rest, ok := strings.CutPrefix(line, "data:"); ok {
				value, err := decodeJSON([]byte(rest))
				if err != nil {
					t.Fatalf("event %q: %v", rest, err)
				}
				data = append(data, value)
			}
		}
		if len(data) == 1 {
			return data[0]
		}
		return data
	}
	value, err := decodeJSON([]byte(text))
	if err != nil {
		t.Fatalf("answer %q is not JSON: %v", text, err)
	}
	return value
}

func isMCPAnswer(body any) bool {
	messages, ok := body.([]any)
	if !ok {
		messages = []any{body}
	}
	for _, item := range messages {
		m, ok := item.(map[string]any)
		if !ok {
			return false
		}
		_, hasResult := m["result"]
		e, hasError := m["error"].(map[string]any)
		if !hasResult && !(hasError && fmt.Sprint(e["code"]) != "-32001") {
			return false
		}
	}
	return true
}

var routeHeaders = []string{"WWW-Authenticate", "Access-Control-Expose-Headers", "Access-Control-Allow-Origin", "Cache-Control"}

// outcomeOf: the route's own answers (metadata, challenges, rejections)
// compare whole, with their headers; the MCP server's answers compare as
// JSON-RPC messages reduced to what a host reads.
func outcomeOf(t *testing.T, response *http.Response) map[string]any {
	t.Helper()
	raw, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	body := bodyOf(t, string(raw), response.Header.Get("Content-Type"))
	if isMCPAnswer(body) {
		var mcpOut any
		if list, ok := body.([]any); ok {
			reduced := make([]any, len(list))
			for i, m := range list {
				reduced[i] = comparableMessage(m.(map[string]any))
			}
			mcpOut = reduced
		} else {
			mcpOut = comparableMessage(body.(map[string]any))
		}
		return map[string]any{"status": response.StatusCode, "mcp": mcpOut}
	}
	headers := map[string]any{}
	for _, name := range routeHeaders {
		if value := response.Header.Get(name); value != "" {
			headers[strings.ToLower(name)] = value
		}
	}
	return map[string]any{"status": response.StatusCode, "headers": headers, "body": body}
}

// ---- the route a case describes -------------------------------------------------

type toolSpec struct {
	Name        string                  `json:"name"`
	Title       string                  `json:"title"`
	Description string                  `json:"description"`
	Annotations *agents.ToolAnnotations `json:"annotations"`
	Input       map[string]struct {
		Type        string `json:"type"`
		Description string `json:"description"`
		Optional    bool   `json:"optional"`
	} `json:"input"`
	Item     string       `json:"item"`
	Estimate agents.Money `json:"estimate"`
	Prompt   string       `json:"prompt"`
	Run      struct {
		Throw  *string `json:"throw"`
		Status int     `json:"status"`
		Cost   *struct {
			Amount   float64 `json:"amount"`
			Currency string  `json:"currency"`
		} `json:"cost"`
		Interrupted string `json:"interrupted"`
		Text        string `json:"text"`
		Echo        bool   `json:"echo"`
	} `json:"run"`
	UnreachableMessage string `json:"unreachableMessage"`
}

func (spec toolSpec) schema() *jsonschema.Schema {
	schema := &jsonschema.Schema{Type: "object", Properties: map[string]*jsonschema.Schema{}}
	for name, property := range spec.Input {
		schema.Properties[name] = &jsonschema.Schema{Type: property.Type, Description: property.Description}
		if !property.Optional {
			schema.Required = append(schema.Required, name)
		}
	}
	sort.Strings(schema.Required)
	return schema
}

func (spec toolSpec) paidTool() agents.PaidTool[map[string]any] {
	tool := agents.PaidTool[map[string]any]{
		Name:               spec.Name,
		Title:              spec.Title,
		Description:        spec.Description,
		InputSchema:        spec.schema(),
		Annotations:        spec.Annotations,
		Item:               func(map[string]any) string { return spec.Item },
		Estimate:           func(map[string]any) agents.Money { return spec.Estimate },
		UnreachableMessage: spec.UnreachableMessage,
		Run: func(_ context.Context, args map[string]any, call agents.PaidCall) (agents.PaidToolRun, error) {
			run := spec.Run
			if run.Throw != nil {
				return agents.PaidToolRun{}, fmt.Errorf("%s", *run.Throw)
			}
			text := run.Text
			if run.Echo {
				encoded, err := json.Marshal(map[string]any{
					"args": args, "callRef": call.CallRef, "agentRef": call.Agent.AgentRef, "principalRef": call.Agent.PrincipalRef,
				})
				if err != nil {
					return agents.PaidToolRun{}, err
				}
				text = string(encoded)
			}
			out := agents.PaidToolRun{
				Status:      run.Status,
				Interrupted: run.Interrupted,
				Result:      &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: text}}},
			}
			if run.Cost != nil {
				out.Cost = &agents.Cost{Amount: run.Cost.Amount, Currency: run.Cost.Currency}
			}
			return out, nil
		},
	}
	if spec.Prompt != "" {
		tool.Prompt = func(args map[string]any) (string, bool) {
			value, ok := args[spec.Prompt]
			if !ok {
				return "undefined", true
			}
			if text, ok := value.(string); ok {
				return text, true
			}
			return fmt.Sprint(value), true
		}
	}
	return tool
}

func agentMCPRoute(t *testing.T, args map[string]any, clock *time.Time) (any, error) {
	var route struct {
		MCPPath           string `json:"mcpPath"`
		ServerName        string `json:"serverName"`
		ServerVersion     string `json:"serverVersion"`
		MaxWaitSeconds    int    `json:"maxWaitSeconds"`
		Environment       string `json:"environment"`
		LazyAuth          *bool  `json:"lazyAuth"`
		AgentKeys         *bool  `json:"agentKeys"`
		ProtectedResource *struct {
			Resource            string `json:"resource"`
			AuthorizationServer string `json:"authorizationServer"`
			Documentation       string `json:"documentation"`
			MetadataPath        string `json:"metadataPath"`
		} `json:"protectedResource"`
	}
	remarshal(t, args["route"], &route)
	var tools []toolSpec
	remarshal(t, args["tools"], &tools)
	var freeTools []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Text        string `json:"text"`
	}
	remarshal(t, args["freeTools"], &freeTools)

	// The case's clock: the token verifier, the key cache and the calls read it,
	// and waiting for the owner moves it on instead of sleeping.
	now := time.Now()
	if clock != nil {
		now = *clock
	}
	readClock := func() time.Time { return now }

	stub := &apiStub{t: t}
	stub.script(args["api"])
	client := agentClient(t, stub)
	tokenArgs := map[string]any{
		"issuer": args["issuer"], "providerRef": args["providerRef"], "jwks": args["jwks"], "environment": route.Environment,
	}
	if route.ProtectedResource != nil {
		tokenArgs["resource"] = route.ProtectedResource.Resource
	}
	layer := &agents.AgentLayer{Tokens: tokenVerifier(t, tokenArgs, readClock)}
	if route.AgentKeys == nil || *route.AgentKeys {
		keys, err := agents.NewKeyVerifier(agents.KeyVerifierOptions{Client: client, Environment: agents.Environment(route.Environment), Now: readClock})
		if err != nil {
			t.Fatal(err)
		}
		layer.Keys = keys
	}
	silent := slog.New(slog.DiscardHandler)
	calls, err := agents.NewCalls(agents.CallsOptions{
		Client:         client,
		MaxWaitSeconds: route.MaxWaitSeconds,
		Logger:         silent,
		Now:            readClock,
		Sleep:          func(_ context.Context, d time.Duration) { now = now.Add(d) },
	})
	if err != nil {
		t.Fatal(err)
	}
	options := agents.MCPRouteOptions{
		Issuer:        str(args, "issuer"),
		Layer:         layer,
		Calls:         calls,
		Logger:        silent,
		MCPPath:       route.MCPPath,
		ServerName:    route.ServerName,
		ServerVersion: route.ServerVersion,
		SignInFirst:   route.LazyAuth != nil && !*route.LazyAuth,
		Tools: func(_ *mcp.Server, paid *agents.PaidTools, _ *agents.AgentRequest) {
			for _, spec := range tools {
				agents.AddPaidTool(paid, spec.paidTool())
			}
		},
	}
	if len(freeTools) > 0 {
		options.FreeTools = func(server *mcp.Server) {
			for _, free := range freeTools {
				answer := free.Text
				server.AddTool(&mcp.Tool{
					Name:        free.Name,
					Description: free.Description,
					InputSchema: json.RawMessage(`{"type":"object","properties":{}}`),
				}, func(context.Context, *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
					return &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: answer}}}, nil
				})
			}
		}
	}
	if p := route.ProtectedResource; p != nil {
		options.ProtectedResource = &agents.ProtectedResource{
			Resource: p.Resource, AuthorizationServer: p.AuthorizationServer, Documentation: p.Documentation, MetadataPath: p.MetadataPath,
		}
	}
	mcpRoute, err := agents.NewMCPRoute(options)
	if err != nil {
		t.Fatal(err)
	}

	var reachedMerchant, threw bool
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		handled, err := mcpRoute.Handle(w, req)
		if err != nil {
			// The route fails loudly (a misconfigured agent layer): no answer at all.
			threw = true
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		if !handled {
			reachedMerchant = true
			w.WriteHeader(http.StatusTeapot)
		}
	}))
	defer server.Close()

	var requests []map[string]any
	remarshal(t, args["requests"], &requests)
	var responses []any
	for _, spec := range requests {
		method := "POST"
		if m, ok := spec["method"].(string); ok {
			method = m
		}
		var body io.Reader
		var payload string
		if raw, ok := spec["rawBody"].(string); ok {
			payload = raw
		} else if value, ok := spec["body"]; ok {
			encoded, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			payload = string(encoded)
		}
		_, hasBody := spec["body"]
		_, hasRaw := spec["rawBody"]
		if hasBody || hasRaw {
			body = strings.NewReader(payload)
		}
		req, err := http.NewRequest(method, server.URL+spec["path"].(string), body)
		if err != nil {
			t.Fatal(err)
		}
		req.Header.Set("Accept", "application/json, text/event-stream")
		if auth, ok := spec["authorization"].(string); ok {
			req.Header.Set("Authorization", auth)
		}
		if body != nil {
			req.Header.Set("Content-Type", "application/json")
		}
		reachedMerchant, threw = false, false
		response, err := server.Client().Do(req)
		if err != nil {
			t.Fatal(err)
		}
		switch {
		case threw:
			responses = append(responses, map[string]any{"thrown": true})
		case reachedMerchant:
			responses = append(responses, map[string]any{"merchant": true})
		default:
			responses = append(responses, outcomeOf(t, response))
		}
		response.Body.Close()
	}
	if unused := stub.unused(); len(unused) > 0 {
		t.Fatalf("API calls not made: %v", unused)
	}
	seen := map[string]string{}
	return map[string]any{
		"responses": withoutUUIDs(responses, seen),
		"apiCalls":  withoutUUIDs(stub.recorded(), seen),
	}, nil
}

func init() {
	register("agentMcpRoute", agentMCPRoute)
	register("agentRefusalStatuses", func(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
		out := map[string]any{}
		for _, reason := range args["reasons"].([]any) {
			status, err := agents.RefusalStatus(reason.(string))
			if err != nil {
				return nil, err
			}
			out[reason.(string)] = status
		}
		return out, nil
	})
}
