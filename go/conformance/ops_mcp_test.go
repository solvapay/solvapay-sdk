package conformance

// The merchant MCP server: suites transport-tools and narration's account-tool
// cases (callTool), tool-descriptors (describeServer, getPrompts,
// readResource), paid-tools (callPaidTool) and merchant-sign-in
// (merchantMcpHttp, merchantTools).
//
// The server is reached as a host reaches it: a raw JSON-RPC client over the
// MCP Go SDK's in-memory transport that initializes as the case's client,
// as conformance/runners/typescript/src/server-ops.ts does. Raw, because the
// SDK's typed client would read every tool's annotations into
// mcp.ToolAnnotations, which cannot tell a hint left out from false.
// merchantMcpHttp drives the whole HTTP handler. SolvaPay's API answers from
// the case's api list: each exchange once, by method and path, in the order
// listed; every exchange must be used and nothing else may be called.

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/modelcontextprotocol/go-sdk/jsonrpc"
	"github.com/modelcontextprotocol/go-sdk/mcp"

	"github.com/solvapay/solvapay-sdk/go"
)

const (
	mcpConformanceAPI    = "https://api.conformance.test"
	mcpConformancePublic = "https://mcp.conformance.test"
	mcpResourceURI       = "ui://conformance/mcp-app.html"
	merchantOrigin       = "https://mcp-si.conformance.test"
)

func init() {
	register("callTool", mcpCallTool)
	register("describeServer", mcpDescribeServer)
	register("getPrompts", mcpGetPrompts)
	register("readResource", mcpReadResource)
	register("callPaidTool", mcpCallPaidTool)
	register("merchantMcpHttp", mcpMerchantHTTP)
	register("merchantTools", mcpMerchantTools)
}

// ---- the API -------------------------------------------------------------------

// fakeAPI answers SolvaPay API requests from a case's exchanges and records each.
type fakeAPI struct {
	t       *testing.T
	mu      sync.Mutex
	pending []map[string]any
	calls   []any
}

func newFakeAPI(t *testing.T, exchanges any) *fakeAPI {
	api := &fakeAPI{t: t}
	list, _ := exchanges.([]any)
	for _, exchange := range list {
		api.pending = append(api.pending, exchange.(map[string]any))
	}
	return api
}

func (a *fakeAPI) RoundTrip(r *http.Request) (*http.Response, error) {
	var body []byte
	if r.Body != nil {
		body, _ = io.ReadAll(r.Body)
	}
	call := map[string]any{"method": r.Method, "path": r.URL.Path}
	if r.URL.RawQuery != "" {
		call["query"] = r.URL.RawQuery
	}
	forwarded := map[string]any{}
	for _, name := range []string{"Content-Type", "Authorization"} {
		if value := r.Header.Get(name); value != "" {
			forwarded[strings.ToLower(name)] = value
		}
	}
	call["headers"] = forwarded
	if len(body) > 0 {
		call["body"] = string(body)
	}
	a.mu.Lock()
	defer a.mu.Unlock()
	a.calls = append(a.calls, call)
	for i, exchange := range a.pending {
		if exchange["method"] != r.Method || exchange["path"] != r.URL.Path {
			continue
		}
		a.pending = append(a.pending[:i:i], a.pending[i+1:]...)
		if exchange["unreachable"] == true {
			return nil, errors.New("fetch failed")
		}
		header := http.Header{}
		if headers, ok := exchange["headers"].(map[string]any); ok {
			for name, value := range headers {
				header.Set(name, value.(string))
			}
		}
		content := ""
		if text, ok := exchange["text"].(string); ok {
			content = text
		} else if value, ok := exchange["body"]; ok {
			raw, err := json.Marshal(value)
			if err != nil {
				return nil, err
			}
			content = string(raw)
			if header.Get("Content-Type") == "" {
				header.Set("Content-Type", "application/json")
			}
		}
		status := 200
		if n, ok := exchange["status"].(json.Number); ok {
			parsed, _ := n.Int64()
			status = int(parsed)
		}
		return &http.Response{
			StatusCode: status,
			Header:     header,
			Body:       io.NopCloser(strings.NewReader(content)),
			Request:    r,
		}, nil
	}
	a.t.Errorf("Unexpected API call: %s %s", r.Method, r.URL.Path)
	return nil, fmt.Errorf("unexpected API call: %s %s", r.Method, r.URL.Path)
}

