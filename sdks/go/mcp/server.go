package mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
)

// ServerConfig configures [NewServer].
type ServerConfig struct {
	ProductRef    string
	PublicBaseURL string
	ResourceURI   string
	MCPPath       string
	Views         []string
	CSP           *CSP
	APIBaseURL    string
	Branding      *Branding
	ServerName    string
	ServerVersion string
	ReadHTML      func() string
	HideAudiences []string
	OauthPaths    map[string]any
	AuthMode      string // "tools-call" (default) or "all"
	// Hs256Secret is an explicit local/stub JWT secret. Never inferred.
	Hs256Secret string
	// JwksJSON is a preloaded JWKS document for RS256/ES256.
	JwksJSON any
	// NowUnixSecs overrides the clock for bearer exp/nbf. Zero uses time.Now.
	NowUnixSecs int64
}

// Server is the SolvaPay MCP server built on the official go-sdk.
type Server struct {
	MCP    *mcpsdk.Server
	client *solvapay.Client
	cfg    ServerConfig
	bundle DescriptorsBundle

	mu       sync.Mutex
	payables map[string]Options

	jwksMu    sync.Mutex
	jwksCache any
	jwksExp   time.Time
}

// NewServer builds an official MCP server with SolvaPay builtins, the
// widget resource, docs, and bootstrap. Register merchant tools with
// [Server.RegisterPayable] (or [RegisterPayableTool] on Server.MCP).
func NewServer(ctx context.Context, client *solvapay.Client, cfg ServerConfig) (*Server, error) {
	if client == nil {
		return nil, fmt.Errorf("SolvaPay client is required")
	}
	if cfg.ProductRef == "" {
		return nil, fmt.Errorf("ProductRef is required")
	}
	if cfg.PublicBaseURL == "" {
		return nil, fmt.Errorf("PublicBaseURL is required")
	}
	if cfg.ResourceURI == "" {
		cfg.ResourceURI = "ui://widget.html"
	}
	if cfg.MCPPath == "" {
		cfg.MCPPath = "/mcp"
	}
	if cfg.ServerName == "" {
		if cfg.Branding != nil && cfg.Branding.BrandName != "" {
			cfg.ServerName = cfg.Branding.BrandName
		} else {
			cfg.ServerName = "solvapay-mcp-server"
		}
	}
	if cfg.ServerVersion == "" {
		cfg.ServerVersion = "1.0.0"
	}
	if cfg.ReadHTML == nil {
		cfg.ReadHTML = DefaultMCPAppHTML
	}
	if cfg.AuthMode == "" {
		cfg.AuthMode = "tools-call"
	}
	if len(cfg.HideAudiences) == 0 {
		cfg.HideAudiences = []string{"ui"}
	}

	bundle, err := Descriptors(ctx, DescriptorsInput{
		ResourceURI:   cfg.ResourceURI,
		PublicBaseURL: cfg.PublicBaseURL,
		ProductRef:    cfg.ProductRef,
		Views:         cfg.Views,
		CSP:           cfg.CSP,
		APIBaseURL:    cfg.APIBaseURL,
		Branding:      cfg.Branding,
	})
	if err != nil {
		return nil, err
	}

	mcpServer := mcpsdk.NewServer(&mcpsdk.Implementation{
		Name:    cfg.ServerName,
		Version: cfg.ServerVersion,
	}, nil)

	s := &Server{
		MCP:      mcpServer,
		client:   client,
		cfg:      cfg,
		bundle:   bundle,
		payables: map[string]Options{},
	}

	uiMeta := widgetUIMeta(bundle.Resource.CSP)
	mcpServer.AddResource(&mcpsdk.Resource{
		URI:      bundle.Resource.URI,
		Name:     "SolvaPay widget",
		MIMEType: MCPAppMIMEType,
		Meta:     uiMeta,
	}, func(_ context.Context, _ *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
		return &mcpsdk.ReadResourceResult{
			Contents: []*mcpsdk.ResourceContents{{
				URI:      bundle.Resource.URI,
				MIMEType: MCPAppMIMEType,
				Text:     cfg.ReadHTML(),
				Meta:     uiMeta,
			}},
		}, nil
	})

	s.registerNamedResource(bundle.Docs)
	s.registerNamedResource(bundle.Bootstrap)

	for _, prompt := range bundle.Prompts {
		p := prompt
		mcpServer.AddPrompt(&mcpsdk.Prompt{
			Name:        p.Name,
			Title:       p.Title,
			Description: p.Description,
		}, s.promptHandler(p.Name))
	}

	for _, tool := range bundle.Tools {
		s.registerBuiltinTool(tool)
	}

	installCatalogMiddleware(mcpServer, s)
	return s, nil
}

