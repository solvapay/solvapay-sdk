package agents

// An MCP server paid by SolvaPay agents. Requests on the MCP path whose bearer
// token comes from SolvaPay's agent issuer (or is an agent key) are verified
// and served by a server built for that agent; each paid tool call is
// authorized before it runs and completed at the cost it reports. Every other
// request is left to the merchant's own handler.
//
// A refusal is a tool error (isError) whose text is the sentence for the
// agent's human, and whose structuredContent.refusal.reason says which refusal
// it was, so an agent can act on it without parsing the text.

import (
	"bytes"
	"context"
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"regexp"
	"strconv"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-sdk/go"
)

const unreachableMessage = "The service behind this tool could not be reached. Nothing was charged."

// AgentRequest is the agent a request was verified as, and the token it presented.
type AgentRequest struct {
	Request *http.Request
	Agent   VerifiedAgent
	// AgentToken is as presented; SolvaPay verifies it again on every authorize.
	AgentToken string
}

// PaidCall is what a paid tool's Run gets besides its arguments.
type PaidCall struct {
	CallRef   string
	RequestID string
	Agent     VerifiedAgent
}

// PaidToolRun is how a paid tool's upstream call went.
type PaidToolRun struct {
	// Status is the status the upstream answered with; 400 and above charges nothing.
	Status int
	// Cost is what the upstream reported it cost, or nil when it reported nothing.
	Cost *Cost
	// Interrupted is set when the answer broke before it finished.
	Interrupted string
	// Result is what the agent gets back.
	Result *mcp.CallToolResult
}

// ToolAnnotations are a paid tool's hints. Unlike mcp.ToolAnnotations, a hint
// left nil is left out of the tool list, as the merchant wrote it.
type ToolAnnotations struct {
	Title           string `json:"title,omitempty"`
	ReadOnlyHint    *bool  `json:"readOnlyHint,omitempty"`
	DestructiveHint *bool  `json:"destructiveHint,omitempty"`
	IdempotentHint  *bool  `json:"idempotentHint,omitempty"`
	OpenWorldHint   *bool  `json:"openWorldHint,omitempty"`
}

// PaidTool is a merchant's paid tool, with Args its decoded arguments.
type PaidTool[Args any] struct {
	Name string
	// Title defaults to Name.
	Title       string
	Description string
	// InputSchema validates calls; nil infers it from Args.
	InputSchema *jsonschema.Schema
	// Annotations default to neither read-only nor destructive: directories flag
	// tools that leave them out, and a paid call is never read-only in the money
	// sense. openWorldHint stays the merchant's call.
	Annotations *ToolAnnotations
	// Item is the merchant's label for what the call buys (a model id, a tool name).
	Item func(Args) string
	// Estimate is what the call may cost, in the merchant's currency.
	Estimate func(Args) Money
	// Prompt is the text whose fingerprint shows repeats (loops); its end goes
	// only when the token allows. nil, or false, for none.
	Prompt func(Args) (string, bool)
	// Run calls the upstream. An error means it was never reached: the call is
	// released, nothing charged.
	Run func(ctx context.Context, args Args, call PaidCall) (PaidToolRun, error)
	// UnreachableMessage is what the agent reads when Run fails; says nothing was charged.
	UnreachableMessage string
}

// PaidTools registers paid tools on one request's server; see AddPaidTool.
type PaidTools struct {
	server *mcp.Server
	route  *MCPRoute
	// call is nil when the tools are listed for a host that has not signed in.
	call        *AgentRequest
	names       map[string]bool
	annotations map[string]json.RawMessage
}

var notReadOnlyNorDestructive = func() *ToolAnnotations {
	no := false
	return &ToolAnnotations{ReadOnlyHint: &no, DestructiveHint: &no}
}()