func (a *fakeAPI) checkUsed() {
	a.t.Helper()
	a.mu.Lock()
	defer a.mu.Unlock()
	if len(a.pending) > 0 {
		var names []string
		for _, e := range a.pending {
			names = append(names, fmt.Sprintf("%v %v", e["method"], e["path"]))
		}
		a.t.Fatalf("API calls not made: %s", strings.Join(names, ", "))
	}
}

func (a *fakeAPI) httpClient() *http.Client { return &http.Client{Transport: a} }

func mcpClient(t *testing.T, api *fakeAPI) *solvapay.Client {
	retries := 0 // TypeScript never retries; see the README's Known divergences
	client, err := solvapay.NewClient(solvapay.Config{
		APIKey:     "sk_sandbox_conformance",
		APIBaseURL: mcpConformanceAPI,
		MaxRetries: &retries,
		HTTPClient: api.httpClient(),
	})
	if err != nil {
		t.Fatal(err)
	}
	return client
}

func fixedCustomer(args map[string]any) solvapay.CustomerRefFunc {
	customer, _ := args["customerRef"].(string)
	return func(context.Context, mcp.Request) (string, error) { return customer, nil }
}

func stringList(value any) []string {
	list, ok := value.([]any)
	if !ok {
		return nil
	}
	out := []string{}
	for _, item := range list {
		out = append(out, item.(string))
	}
	return out
}

// serverFor is the server a case describes: the product, and optionally the
// public URL, views, CSP and hidden audiences.
func serverFor(t *testing.T, args map[string]any, api *fakeAPI) (*solvapay.MCPServer, error) {
	options := solvapay.MCPServerOptions{
		Client:         mcpClient(t, api),
		ProductRef:     args["productRef"].(string),
		PublicBaseURL:  mcpConformancePublic,
		ResourceURI:    mcpResourceURI,
		GetCustomerRef: fixedCustomer(args),
		HTTPClient:     api.httpClient(),
	}
	if url, ok := args["publicBaseUrl"].(string); ok {
		options.PublicBaseURL = url
	}
	if _, ok := args["views"]; ok {
		options.Views = stringList(args["views"])
	}
	if csp, ok := args["csp"].(map[string]any); ok {
		options.CSP = map[string][]string{}
		for key, domains := range csp {
			options.CSP[key] = stringList(domains)
		}
	}
	options.HideToolsByAudience = stringList(args["hideToolsByAudience"])
	return solvapay.NewMCPServer(options)
}

// ---- a raw MCP session ----------------------------------------------------------

type mcpSession struct {
	t    *testing.T
	conn mcp.Connection
	next int
	done func()
}

func connect(t *testing.T, server *mcp.Server, clientName string) *mcpSession {
	ctx := context.Background()
	clientSide, serverSide := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(ctx, serverSide, nil)
	if err != nil {
		t.Fatal(err)
	}
	conn, err := clientSide.Connect(ctx)
	if err != nil {
		t.Fatal(err)
	}
	s := &mcpSession{t: t, conn: conn, done: func() { conn.Close(); serverSession.Close() }}
	s.request("initialize", map[string]any{
		"protocolVersion": "2025-06-18",
		"capabilities":    map[string]any{},
		"clientInfo":      map[string]any{"name": clientName, "version": "1.0.0"},
	})
	if err := conn.Write(ctx, &jsonrpc.Request{Method: "notifications/initialized", Params: json.RawMessage(`{}`)}); err != nil {
		t.Fatal(err)
	}
	return s
}

// request sends one JSON-RPC request and returns its result, decoded with
// json.Number so numbers compare as written.
func (s *mcpSession) request(method string, params any) map[string]any {
	s.t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	s.next++
	id, _ := jsonrpc.MakeID(float64(s.next))
	raw, err := json.Marshal(params)
	if err != nil {
		s.t.Fatal(err)
	}
	if err := s.conn.Write(ctx, &jsonrpc.Request{ID: id, Method: method, Params: raw}); err != nil {
		s.t.Fatal(err)
	}
	for {
		message, err := s.conn.Read(ctx)
		if err != nil {
			s.t.Fatalf("%s: %v", method, err)
		}
		response, ok := message.(*jsonrpc.Response)
		if !ok || response.ID != id {
			continue
		}
		if response.Error != nil {
			s.t.Fatalf("%s: %v", method, response.Error)
		}
		result, err := decodeJSON(response.Result)
		if err != nil {
			s.t.Fatal(err)
		}
		return result.(map[string]any)
	}
}