// RegisterPayable records a merchant tool on the official server and routes
// tools/call through mcpDispatch so OAuth bearer identity reaches the gate.
func (s *Server) RegisterPayable(name string, opts Options) error {
	if opts.Client == nil {
		opts.Client = s.client
	}
	if err := validatePayableOptions(name, &opts); err != nil {
		return err
	}
	schema, err := compileInputSchema(opts.InputSchema)
	if err != nil {
		return err
	}
	s.mu.Lock()
	s.payables[name] = opts
	s.mu.Unlock()
	s.MCP.AddTool(&mcpsdk.Tool{
		Name:        name,
		Title:       opts.Title,
		Description: opts.Description,
		InputSchema: schema,
	}, s.dispatchToolHandler(name))
	return nil
}

func (s *Server) payableNames() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	names := make([]string, 0, len(s.payables))
	for name := range s.payables {
		names = append(names, name)
	}
	return names
}

func (s *Server) registerNamedResource(named DescriptorNamedURI) {
	s.MCP.AddResource(&mcpsdk.Resource{
		URI:         named.URI,
		Name:        named.Name,
		Title:       named.Title,
		Description: named.Description,
		MIMEType:    named.MIMEType,
	}, func(ctx context.Context, req *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
		return s.dispatchResourceRead(ctx, req)
	})
}

func (s *Server) registerBuiltinTool(tool DescriptorTool) {
	meta := decodeMeta(tool.Meta)
	annotations := decodeToolAnnotations(tool.Annotations)
	var inputSchema any
	if len(tool.InputSchema) > 0 && string(tool.InputSchema) != "null" {
		inputSchema = json.RawMessage(tool.InputSchema)
	}
	title := tool.Title
	if title == "" {
		title = tool.Name
	}
	s.MCP.AddTool(&mcpsdk.Tool{
		Name:        tool.Name,
		Title:       title,
		Description: tool.Description,
		InputSchema: inputSchema,
		Annotations: annotations,
		Meta:        meta,
	}, s.dispatchToolHandler(tool.Name))
}

func (s *Server) dispatchToolHandler(name string) mcpsdk.ToolHandler {
	return func(ctx context.Context, req *mcpsdk.CallToolRequest) (*mcpsdk.CallToolResult, error) {
		args := any(map[string]any{})
		if req != nil && req.Params != nil && len(req.Params.Arguments) > 0 && string(req.Params.Arguments) != "null" {
			var parsed any
			if err := json.Unmarshal(req.Params.Arguments, &parsed); err != nil {
				return nil, fmt.Errorf("decode tool arguments: %w", err)
			}
			args = parsed
		}
		rpc := map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "tools/call",
			"params": map[string]any{
				"name":      name,
				"arguments": args,
			},
		}
		envelope, err := s.dispatch(ctx, rpc, req)
		if err != nil {
			return nil, err
		}
		kind, _ := asString(asMap(envelope)["kind"])
		switch kind {
		case "rpc":
			result := asMap(asMap(envelope)["rpc"])["result"]
			raw, err := json.Marshal(result)
			if err != nil {
				return nil, err
			}
			out, err := payloadToCallToolResult(raw)
			if err != nil {
				return nil, err
			}
			stampWidgetResultMeta(out, s.cfg.ResourceURI)
			return out, nil
		case "challenge":
			return nil, fmt.Errorf("unauthorized: tool %s requires a bearer token for tools/call (authMode %s)", name, s.cfg.AuthMode)
		case "invokeHandler":
			return s.resumePayableFromEnvelope(ctx, asMap(envelope))
		default:
			return nil, fmt.Errorf("unexpected mcpDispatch kind: %s", kind)
		}
	}
}

