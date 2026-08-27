package mcp

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"strings"
	"sync"

	solvapay "github.com/solvapay/solvapay-go"
)

// HTTPConfig is the public origin / product settings for [Engine].
type HTTPConfig struct {
	ProductRef    string
	PublicBaseURL string
	ResourceURI   string
	MCPPath       string
	Views         []string
	OauthPaths    map[string]any
}

// Engine routes OAuth through McpOauthRequest and /mcp through McpDispatch.
type Engine struct {
	client   *solvapay.Client
	cfg      HTTPConfig
	mu       sync.Mutex
	payables map[string]Options
}

// NewEngine binds a SolvaPay client to one MCP origin.
func NewEngine(client *solvapay.Client, cfg HTTPConfig) *Engine {
	if cfg.MCPPath == "" {
		cfg.MCPPath = "/mcp"
	}
	if cfg.ResourceURI == "" {
		cfg.ResourceURI = "ui://widget.html"
	}
	return &Engine{client: client, cfg: cfg, payables: map[string]Options{}}
}

// RegisterPayable records a merchant tool. Names feed EngineConfig.payableTools.
func (e *Engine) RegisterPayable(name string, opts Options) error {
	if name == "" {
		return fmt.Errorf("tool name is required")
	}
	if opts.Client == nil {
		opts.Client = e.client
	}
	if opts.Product == "" {
		return fmt.Errorf("Product is required")
	}
	if opts.Handler == nil {
		return fmt.Errorf("Handler is required")
	}
	if opts.UsageType == "" {
		opts.UsageType = "requests"
	}
	e.mu.Lock()
	defer e.mu.Unlock()
	e.payables[name] = opts
	return nil
}

// ServeHTTP implements net/http.Handler.
func (e *Engine) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	path := r.URL.Path
	if r.URL.RawQuery != "" {
		path = path + "?" + r.URL.RawQuery
	}
	if pathOnly(r.URL.Path) != e.cfg.MCPPath {
		e.handleOAuth(w, r, path)
		return
	}
	if r.Method != http.MethodPost {
		w.Header().Set("Allow", "POST")
		w.WriteHeader(http.StatusMethodNotAllowed)
		return
	}
	e.handleMCP(w, r)
}

func (e *Engine) handleOAuth(w http.ResponseWriter, r *http.Request, path string) {
	body, err := io.ReadAll(r.Body)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	headers := map[string]string{}
	for key, values := range r.Header {
		if len(values) > 0 {
			headers[strings.ToLower(key)] = values[0]
		}
	}
	envelope, err := e.client.McpOauthRequest(r.Context(), map[string]any{
		"method":  r.Method,
		"path":    path,
		"headers": headers,
		"body":    string(body),
		"config": map[string]any{
			"publicBaseUrl": e.cfg.PublicBaseURL,
			"mcpPath":       e.cfg.MCPPath,
			"productRef":    e.cfg.ProductRef,
			"oauthPaths":    e.cfg.OauthPaths,
		},
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeOAuth(w, envelope)
}

func (e *Engine) handleMCP(w http.ResponseWriter, r *http.Request) {
	var rpc any
	if err := json.NewDecoder(r.Body).Decode(&rpc); err != nil {
		http.Error(w, "invalid JSON-RPC body", http.StatusBadRequest)
		return
	}
	e.mu.Lock()
	names := make([]string, 0, len(e.payables))
	for name := range e.payables {
		names = append(names, name)
	}
	e.mu.Unlock()
	params := map[string]any{
		"rpc": rpc,
		"config": map[string]any{
			"productRef":    e.cfg.ProductRef,
			"publicBaseUrl": e.cfg.PublicBaseURL,
			"resourceUri":   e.cfg.ResourceURI,
			"payableTools":  names,
			"mcpPath":       e.cfg.MCPPath,
			"views":         e.cfg.Views,
			"userAgent":     r.Header.Get("User-Agent"),
		},
	}
	if auth := r.Header.Get("Authorization"); auth != "" {
		params["authHeader"] = auth
	}
	envelope, err := e.client.McpDispatch(r.Context(), params)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	kind, _ := asString(asMap(envelope)["kind"])
	switch kind {
	case "rpc":
		writeJSON(w, http.StatusOK, asMap(envelope)["rpc"])
	case "challenge":
		env := asMap(envelope)
		status := asInt(env["status"], 401)
		for k, v := range asStringMap(env["headers"]) {
			w.Header().Set(k, v)
		}
		writeJSON(w, status, env["body"])
	case "invokeHandler":
		e.resumePayable(w, r, asMap(envelope))
	default:
		http.Error(w, fmt.Sprintf("unexpected mcpDispatch kind: %s", kind), http.StatusInternalServerError)
	}
}

func (e *Engine) resumePayable(w http.ResponseWriter, r *http.Request, envelope map[string]any) {
	tool, _ := asString(envelope["tool"])
	token, _ := asString(envelope["token"])
	e.mu.Lock()
	opts, ok := e.payables[tool]
	e.mu.Unlock()
	if !ok {
		http.Error(w, "unknown payable tool: "+tool, http.StatusInternalServerError)
		return
	}
	args := asMap(envelope["args"])
	if _, has := args["customer_ref"]; !has {
		if ref, ok := asString(envelope["customerRef"]); ok && ref != "" {
			args["customer_ref"] = ref
		}
	}
	result, err := InvokePayable(r.Context(), args, opts)
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	handlerEnvelope, err := json.Marshal(result)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	var handler any
	if err := json.Unmarshal(handlerEnvelope, &handler); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	resumed, err := CallSync(r.Context(), "mcpResume", map[string]any{
		"token":           token,
		"handlerEnvelope": handler,
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	var parsed any
	if err := json.Unmarshal(resumed, &parsed); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, http.StatusOK, asMap(parsed)["rpc"])
}

func pathOnly(path string) string {
	if i := strings.IndexByte(path, '?'); i >= 0 {
		return path[:i]
	}
	return path
}

func writeOAuth(w http.ResponseWriter, envelope any) {
	env := asMap(envelope)
	status := asInt(env["status"], 500)
	for k, v := range asStringMap(env["headers"]) {
		w.Header().Set(k, v)
	}
	writeJSON(w, status, env["body"])
}

func writeJSON(w http.ResponseWriter, status int, body any) {
	if body == nil {
		w.WriteHeader(status)
		return
	}
	if _, ok := w.Header()["Content-Type"]; !ok {
		w.Header().Set("Content-Type", "application/json")
	}
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(body)
}

func asMap(v any) map[string]any {
	if m, ok := v.(map[string]any); ok {
		if m == nil {
			return map[string]any{}
		}
		return m
	}
	return map[string]any{}
}

func asStringMap(v any) map[string]string {
	out := map[string]string{}
	for k, val := range asMap(v) {
		if s, ok := val.(string); ok {
			out[k] = s
		}
	}
	return out
}

func asString(v any) (string, bool) {
	s, ok := v.(string)
	return s, ok
}

func asInt(v any, fallback int) int {
	switch n := v.(type) {
	case float64:
		return int(n)
	case int:
		return n
	case json.Number:
		i, _ := n.Int64()
		return int(i)
	default:
		return fallback
	}
}