// ---- comparison shapes ------------------------------------------------------------

var jsonStart = regexp.MustCompile(`^[\[{]`)

// wholeJSON is text as JSON when all of it is JSON (decodeJSON stops after the first value).
func wholeJSON(text string) (any, error) {
	if !json.Valid([]byte(text)) {
		return nil, errors.New("not entirely JSON")
	}
	return decodeJSON([]byte(text))
}

// toolOutcome is a tool result as the cases compare it: a text block holding
// JSON compares parsed, as json. wholeOnly keeps a text that is not entirely
// JSON as text (callPaidTool: a narration may follow the data).
func toolOutcome(t *testing.T, result map[string]any, wholeOnly bool) map[string]any {
	content := []any{}
	for _, item := range result["content"].([]any) {
		block := item.(map[string]any)
		if text, ok := block["text"].(string); ok && block["type"] == "text" && jsonStart.MatchString(text) {
			parsed, err := wholeJSON(text)
			if err == nil {
				content = append(content, map[string]any{"type": "text", "json": parsed})
				continue
			}
			if !wholeOnly {
				t.Fatalf("a text block starts like JSON but is not: %q", text)
			}
		}
		content = append(content, block)
	}
	outcome := map[string]any{"content": content}
	if structured, ok := result["structuredContent"]; ok {
		outcome["structuredContent"] = structured
	}
	if result["isError"] == true {
		outcome["isError"] = true
	}
	return outcome
}

// withoutAPIMessages: a tool error's text that is an API error answer's
// message compares as "<api message>". Go writes the API's own message, as
// Python does; TypeScript writes "<Operation> failed (<status>): <body>"
// (the README's Known divergences). The status and the SDK's own sentences
// still compare.
func withoutAPIMessages(outcome map[string]any, exchanges any) map[string]any {
	if outcome["isError"] != true {
		return outcome
	}
	messages := map[string]bool{}
	list, _ := exchanges.([]any)
	for _, item := range list {
		exchange := item.(map[string]any)
		status := int64(200)
		if n, ok := exchange["status"].(json.Number); ok {
			status, _ = n.Int64()
		}
		if status < 400 {
			continue
		}
		message := ""
		if body, ok := exchange["body"].(map[string]any); ok {
			switch m := body["message"].(type) {
			case string:
				message = m
			case []any:
				parts := make([]string, len(m))
				for i, part := range m {
					parts[i] = fmt.Sprint(part)
				}
				message = strings.Join(parts, "; ")
			}
		}
		if message == "" {
			message = fmt.Sprintf("The SolvaPay API answered %d", status)
		}
		messages[message] = true
	}
	var replace func(any) any
	replace = func(value any) any {
		switch v := value.(type) {
		case string:
			if messages[v] {
				return "<api message>"
			}
		case []any:
			out := make([]any, len(v))
			for i, item := range v {
				out[i] = replace(item)
			}
			return out
		case map[string]any:
			out := map[string]any{}
			for key, item := range v {
				out[key] = replace(item)
			}
			return out
		}
		return value
	}
	return replace(outcome).(map[string]any)
}

var schemaKeys = []string{"type", "const", "enum", "description", "minimum", "maximum", "exclusiveMinimum", "exclusiveMaximum", "minLength", "maxLength"}

// comparableSchema is the part of a JSON Schema the cases compare (README: describeServer).
func comparableSchema(schema any) map[string]any {
	node, _ := schema.(map[string]any)
	out := map[string]any{}
	for _, key := range schemaKeys {
		if value, ok := node[key]; ok {
			out[key] = value
		}
	}
	if properties, ok := node["properties"].(map[string]any); ok {
		comparable := map[string]any{}
		for name, value := range properties {
			comparable[name] = comparableSchema(value)
		}
		out["properties"] = comparable
		required := stringList(node["required"])
		if required == nil {
			required = []string{}
		}
		sort.Strings(required)
		out["required"] = required
	}
	return out
}

func pick(from map[string]any, keys ...string) map[string]any {
	out := map[string]any{}
	for _, key := range keys {
		if value, ok := from[key]; ok {
			out[key] = value
		}
	}
	return out
}