func (s *Server) promptHandler(name string) mcpsdk.PromptHandler {
	return func(ctx context.Context, req *mcpsdk.GetPromptRequest) (*mcpsdk.GetPromptResult, error) {
		params := map[string]any{"name": name}
		if req != nil && req.Params != nil && req.Params.Arguments != nil {
			params["arguments"] = req.Params.Arguments
		}
		rpc := map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "prompts/get",
			"params":  params,
		}
		envelope, err := s.dispatch(ctx, rpc, nil)
		if err != nil {
			return nil, err
		}
		if asMap(envelope)["kind"] != "rpc" {
			return nil, fmt.Errorf("unexpected prompts/get kind: %v", asMap(envelope)["kind"])
		}
		raw, err := json.Marshal(asMap(asMap(envelope)["rpc"])["result"])
		if err != nil {
			return nil, err
		}
		var out mcpsdk.GetPromptResult
		if err := json.Unmarshal(raw, &out); err != nil {
			return nil, err
		}
		return &out, nil
	}
}

func (s *Server) dispatchResourceRead(ctx context.Context, req *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
	uri := ""
	if req != nil && req.Params != nil {
		uri = req.Params.URI
	}
	rpc := map[string]any{
		"jsonrpc": "2.0",
		"id":      1,
		"method":  "resources/read",
		"params":  map[string]any{"uri": uri},
	}
	envelope, err := s.dispatch(ctx, rpc, nil)
	if err != nil {
		return nil, err
	}
	if asMap(envelope)["kind"] != "rpc" {
		return nil, fmt.Errorf("unexpected resources/read kind: %v", asMap(envelope)["kind"])
	}
	raw, err := json.Marshal(asMap(asMap(envelope)["rpc"])["result"])
	if err != nil {
		return nil, err
	}
	var out mcpsdk.ReadResourceResult
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return &out, nil
}

func (s *Server) dispatch(ctx context.Context, rpc any, req *mcpsdk.CallToolRequest) (any, error) {
	params := map[string]any{
		"rpc": rpc,
		"config": map[string]any{
			"productRef":    s.cfg.ProductRef,
			"publicBaseUrl": s.cfg.PublicBaseURL,
			"resourceUri":   s.cfg.ResourceURI,
			"payableTools":  s.payableNames(),
			"mcpPath":       s.cfg.MCPPath,
			"views":         s.cfg.Views,
			"authMode":      s.cfg.AuthMode,
		},
	}
	if len(s.cfg.HideAudiences) > 0 {
		asMap(params["config"])["hideAudiences"] = s.cfg.HideAudiences
	}
	if s.cfg.Hs256Secret != "" {
		asMap(params["config"])["hs256Secret"] = s.cfg.Hs256Secret
	}
	if auth := authHeaderFromRequest(req); auth != "" {
		jwks, err := s.resolvedJwks(ctx)
		if err != nil {
			return nil, err
		}
		if jwks != nil {
			asMap(params["config"])["jwksJson"] = jwks
		}
	} else if s.cfg.JwksJSON != nil {
		asMap(params["config"])["jwksJson"] = s.cfg.JwksJSON
	}
	now := s.cfg.NowUnixSecs
	if now == 0 {
		now = time.Now().Unix()
	}
	asMap(params["config"])["nowUnixSecs"] = now
	if auth := authHeaderFromRequest(req); auth != "" {
		params["authHeader"] = auth
	}
	if ua := userAgentFromRequest(req); ua != "" {
		asMap(params["config"])["userAgent"] = ua
	}
	return s.client.McpDispatch(ctx, params)
}

const jwksCacheTTL = 10 * time.Minute

func (s *Server) resolvedJwks(ctx context.Context) (any, error) {
	if s.cfg.JwksJSON != nil {
		return s.cfg.JwksJSON, nil
	}
	if s.cfg.Hs256Secret != "" {
		return nil, nil
	}
	url := strings.TrimRight(s.cfg.PublicBaseURL, "/") + "/.well-known/jwks.json"
	s.jwksMu.Lock()
	defer s.jwksMu.Unlock()
	if s.jwksCache != nil && time.Now().Before(s.jwksExp) {
		return s.jwksCache, nil
	}
	got, err := s.client.FetchJwks(ctx, map[string]any{"jwksUrl": url})
	if err != nil {
		return nil, err
	}
	s.jwksCache = got
	s.jwksExp = time.Now().Add(jwksCacheTTL)
	return got, nil
}