// AddPaidTool registers a paid tool: authorize, run, complete; a refusal
// becomes a tool error. For a host that has not signed in, it is listed but
// never runs: the route answers a call to it with the sign-in challenge.
func AddPaidTool[Args any](p *PaidTools, tool PaidTool[Args]) {
	annotations := tool.Annotations
	if annotations == nil {
		annotations = notReadOnlyNorDestructive
	}
	encoded, err := json.Marshal(annotations)
	if err != nil {
		panic("agents: encoding tool annotations: " + err.Error())
	}
	p.names[tool.Name] = true
	p.annotations[tool.Name] = encoded
	title := tool.Title
	if title == "" {
		title = tool.Name
	}
	definition := &mcp.Tool{Name: tool.Name, Title: title, Description: tool.Description}
	if tool.InputSchema != nil {
		definition.InputSchema = tool.InputSchema
	}
	if p.call == nil {
		mcp.AddTool(p.server, definition, func(context.Context, *mcp.CallToolRequest, Args) (*mcp.CallToolResult, any, error) {
			return nil, nil, fmt.Errorf("paid tool %s reached without an agent: the route should have challenged", tool.Name)
		})
		return
	}
	call, route := *p.call, p.route
	mcp.AddTool(p.server, definition, func(ctx context.Context, _ *mcp.CallToolRequest, args Args) (*mcp.CallToolResult, any, error) {
		return runPaidTool(ctx, route, call, tool, args), nil, nil
	})
}

func runPaidTool[Args any](ctx context.Context, route *MCPRoute, call AgentRequest, tool PaidTool[Args], args Args) *mcp.CallToolResult {
	requestID := newUUID()
	var prompt *PromptFacts
	if tool.Prompt != nil {
		if text, ok := tool.Prompt(args); ok {
			facts := NewPromptFacts(text, false)
			prompt = &facts
		}
	}
	allowed, refused := route.options.Calls.Begin(ctx, AgentCall{
		RequestID:  requestID,
		AgentToken: call.AgentToken,
		Agent:      call.Agent,
		Item:       tool.Item(args),
		Estimate:   tool.Estimate(args),
		Prompt:     prompt,
		LogFields:  map[string]any{"tool": tool.Name},
	})
	if refused != nil {
		return &mcp.CallToolResult{
			IsError:           true,
			Content:           []mcp.Content{&mcp.TextContent{Text: refused.Message}},
			StructuredContent: map[string]any{"refusal": map[string]any{"reason": refused.Reason, "message": refused.Message}},
		}
	}
	run, err := tool.Run(ctx, args, PaidCall{CallRef: allowed.CallRef, RequestID: requestID, Agent: call.Agent})
	if err != nil {
		if releaseErr := allowed.Release(ctx, "upstream_unreachable"); releaseErr != nil {
			panic("agents: releasing a call that was just allowed: " + releaseErr.Error())
		}
		logEvent(route.logger(), slog.LevelError, "call.upstream_failed", map[string]any{
			"requestId": requestID, "tool": tool.Name, "callRef": allowed.CallRef, "error": err.Error(),
		})
		message := tool.UnreachableMessage
		if message == "" {
			message = unreachableMessage
		}
		return &mcp.CallToolResult{IsError: true, Content: []mcp.Content{&mcp.TextContent{Text: message}}}
	}
	completed, err := allowed.Finish(ctx, CallResult{Status: run.Status, Cost: run.Cost, Interrupted: run.Interrupted})
	if err != nil {
		// Only a cost that is not a finite number: the merchant's run reported it.
		completed = nil
		logEvent(route.logger(), slog.LevelError, "call.complete_failed", map[string]any{
			"requestId": requestID, "tool": tool.Name, "callRef": allowed.CallRef, "status": nil, "error": err.Error(),
		})
	}
	var cost, settled any
	if run.Cost != nil {
		cost = map[string]any{"amount": run.Cost.Amount, "currency": run.Cost.Currency}
	}
	if completed != nil {
		// nil when SolvaPay could not be told; the SDK logged why.
		settled = map[string]any{"source": completed.Source, "amount": completed.Amount}
	}
	logEvent(route.logger(), slog.LevelInfo, "call.completed", map[string]any{
		"requestId": requestID,
		"tool":      tool.Name,
		"agentRef":  call.Agent.AgentRef,
		"userRef":   call.Agent.PrincipalRef,
		"callRef":   allowed.CallRef,
		"item":      allowed.Item,
		"estimate":  allowed.Estimate,
		"status":    run.Status,
		"cost":      cost,
		"completed": settled,
	})
	return run.Result
}

// newUUID is a random (version 4) UUID, a paid call's request id.
func newUUID() string {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		panic("agents: reading random bytes: " + err.Error())
	}
	b[6] = b[6]&0x0f | 0x40
	b[8] = b[8]&0x3f | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:])
}