func comparableTools(listed []any, only map[string]bool) []any {
	tools := []any{}
	for _, item := range listed {
		tool := item.(map[string]any)
		if only != nil && !only[tool["name"].(string)] {
			continue
		}
		out := pick(tool, "name", "title", "description", "annotations", "_meta")
		out["inputSchema"] = comparableSchema(tool["inputSchema"])
		tools = append(tools, out)
	}
	sort.Slice(tools, func(i, j int) bool {
		return tools[i].(map[string]any)["name"].(string) < tools[j].(map[string]any)["name"].(string)
	})
	return tools
}

// ---- operations ---------------------------------------------------------------------

// callTool calls one of the server's built-in tools as customerRef.
func mcpCallTool(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, args["api"])
	server, err := serverFor(t, args, api)
	if err != nil {
		return nil, err
	}
	session := connect(t, server.Server(), "conformance")
	defer session.done()
	arguments := args["arguments"]
	if arguments == nil {
		arguments = map[string]any{}
	}
	result := session.request("tools/call", map[string]any{"name": args["tool"], "arguments": arguments})
	api.checkUsed()
	return withoutAPIMessages(toolOutcome(t, result, false), args["api"]), nil
}

func mcpDescribeServer(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, nil)
	server, err := serverFor(t, args, api)
	if err != nil {
		return nil, err
	}
	clientName, ok := args["clientName"].(string)
	if !ok {
		clientName = "conformance"
	}
	session := connect(t, server.Server(), clientName)
	defer session.done()
	tools := session.request("tools/list", map[string]any{})["tools"].([]any)
	prompts := []any{}
	for _, item := range session.request("prompts/list", map[string]any{})["prompts"].([]any) {
		prompt := item.(map[string]any)
		arguments := []any{}
		list, _ := prompt["arguments"].([]any)
		for _, a := range list {
			argument := a.(map[string]any)
			arguments = append(arguments, map[string]any{"name": argument["name"], "required": argument["required"] == true})
		}
		sort.Slice(arguments, func(i, j int) bool {
			return arguments[i].(map[string]any)["name"].(string) < arguments[j].(map[string]any)["name"].(string)
		})
		out := pick(prompt, "name", "title", "description")
		out["arguments"] = arguments
		prompts = append(prompts, out)
	}
	sort.Slice(prompts, func(i, j int) bool {
		return prompts[i].(map[string]any)["name"].(string) < prompts[j].(map[string]any)["name"].(string)
	})
	resources := []any{}
	for _, item := range session.request("resources/list", map[string]any{})["resources"].([]any) {
		resources = append(resources, pick(item.(map[string]any), "uri", "name", "title", "description", "mimeType", "_meta"))
	}
	sort.Slice(resources, func(i, j int) bool {
		return resources[i].(map[string]any)["uri"].(string) < resources[j].(map[string]any)["uri"].(string)
	})
	return map[string]any{"tools": comparableTools(tools, nil), "prompts": prompts, "resources": resources}, nil
}

func mcpGetPrompts(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	server, err := serverFor(t, args, newFakeAPI(t, nil))
	if err != nil {
		return nil, err
	}
	session := connect(t, server.Server(), "conformance")
	defer session.done()
	results := []any{}
	for _, item := range args["calls"].([]any) {
		call := item.(map[string]any)
		arguments := call["arguments"]
		if arguments == nil {
			arguments = map[string]any{}
		}
		result := session.request("prompts/get", map[string]any{"name": call["name"], "arguments": arguments})
		results = append(results, map[string]any{"messages": result["messages"]})
	}
	return results, nil
}

func mcpReadResource(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, args["api"])
	server, err := serverFor(t, args, api)
	if err != nil {
		return nil, err
	}
	session := connect(t, server.Server(), "conformance")
	defer session.done()
	result := session.request("resources/read", map[string]any{"uri": args["uri"]})
	api.checkUsed()
	contents := []any{}
	for _, item := range result["contents"].([]any) {
		content := item.(map[string]any)
		if text, ok := content["text"].(string); ok && jsonStart.MatchString(text) {
			if parsed, err := wholeJSON(text); err == nil {
				out := pick(content, "uri", "mimeType", "_meta", "blob")
				out["json"] = parsed
				content = out
			}
		}
		contents = append(contents, content)
	}
	return map[string]any{"contents": contents}, nil
}

// ---- callPaidTool -----------------------------------------------------------------

