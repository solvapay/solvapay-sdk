package solvapay

// NewMCPServer: an MCP server, on the official MCP Go SDK, whose customers
// sign in with SolvaPay and whose tools are paid. Ported from @solvapay/mcp
// (server.ts, internal/buildMcpServer.ts) and @solvapay/mcp-core
// (descriptors.ts).
//
//	client, _ := solvapay.NewClient(solvapay.Config{})
//	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
//		Client:        client,
//		ProductRef:    "prd_…",
//		PublicBaseURL: "https://research.example.com",
//	})
//	err = server.RegisterPayable("quote", solvapay.PaidTool{
//		Description: "Latest price for a symbol.",
//		InputSchema: map[string]any{"type": "object", "properties": map[string]any{"symbol": map[string]any{"type": "string"}}, "required": []any{"symbol"}},
//		Handler: func(ctx context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
//			return rc.Respond(map[string]any{"price": 101.5}, solvapay.RespondOptions{}), nil
//		},
//	})
//	http.ListenAndServe(":8080", server.Handler()) // the MCP endpoint is /mcp

import (
	"context"
	"encoding/json"
	"fmt"
	"log/slog"
	"net/http"
	"strings"
	"sync"

	"github.com/google/jsonschema-go/jsonschema"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

// CustomerRefFunc says who the customer is for one MCP request: a SolvaPay
// customer reference, or "" for none. The default reads the customer
// SolvaPay verified for the request's bearer token.
type CustomerRefFunc func(ctx context.Context, req mcp.Request) (string, error)

// VerifiedCustomerRef is the default CustomerRefFunc: the customer SolvaPay
// verified the request's bearer token for (Handler's sign-in), or "".
func VerifiedCustomerRef(_ context.Context, req mcp.Request) (string, error) {
	extra := req.GetExtra()
	if extra == nil || extra.TokenInfo == nil {
		return "", nil
	}
	return extra.TokenInfo.UserID, nil
}

// MCPServerOptions configures NewMCPServer. Client, PublicBaseURL and a
// product (ProductRef or SOLVAPAY_PRODUCT_REF) are required.
type MCPServerOptions struct {
	Client *Client
	// Paywall decides the paid tools' calls; nil builds one for Client and ProductRef.
	Paywall    *Paywall
	ProductRef string
	// PublicBaseURL is where clients reach this server (an ngrok URL in
	// development): the OAuth issuer clients see, and where Stripe sends the
	// customer back after 3-D Secure. It must be http(s).
	PublicBaseURL string

	Name, Version, Instructions string // Name defaults to "solvapay-mcp", Version to "1.0.0"
	// MCPPath is the MCP endpoint's path; "" means "/mcp".
	MCPPath    string
	OAuthPaths OAuthPaths
	// HTTPClient forwards the OAuth steps to SolvaPay and verifies bearer
	// tokens; nil means a client with a 30 second timeout.
	HTTPClient *http.Client

	// Views the account tool offers: nil means checkout, account and topup;
	// an empty, non-nil slice leaves the account tool out.
	Views []string
	// GetCustomerRef overrides who the customer is for SolvaPay's own tools;
	// nil means VerifiedCustomerRef.
	GetCustomerRef CustomerRefFunc
	// ResourceURI is the widget's ui:// resource; "" means ui://<Name>/mcp-app.html.
	ResourceURI string
	// CSP adds domains to the widget's Content Security Policy
	// (resourceDomains, connectDomains, frameDomains).
	CSP map[string][]string
	// HideToolsByAudience leaves tools whose _meta.audience is listed out of
	// tools/list, for hosts that ignore _meta.ui.visibility. They stay callable.
	HideToolsByAudience []string
	// HideToolsBypass says which clients still get the full list; nil means
	// IsChatGPTRequest (ChatGPT's iframe can only call listed tools).
	HideToolsBypass func(ctx context.Context, req mcp.Request) bool

	Logger *slog.Logger
}

// MCPServer is an *mcp.Server with SolvaPay's tools, plus the paid-tool
// registration and the HTTP handler (sign-in and the MCP endpoint).
type MCPServer struct {
	server         *mcp.Server
	client         *Client
	paywall        *Paywall
	productRef     string
	publicBaseURL  string
	mcpPath        string
	oauthPaths     OAuthPaths
	resourceURI    string
	httpClient     *http.Client
	getCustomerRef CustomerRefFunc
	logger         *slog.Logger
	views          []string

	hiddenAudiences map[string]bool
	hideBypass      func(context.Context, mcp.Request) bool
	bypassWarning   sync.Once

	mu          sync.Mutex
	annotations map[string]map[string]any
	freeMeters  map[string]*freeMeter
	verifier    *tokenVerifier
}

type freeMeter struct {
	limit FreeLimit
	tools []string
}

// NewMCPServer builds the server with SolvaPay's built-in tools, as the
// TypeScript server does: account (checkout, account and top-up views) and
// activate_plan, the six tools the widget calls, the /upgrade,
// /manage_account, /topup and /activate_plan prompts, the
// docs://solvapay/overview.md resource, solvapay://bootstrap.json and the
// widget itself.
func NewMCPServer(options MCPServerOptions) (*MCPServer, error) {
	if options.Client == nil {
		return nil, newError("invalid_argument", "NewMCPServer needs a Client")
	}
	if !strings.HasPrefix(options.PublicBaseURL, "https://") && !strings.HasPrefix(options.PublicBaseURL, "http://") {
		return nil, newError("invalid_argument", "PublicBaseURL must be an http(s) URL")
	}
	paywall := options.Paywall
	if paywall == nil {
		var err error
		if paywall, err = NewPaywall(options.Client, PaywallOptions{ProductRef: options.ProductRef, Logger: options.Logger}); err != nil {
			return nil, err
		}
	}
	product, err := paywall.requireProduct(options.ProductRef)
	if err != nil {
		return nil, err
	}
	name := options.Name
	if name == "" {
		name = "solvapay-mcp"
	}
	version := options.Version
	if version == "" {
		version = "1.0.0"
	}
	resourceURI := options.ResourceURI
	if resourceURI == "" {
		if resourceURI, err = defaultResourceURI(name); err != nil {
			return nil, err
		}
	}
	if !strings.HasPrefix(resourceURI, "ui://") {
		return nil, newError("invalid_argument", fmt.Sprintf("ResourceURI must use the ui:// scheme, got %q", resourceURI))
	}
	views := options.Views
	if views == nil {
		views = AdvertisedViews
	}
	for _, view := range views {
		if !containsString(AdvertisedViews, view) {
			return nil, newError("invalid_argument", fmt.Sprintf("Unknown view %q. Use checkout, account or topup.", view))
		}
	}
	csp, err := MergeCSP(options.CSP, options.Client.APIBaseURL())
	if err != nil {
		return nil, err
	}
	mcpPath := options.MCPPath
	if mcpPath == "" {
		mcpPath = "/mcp"
	}
	httpClient := options.HTTPClient
	if httpClient == nil {
		httpClient = &http.Client{Timeout: defaultBridgeTimeout}
	}
	logger := options.Logger
	if logger == nil {
		logger = slog.Default()
	}
	getCustomerRef := options.GetCustomerRef
	if getCustomerRef == nil {
		getCustomerRef = VerifiedCustomerRef
	}
	s := &MCPServer{
		server:         mcp.NewServer(&mcp.Implementation{Name: name, Version: version}, &mcp.ServerOptions{Instructions: options.Instructions, Logger: options.Logger}),
		client:         options.Client,
		paywall:        paywall,
		productRef:     product,
		publicBaseURL:  strings.TrimSuffix(options.PublicBaseURL, "/"),
		mcpPath:        mcpPath,
		oauthPaths:     options.OAuthPaths.withDefaults(),
		resourceURI:    resourceURI,
		httpClient:     httpClient,
		getCustomerRef: getCustomerRef,
		logger:         logger,
		views:          views,
		hideBypass:     options.HideToolsBypass,
		annotations:    map[string]map[string]any{},
		freeMeters:     map[string]*freeMeter{},
	}
	if len(options.HideToolsByAudience) > 0 {
		s.hiddenAudiences = map[string]bool{}
		for _, audience := range options.HideToolsByAudience {
			s.hiddenAudiences[audience] = true
		}
	}
	if s.hideBypass == nil {
		s.hideBypass = IsChatGPTRequest
	}
	s.verifier = newTokenVerifier(options.Client.APIBaseURL(), httpClient)
	s.server.AddReceivingMiddleware(s.listTools)

	// The account tool and the overview's returnUrl keep PublicBaseURL as given.
	if err := s.registerIntentTools(options.PublicBaseURL); err != nil {
		return nil, err
	}
	if err := s.registerTransportTools(); err != nil {
		return nil, err
	}
	s.registerAppResources(csp, options.PublicBaseURL)
	return s, nil
}

// Server is the underlying MCP server, for adding your own tools, prompts
// and resources with the MCP Go SDK.
func (s *MCPServer) Server() *mcp.Server { return s.server }

// ProductRef is the product this server's tools are for.
func (s *MCPServer) ProductRef() string { return s.productRef }

// customerRef resolves who the customer is: a signed-in customer, or "".
func (s *MCPServer) customerRef(ctx context.Context, req mcp.Request, override CustomerRefFunc) (string, error) {
	resolve := override
	if resolve == nil {
		resolve = s.getCustomerRef
	}
	ref, err := resolve(ctx, req)
	if err != nil {
		return "", err
	}
	return signedInCustomerRef(ref), nil
}

// toolSpec is one tool to add: its descriptor, its annotations as listed,
// and its handler.
type toolSpec struct {
	name, title, description string
	annotations              ToolAnnotations
	meta                     mcp.Meta
	inputSchema              any
	// normalise rewrites arguments before they are checked (an old spelling, say).
	normalise func(args map[string]any)
	handler   func(ctx context.Context, req *mcp.CallToolRequest, args map[string]any) (*mcp.CallToolResult, error)
}

// addTool registers a tool whose arguments are checked against its input
// schema before the handler runs (the MCP Go SDK leaves that to a raw
// handler), as zod and pydantic check them in the other SDKs.
func (s *MCPServer) addTool(spec toolSpec) error {
	if spec.inputSchema == nil {
		spec.inputSchema = map[string]any{"type": "object", "properties": map[string]any{}}
	}
	raw, err := json.Marshal(spec.inputSchema)
	if err != nil {
		return &Error{Code: "invalid_argument", Message: fmt.Sprintf("Tool %s: the input schema is not JSON: %v", spec.name, err)}
	}
	var schema jsonschema.Schema
	if err := json.Unmarshal(raw, &schema); err != nil {
		return &Error{Code: "invalid_argument", Message: fmt.Sprintf("Tool %s: the input schema is not a JSON Schema: %v", spec.name, err)}
	}
	if schema.Type != "object" {
		return &Error{Code: "invalid_argument", Message: fmt.Sprintf("Tool %s: the input schema must have type object", spec.name)}
	}
	resolved, err := schema.Resolve(nil)
	if err != nil {
		return &Error{Code: "invalid_argument", Message: fmt.Sprintf("Tool %s: the input schema does not resolve: %v", spec.name, err)}
	}
	var wireSchema any
	if err := json.Unmarshal(raw, &wireSchema); err != nil {
		return err
	}
	s.mu.Lock()
	if _, taken := s.annotations[spec.name]; taken {
		s.mu.Unlock()
		return newError("invalid_argument", fmt.Sprintf("A tool named %s is already registered", spec.name))
	}
	s.annotations[spec.name] = spec.annotations.wire()
	s.mu.Unlock()
	handler := spec.handler
	s.server.AddTool(&mcp.Tool{
		Name:        spec.name,
		Title:       spec.title,
		Description: spec.description,
		Meta:        spec.meta,
		InputSchema: wireSchema,
	}, func(ctx context.Context, req *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		args, err := decodeArguments(req)
		if err == nil && spec.normalise != nil {
			spec.normalise(args)
		}
		if err == nil {
			err = resolved.Validate(args)
		}
		if err != nil {
			var result mcp.CallToolResult
			result.SetError(fmt.Errorf("validating \"arguments\": %v", err))
			return &result, nil
		}
		return handler(ctx, req, args)
	})
	return nil
}