// MCPRouteOptions configures an MCPRoute.
type MCPRouteOptions struct {
	// Issuer is SolvaPay's agent token issuer; only tokens from it are routed here.
	Issuer string
	Layer  *AgentLayer
	Calls  *Calls
	// Logger gets one line per event; nil means slog.Default().
	Logger *slog.Logger
	// MCPPath is the MCP endpoint's path, e.g. /mcp.
	MCPPath    string
	ServerName string
	// ServerVersion defaults to 0.1.0.
	ServerVersion string
	// Tools registers the merchant's tools, with AddPaidTool(paid, …) for the
	// paid ones. call is the verified agent; it is nil only when the tools are
	// listed for a host that has not signed in yet (ProtectedResource set), and
	// then no paid tool can run.
	Tools func(server *mcp.Server, paid *PaidTools, call *AgentRequest)
	// FreeTools registers tools anyone may call, signed in or not.
	FreeTools func(server *mcp.Server)
	// ProtectedResource turns OAuth sign-in on for hosts such as Claude and
	// ChatGPT: the route serves this resource's RFC 9728 metadata and answers a
	// paid call with no agent token by the 401 challenge that sends the host to
	// SolvaPay. AuthorizationServer defaults to Issuer.
	ProtectedResource *ProtectedResource
	// SignInFirst, with ProtectedResource, challenges every tools/call without
	// a token, free ones too; initialize and tools/list still answer. Default
	// (false): a host may list tools and run free ones before sign-in.
	SignInFirst bool
}

// MCPRoute answers agents' requests to a merchant's MCP server.
type MCPRoute struct {
	options       MCPRouteOptions
	resource      *ProtectedResource
	metadataPaths map[string]bool
}

// NewMCPRoute builds the route; a ProtectedResource that cannot be one is an error.
func NewMCPRoute(options MCPRouteOptions) (*MCPRoute, error) {
	if options.Issuer == "" || options.Layer == nil || options.Calls == nil || options.MCPPath == "" || options.ServerName == "" || options.Tools == nil {
		return nil, &solvapay.Error{Code: "invalid_argument", Message: "An agent MCP route needs Issuer, Layer, Calls, MCPPath, ServerName and Tools"}
	}
	if options.ServerVersion == "" {
		options.ServerVersion = "0.1.0"
	}
	route := &MCPRoute{options: options, metadataPaths: map[string]bool{}}
	if given := options.ProtectedResource; given != nil {
		canonical, err := CanonicalResource(given.Resource)
		if err != nil {
			return nil, err
		}
		resource := *given
		resource.Resource = canonical
		if resource.AuthorizationServer == "" {
			resource.AuthorizationServer = options.Issuer
		}
		path, err := resource.MetadataPathFor()
		if err != nil {
			return nil, err
		}
		route.resource = &resource
		route.metadataPaths[path] = true
		route.metadataPaths[options.MCPPath+metadataPrefix] = true
	}
	return route, nil
}

func (r *MCPRoute) logger() *slog.Logger {
	if r.options.Logger == nil {
		return slog.Default()
	}
	return r.options.Logger
}

// Middleware answers agents' requests and passes the rest to next. A request
// the route cannot answer because it is misconfigured (an agent key with no
// KeyVerifier) or because SolvaPay failed while checking an agent key is a
// 500, logged.
func (r *MCPRoute) Middleware(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, req *http.Request) {
		handled, err := r.Handle(w, req)
		if err != nil {
			logEvent(r.logger(), slog.LevelError, "route.failed", map[string]any{"path": req.URL.Path, "error": err.Error()})
			http.Error(w, "Internal Server Error", http.StatusInternalServerError)
			return
		}
		if !handled {
			next.ServeHTTP(w, req)
		}
	})
}