// orderedObject writes its keys in order, as a JavaScript object literal
// does: a paid tool's data text is compared as written when a nudge follows it.
type orderedObject struct {
	keys   []string
	values map[string]any
}

func (o *orderedObject) set(key string, value any) {
	if _, ok := o.values[key]; !ok {
		o.keys = append(o.keys, key)
	}
	o.values[key] = value
}

func (o *orderedObject) MarshalJSON() ([]byte, error) {
	var buf bytes.Buffer
	buf.WriteByte('{')
	for i, key := range o.keys {
		if i > 0 {
			buf.WriteByte(',')
		}
		name, _ := json.Marshal(key)
		value, err := json.Marshal(o.values[key])
		if err != nil {
			return nil, err
		}
		buf.Write(name)
		buf.WriteByte(':')
		buf.Write(value)
	}
	buf.WriteByte('}')
	return buf.Bytes(), nil
}

func snapshotJSON(customer solvapay.CustomerSnapshot) *orderedObject {
	o := &orderedObject{values: map[string]any{}}
	o.set("ref", customer.Ref)
	if customer.Balance != nil {
		o.set("balance", *customer.Balance)
	}
	o.set("isCreditBased", customer.IsCreditBased)
	o.set("remaining", customer.Remaining)
	o.set("withinLimits", customer.WithinLimits)
	o.set("overage", customer.Overage)
	o.set("plan", customer.Plan)
	return o
}

// contentBlock is a case's emitted block as MCP content.
func contentBlock(t *testing.T, block map[string]any) mcp.Content {
	text, _ := block["text"].(string)
	switch block["type"] {
	case "text":
		return &mcp.TextContent{Text: text}
	case "image", "audio":
		data, err := base64.StdEncoding.DecodeString(block["data"].(string))
		if err != nil {
			t.Fatal(err)
		}
		if block["type"] == "image" {
			return &mcp.ImageContent{Data: data, MIMEType: block["mimeType"].(string)}
		}
		return &mcp.AudioContent{Data: data, MIMEType: block["mimeType"].(string)}
	}
	t.Fatalf("no Go mapping for an emitted %v block", block["type"])
	return nil
}

// scriptedHandler is the merchant handler a callPaidTool case scripts (README):
// emit blocks, read a fresh snapshot, gate, fail, then answer with Respond.
func scriptedHandler(t *testing.T, script map[string]any) solvapay.PaidToolHandler {
	return func(ctx context.Context, _ json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
		emitted, _ := script["emit"].([]any)
		for _, block := range emitted {
			rc.Emit(contentBlock(t, block.(map[string]any)))
		}
		var fresh *solvapay.CustomerSnapshot
		if script["fresh"] == true {
			snapshot, err := rc.Customer.Fresh(ctx)
			if err != nil {
				return nil, err
			}
			fresh = &snapshot
		}
		if gate, ok := script["gate"]; ok {
			reason, _ := gate.(string)
			return nil, rc.Gate(reason)
		}
		if message, ok := script["throw"].(string); ok {
			return nil, errors.New(message)
		}
		respond, _ := script["respond"].(map[string]any)
		data := respond["data"]
		if respond["echo"] == true {
			o := &orderedObject{values: map[string]any{}}
			fields, _ := data.(map[string]any)
			keys := make([]string, 0, len(fields))
			for key := range fields {
				keys = append(keys, key)
			}
			sort.Strings(keys)
			for _, key := range keys {
				o.set(key, fields[key])
			}
			o.set("customer", snapshotJSON(rc.Customer))
			if fresh != nil {
				o.set("freshCustomer", snapshotJSON(*fresh))
			}
			o.set("product", rc.Product)
			data = o
		}
		var options solvapay.RespondOptions
		if text, ok := respond["text"].(string); ok {
			options.Text = &text
		}
		if nudge, ok := respond["nudge"].(map[string]any); ok {
			message, _ := nudge["message"].(string)
			options.Nudge = &solvapay.Nudge{Kind: solvapay.NudgeKind(nudge["kind"].(string)), Message: message}
		}
		if respond["dataInText"] == false {
			options.OmitDataText = true
		}
		return rc.Respond(data, options), nil
	}
}

func caseFreeLimit(t *testing.T, raw map[string]any) solvapay.FreeLimit {
	limit := solvapay.FreeLimit{Scope: raw["scope"].(string)}
	limit.Meter, _ = raw["meter"].(string)
	limit.Cap = paywallInt(t, raw["cap"])
	if days, ok := raw["windowDays"]; ok && days != nil {
		limit.WindowDays = paywallInt(t, days)
	}
	return limit
}