func (s *Server) resumePayableFromEnvelope(ctx context.Context, envelope map[string]any) (*mcpsdk.CallToolResult, error) {
	tool, _ := asString(envelope["tool"])
	token, _ := asString(envelope["token"])
	s.mu.Lock()
	opts, ok := s.payables[tool]
	s.mu.Unlock()
	if !ok {
		return nil, fmt.Errorf("unknown payable tool: %s", tool)
	}
	args := asMap(envelope["args"])
	if _, has := args["customer_ref"]; !has {
		if ref, ok := asString(envelope["customerRef"]); ok && ref != "" {
			args["customer_ref"] = ref
		}
	}
	if opts.GetCustomerRef == nil {
		if ref, _ := args["customer_ref"].(string); ref == "" {
			return nil, fmt.Errorf(
				"payable tool %s: bearer token carries no customer identity (checked customerRef, customer_ref, sub) and no customer_ref argument", tool)
		}
	}
	result, err := InvokePayable(ctx, args, opts)
	if err != nil {
		return nil, err
	}
	handlerEnvelope, err := json.Marshal(result)
	if err != nil {
		return nil, err
	}
	var handler any
	if err := json.Unmarshal(handlerEnvelope, &handler); err != nil {
		return nil, err
	}
	resumed, err := CallSync(ctx, "mcpResume", map[string]any{
		"token":           token,
		"handlerEnvelope": handler,
	})
	if err != nil {
		return nil, err
	}
	var parsed any
	if err := json.Unmarshal(resumed, &parsed); err != nil {
		return nil, err
	}
	raw, err := json.Marshal(asMap(asMap(parsed)["rpc"])["result"])
	if err != nil {
		return nil, err
	}
	return payloadToCallToolResult(raw)
}

func widgetUIMeta(csp CSP) mcpsdk.Meta {
	return mcpsdk.Meta{
		"ui": map[string]any{
			"csp": map[string]any{
				"resourceDomains": csp.ResourceDomains,
				"connectDomains":  csp.ConnectDomains,
				"frameDomains":    csp.FrameDomains,
			},
			"prefersBorder": false,
		},
	}
}

func decodeMeta(raw json.RawMessage) mcpsdk.Meta {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var meta map[string]any
	if err := json.Unmarshal(raw, &meta); err != nil {
		return nil
	}
	return mcpsdk.Meta(meta)
}

func decodeToolAnnotations(raw json.RawMessage) *mcpsdk.ToolAnnotations {
	if len(raw) == 0 || string(raw) == "null" {
		return nil
	}
	var a mcpsdk.ToolAnnotations
	if err := json.Unmarshal(raw, &a); err != nil {
		return nil
	}
	return &a
}

func stampWidgetResultMeta(result *mcpsdk.CallToolResult, resourceURI string) {
	if result == nil || resourceURI == "" {
		return
	}
	if result.Meta == nil {
		result.Meta = mcpsdk.Meta{}
	}
	ui, _ := result.Meta["ui"].(map[string]any)
	if ui == nil {
		ui = map[string]any{}
	}
	if _, ok := ui["resourceUri"].(string); !ok {
		ui["resourceUri"] = resourceURI
	}
	result.Meta["ui"] = ui
	if _, ok := result.Meta["ui/resourceUri"]; !ok {
		result.Meta["ui/resourceUri"] = resourceURI
	}
}

func authHeaderFromRequest(req *mcpsdk.CallToolRequest) string {
	if req == nil {
		return ""
	}
	extra := req.GetExtra()
	if extra == nil || extra.Header == nil {
		return ""
	}
	return extra.Header.Get("Authorization")
}

func userAgentFromRequest(req *mcpsdk.CallToolRequest) string {
	if req == nil {
		return ""
	}
	extra := req.GetExtra()
	if extra == nil || extra.Header == nil {
		return ""
	}
	return extra.Header.Get("User-Agent")
}