// Handle answers an agent's request and reports true, or reports false,
// writing nothing, for the merchant's own handler (with the body still
// readable). An error writes nothing: the route is misconfigured, or SolvaPay
// failed while an agent key was checked.
func (r *MCPRoute) Handle(w http.ResponseWriter, req *http.Request) (bool, error) {
	path := req.URL.EscapedPath()
	if r.resource != nil && req.Method == http.MethodGet && r.metadataPaths[path] {
		document, err := r.resource.Metadata(r.options.ServerName)
		if err != nil {
			return false, err
		}
		w.Header().Set("Cache-Control", "public, max-age=300")
		w.Header().Set("Access-Control-Allow-Origin", "*")
		writeJSON(w, http.StatusOK, document)
		return true, nil
	}
	if path != r.options.MCPPath {
		return false, nil
	}
	body, err := io.ReadAll(req.Body)
	if err != nil {
		return false, err
	}
	req.Body.Close()
	req.Body = io.NopCloser(bytes.NewReader(body))

	token := agentBearer(req, r.options.Issuer)
	if token == "" {
		if r.resource == nil {
			return false, nil
		}
		return r.anonymous(w, req, body)
	}
	identity, err := r.options.Layer.Identify(req.Context(), token)
	if err != nil {
		return false, err
	}
	switch identity.Kind {
	case KindRejected:
		reason := identity.Rejection.Reason
		logEvent(r.logger(), slog.LevelInfo, "call.rejected", map[string]any{
			"reason": "agent_token_" + string(reason), "detail": identity.Rejection.Detail,
		})
		// The other environment is not fixed by signing in again here.
		if r.resource != nil && reason != EnvironmentMismatch {
			description := "The agent token was not accepted: sign in again"
			if reason == Expired {
				description = "The sign-in has expired: sign in again"
			}
			return true, r.resource.WriteAuthChallenge(w, description, jsonRPCID(body))
		}
		status := http.StatusUnauthorized
		if reason == EnvironmentMismatch {
			status = http.StatusForbidden
		}
		w.Header().Set("WWW-Authenticate", `Bearer error="invalid_token", error_description="`+string(reason)+`"`)
		writeJSON(w, status, jsonRPCError(nil, -32001, "The agent token was not accepted ("+string(reason)+")."))
		return true, nil
	case KindNotAgent:
		if IsAgentKey(token) {
			return false, &solvapay.Error{Code: "agent_route_misconfigured", Message: "An agent key reached the agent route, but its agent layer has no KeyVerifier"}
		}
		return false, &solvapay.Error{Code: "agent_route_misconfigured", Message: "A token from the agent issuer was not read as one"}
	}
	call := &AgentRequest{Request: req, Agent: *identity.Agent, AgentToken: token}
	server, paid := r.server(call)
	r.serve(w, req, body, server, paid)
	return true, nil
}

// anonymous answers a request with no agent token while OAuth is on. A bearer
// that is not ours is the merchant's own auth: its handler answers unless it
// is a paid call. With no bearer at all the route answers itself, from a
// server that lists every tool and runs only the free ones: a host lists tools
// before its user signs in, and a paid call is what sends it to sign in.
func (r *MCPRoute) anonymous(w http.ResponseWriter, req *http.Request, body []byte) (bool, error) {
	server, paid := r.server(nil)
	for _, call := range toolCalls(req.Method, body) {
		if r.options.SignInFirst || paid.names[call.name] {
			// The call that needs sign-in, which in a batch may not be the first.
			return true, r.resource.WriteAuthChallenge(w, "Sign in to pay for this tool", call.id)
		}
	}
	if bearerScheme.MatchString(req.Header.Get("Authorization")) {
		return false, nil
	}
	r.serve(w, req, body, server, paid)
	return true, nil
}

var bearerScheme = regexp.MustCompile(`(?i)^Bearer\s`)

func (r *MCPRoute) server(call *AgentRequest) (*mcp.Server, *PaidTools) {
	server := mcp.NewServer(&mcp.Implementation{Name: r.options.ServerName, Version: r.options.ServerVersion}, nil)
	if r.options.FreeTools != nil {
		r.options.FreeTools(server)
	}
	paid := &PaidTools{server: server, route: r, call: call, names: map[string]bool{}, annotations: map[string]json.RawMessage{}}
	r.options.Tools(server, paid, call)
	return server, paid
}