func mcpCallPaidTool(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, args["api"])
	server, err := serverFor(t, args, api)
	if err != nil {
		return nil, err
	}
	tool := args["tool"].(map[string]any)
	name := tool["name"].(string)
	script, _ := args["handler"].(map[string]any)
	paid := solvapay.PaidTool{Handler: scriptedHandler(t, script), GetCustomerRef: fixedCustomer(args)}
	if tool["kind"] == "free" {
		err = server.RegisterFree(name, caseFreeLimit(t, tool["freeLimit"].(map[string]any)), paid)
	} else {
		err = server.RegisterPayable(name, paid)
	}
	if err != nil {
		return nil, err
	}
	session := connect(t, server.Server(), "conformance")
	defer session.done()
	result := session.request("tools/call", map[string]any{"name": name, "arguments": map[string]any{}})
	api.checkUsed()
	return toolOutcome(t, result, true), nil
}

// ---- merchant-sign-in -------------------------------------------------------------

var comparedHeaders = []string{
	"access-control-allow-origin", "access-control-allow-credentials", "access-control-allow-methods",
	"access-control-allow-headers", "access-control-max-age", "access-control-expose-headers",
	"vary", "www-authenticate", "location", "allow", "cache-control", "pragma",
}

func httpOutcome(t *testing.T, response *http.Response) map[string]any {
	body, err := io.ReadAll(response.Body)
	if err != nil {
		t.Fatal(err)
	}
	headers := map[string]any{}
	contentType := response.Header.Get("Content-Type")
	if contentType != "" {
		// Only the media type: charset spelling is not behaviour.
		headers["content-type"] = strings.ToLower(strings.TrimSpace(strings.Split(contentType, ";")[0]))
	}
	for _, name := range comparedHeaders {
		if values := response.Header.Values(name); len(values) > 0 {
			headers[name] = strings.Join(values, ", ")
		}
	}
	var decoded any
	if len(body) > 0 {
		decoded = string(body)
		if strings.Contains(contentType, "json") {
			if parsed, err := decodeJSON(body); err == nil {
				decoded = parsed
			}
		}
	}
	return map[string]any{"status": response.StatusCode, "headers": headers, "body": decoded}
}

func mcpMerchantHTTP(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, args["api"])
	options := solvapay.MCPServerOptions{
		Client:        mcpClient(t, api),
		ProductRef:    args["productRef"].(string),
		PublicBaseURL: args["publicBaseUrl"].(string),
		ResourceURI:   mcpResourceURI,
		HTTPClient:    api.httpClient(),
	}
	if path, ok := args["mcpPath"].(string); ok {
		options.MCPPath = path
	}
	if paths, ok := args["oauthPaths"].(map[string]any); ok {
		text := func(key string) string { value, _ := paths[key].(string); return value }
		options.OAuthPaths = solvapay.OAuthPaths{Register: text("register"), Authorize: text("authorize"), Token: text("token"), Revoke: text("revoke")}
	}
	server, err := solvapay.NewMCPServer(options)
	if err != nil {
		return nil, err
	}
	handler := server.Handler()
	responses := []any{}
	for _, item := range args["requests"].([]any) {
		spec := item.(map[string]any)
		method, ok := spec["method"].(string)
		if !ok {
			method = http.MethodGet
		}
		var body io.Reader = http.NoBody
		headers := http.Header{}
		if given, ok := spec["headers"].(map[string]any); ok {
			for name, value := range given {
				headers.Set(name, value.(string))
			}
		}
		if raw, ok := spec["rawBody"].(string); ok {
			body = strings.NewReader(raw)
		} else if value, ok := spec["body"]; ok {
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			body = bytes.NewReader(raw)
			if headers.Get("Content-Type") == "" {
				headers.Set("Content-Type", "application/json")
			}
		}
		request := httptest.NewRequest(method, merchantOrigin+spec["path"].(string), body)
		request.Header = headers
		recorder := httptest.NewRecorder()
		handler.ServeHTTP(recorder, request)
		responses = append(responses, httpOutcome(t, recorder.Result()))
	}
	api.checkUsed()
	calls := api.calls
	if calls == nil {
		calls = []any{}
	}
	return map[string]any{"responses": responses, "apiCalls": calls}, nil
}

var schemaTypes = map[string]string{"string": "string", "number": "number", "boolean": "boolean"}

// merchantSchema is the object schema of a case tool's input field map.
func merchantSchema(input map[string]any) map[string]any {
	properties := map[string]any{}
	required := []any{}
	for name, value := range input {
		field := value.(map[string]any)
		property := map[string]any{"type": schemaTypes[field["type"].(string)]}
		if description, ok := field["description"].(string); ok && description != "" {
			property["description"] = description
		}
		properties[name] = property
		if field["optional"] != true {
			required = append(required, name)
		}
	}
	return map[string]any{"type": "object", "properties": properties, "required": required}
}

func hint(annotations map[string]any, key string) *bool {
	if value, ok := annotations[key].(bool); ok {
		return &value
	}
	return nil
}

func mcpMerchantTools(t *testing.T, args map[string]any, _ *time.Time) (any, error) {
	api := newFakeAPI(t, nil)
	options := solvapay.MCPServerOptions{
		Client:        mcpClient(t, api),
		ProductRef:    args["productRef"].(string),
		PublicBaseURL: merchantOrigin,
		ResourceURI:   mcpResourceURI,
		HTTPClient:    api.httpClient(),
	}
	if hidden, ok := args["hideToolsByAudience"].(map[string]any); ok {
		options.HideToolsByAudience = stringList(hidden["audiences"])
		bypass := hidden["bypass"] == true
		options.HideToolsBypass = func(context.Context, mcp.Request) bool { return bypass }
	}
	server, err := solvapay.NewMCPServer(options)
	if err != nil {
		return nil, err
	}
	names := map[string]bool{}
	for _, item := range args["tools"].([]any) {
		tool := item.(map[string]any)
		name := tool["name"].(string)
		names[name] = true
		paid := solvapay.PaidTool{
			Handler: func(_ context.Context, raw json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
				var received map[string]any
				if err := json.Unmarshal(raw, &received); err != nil {
					return nil, err
				}
				for key, value := range received {
					if value == nil {
						delete(received, key)
					}
				}
				return rc.Respond(map[string]any{"received": received}, solvapay.RespondOptions{}), nil
			},
			GetCustomerRef: fixedCustomer(tool),
		}
		paid.Description, _ = tool["description"].(string)
		paid.Title, _ = tool["title"].(string)
		if meta, ok := tool["meta"].(map[string]any); ok {
			paid.Meta = mcp.Meta(meta)
		}
		if annotations, ok := tool["annotations"].(map[string]any); ok {
			paid.Annotations = &solvapay.ToolAnnotations{
				ReadOnlyHint:    hint(annotations, "readOnlyHint"),
				DestructiveHint: hint(annotations, "destructiveHint"),
				IdempotentHint:  hint(annotations, "idempotentHint"),
				OpenWorldHint:   hint(annotations, "openWorldHint"),
			}
			paid.Annotations.Title, _ = annotations["title"].(string)
		}
		input, _ := tool["input"].(map[string]any)
		paid.InputSchema = merchantSchema(input)
		if tool["kind"] == "free" {
			err = server.RegisterFree(name, caseFreeLimit(t, tool["freeLimit"].(map[string]any)), paid)
		} else {
			err = server.RegisterPayable(name, paid)
		}
		var sdkErr *solvapay.Error
		if errors.As(err, &sdkErr) {
			// Registration refused the tools (the message is for people).
			return map[string]any{"refused": true}, nil
		}
		if err != nil {
			return nil, err
		}
	}
	clientName, ok := args["clientName"].(string)
	if !ok {
		clientName = "conformance"
	}
	session := connect(t, server.Server(), clientName)
	defer session.done()
	listed := session.request("tools/list", map[string]any{})["tools"].([]any)
	out := map[string]any{"tools": comparableTools(listed, names)}
	var calls []any
	callList, _ := args["calls"].([]any)
	for _, item := range callList {
		call := item.(map[string]any)
		arguments := call["arguments"]
		if arguments == nil {
			arguments = map[string]any{}
		}
		result := session.request("tools/call", map[string]any{"name": call["name"], "arguments": arguments})
		calls = append(calls, pick(result, "content", "structuredContent", "isError"))
	}
	if len(calls) > 0 {
		out["calls"] = calls
	}
	api.checkUsed()
	return out, nil
}