// serve answers one MCP request (JSON, stateless) from a server built for it.
// The server is stateless and answers JSON: there is no event stream to open
// (GET) and no session to end (DELETE), and a body that is not JSON is the
// JSON-RPC parse error.
func (r *MCPRoute) serve(w http.ResponseWriter, req *http.Request, body []byte, server *mcp.Server, paid *PaidTools) {
	if req.Method != http.MethodPost {
		w.Header().Set("Allow", http.MethodPost)
		writeJSON(w, http.StatusMethodNotAllowed, jsonRPCError(nil, -32000, "Method not allowed."))
		return
	}
	if !json.Valid(body) {
		writeJSON(w, http.StatusBadRequest, jsonRPCError(nil, -32700, "Parse error"))
		return
	}
	handler := mcp.NewStreamableHTTPHandler(func(*http.Request) *mcp.Server { return server }, &mcp.StreamableHTTPOptions{
		Stateless:    true,
		JSONResponse: true,
		// The merchant's app owns host checks; this server is reached only through it.
		DisableLocalhostProtection: true,
	})
	recorder := &bufferedResponse{header: http.Header{}, status: http.StatusOK}
	handler.ServeHTTP(recorder, req)
	out := recorder.body.Bytes()
	if len(paid.annotations) > 0 {
		out = withAnnotations(out, paid.annotations)
	}
	for name, values := range recorder.header {
		w.Header()[name] = values
	}
	if w.Header().Get("Content-Length") != "" {
		w.Header().Set("Content-Length", strconv.Itoa(len(out)))
	}
	w.WriteHeader(recorder.status)
	_, _ = w.Write(out)
}

// bufferedResponse holds the MCP server's answer so its tool list can be
// corrected before it goes out.
type bufferedResponse struct {
	header http.Header
	status int
	body   bytes.Buffer
	wrote  bool
}

func (b *bufferedResponse) Header() http.Header { return b.header }

func (b *bufferedResponse) WriteHeader(status int) {
	if !b.wrote {
		b.status, b.wrote = status, true
	}
}

func (b *bufferedResponse) Write(p []byte) (int, error) {
	b.wrote = true
	return b.body.Write(p)
}

// withAnnotations puts each paid tool's annotations into a tools/list answer
// as the merchant wrote them. The Go SDK's ToolAnnotations always writes
// readOnlyHint and idempotentHint, so a hint left out would read as false.
func withAnnotations(body []byte, annotations map[string]json.RawMessage) []byte {
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var message map[string]any
	if err := decoder.Decode(&message); err != nil {
		return body
	}
	result, ok := message["result"].(map[string]any)
	if !ok {
		return body
	}
	tools, ok := result["tools"].([]any)
	if !ok {
		return body
	}
	for _, item := range tools {
		tool, ok := item.(map[string]any)
		if !ok {
			continue
		}
		if name, _ := tool["name"].(string); annotations[name] != nil {
			tool["annotations"] = annotations[name]
		}
	}
	out, err := json.Marshal(message)
	if err != nil {
		panic("agents: encoding a tool list: " + err.Error())
	}
	return out
}

type toolCall struct {
	id   any
	name string
}

// toolCalls is the tools/call requests in a JSON-RPC body (one, or a batch).
func toolCalls(method string, body []byte) []toolCall {
	if method != http.MethodPost {
		return nil
	}
	parsed, ok := decodeJSONValue(body)
	if !ok {
		// Not JSON: the MCP server answers it with its parse error.
		return nil
	}
	messages, isBatch := parsed.([]any)
	if !isBatch {
		messages = []any{parsed}
	}
	var out []toolCall
	for _, item := range messages {
		message, ok := item.(map[string]any)
		if !ok || message["method"] != "tools/call" {
			continue
		}
		params, _ := message["params"].(map[string]any)
		if name, ok := params["name"].(string); ok {
			out = append(out, toolCall{id: message["id"], name: name})
		}
	}
	return out
}

// jsonRPCID is the id of a single JSON-RPC request, nil when there is none.
func jsonRPCID(body []byte) any {
	parsed, ok := decodeJSONValue(body)
	if !ok {
		return nil
	}
	if message, ok := parsed.(map[string]any); ok {
		return message["id"]
	}
	return nil
}

func decodeJSONValue(body []byte) (any, bool) {
	if !json.Valid(body) {
		return nil, false
	}
	decoder := json.NewDecoder(bytes.NewReader(body))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, false
	}
	return value, true
}

var bearerToken = regexp.MustCompile(`(?i)^Bearer\s+(\S+)$`)

// agentBearer is the bearer token when it is an agent key or SolvaPay's agent
// issuer signed it (read unverified, only to route), else "".
func agentBearer(req *http.Request, issuer string) string {
	match := bearerToken.FindStringSubmatch(req.Header.Get("Authorization"))
	if match == nil {
		return ""
	}
	if IsAgentKey(match[1]) {
		return match[1]
	}
	// Not a JWT at all: the merchant's own handler answers it.
	if claims, ok := decodeJWTClaims(match[1]); ok && claims["iss"] == issuer {
		return match[1]
	}
	return ""
}
