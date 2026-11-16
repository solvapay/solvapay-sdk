package solvapay

// The SolvaPay MCP App: the checkout, account and top-up widget hosts open in
// an iframe, its Content Security Policy, the _meta its tools carry, and
// hideToolsByAudience. Ported from @solvapay/mcp-core (descriptors.ts,
// csp.ts, hideToolsByAudience.ts) and @solvapay/mcp (buildMcpServer.ts).
//
// The widget is the TypeScript SDK's: mcp-app/ builds @solvapay/react's MCP
// views into one mcp-app.html, which this package embeds (mcp_widget.html;
// scripts/sync_widget.mjs keeps the copy current). It holds nothing
// merchant-specific: the account tool's bootstrap payload carries the
// merchant, product, plans and return URL at runtime.

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"regexp"
	"sort"
	"strings"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const (
	// MCPAppMIMEType is the MIME type every MCP Apps UI resource is served as.
	MCPAppMIMEType = "text/html;profile=mcp-app"
	// resourceURIMetaKey is the flat _meta key hosts older than the
	// 2026-01-26 MCP Apps spec read.
	resourceURIMetaKey = "ui/resourceUri"
	// BootstrapURI is the resource the widget reads its snapshot from.
	BootstrapURI      = "solvapay://bootstrap.json"
	bootstrapMIMEType = "application/json"
	widgetFile        = "mcp-app.html"
)

//go:embed mcp_widget.html
var widgetHTML string

// cspKeys are the Content Security Policy lists a widget declares, in order.
var cspKeys = []string{"resourceDomains", "connectDomains", "frameDomains"}

// DefaultCSP is SOLVAPAY_DEFAULT_CSP: Stripe Elements, its 3-D Secure frame,
// and the fonts Claude injects (assets.claude.ai).
func DefaultCSP() map[string][]string {
	return map[string][]string{
		"resourceDomains": {"https://js.stripe.com", "https://*.stripe.com", "https://b.stripecdn.com", "https://assets.claude.ai"},
		"connectDomains":  {"https://api.stripe.com", "https://m.stripe.com", "https://r.stripe.com", "https://q.stripe.com", "https://errors.stripe.com"},
		"frameDomains":    {"https://js.stripe.com", "https://hooks.stripe.com"},
	}
}

func httpOrigin(raw string) string {
	parsed, err := url.Parse(raw)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Hostname() == "" {
		return ""
	}
	return parsed.Scheme + "://" + parsed.Host
}

// MergeCSP is mergeCsp: the Stripe baseline plus overrides (appended, without
// repeating a domain), plus the SolvaPay API's origin in resourceDomains and
// connectDomains (merchant branding images, API calls). An unknown key is an
// invalid_argument error.
func MergeCSP(overrides map[string][]string, apiBaseURL string) (map[string][]string, error) {
	var unknown []string
	for key := range overrides {
		if key != "resourceDomains" && key != "connectDomains" && key != "frameDomains" {
			unknown = append(unknown, key)
		}
	}
	if len(unknown) > 0 {
		sort.Strings(unknown)
		return nil, newError("invalid_argument", fmt.Sprintf("Unknown CSP keys: %s. Use %s.", strings.Join(unknown, ", "), strings.Join(cspKeys, ", ")))
	}
	var api []string
	if origin := httpOrigin(apiBaseURL); origin != "" {
		api = []string{origin}
	}
	defaults := DefaultCSP()
	merge := func(key string, extras ...[]string) []string {
		merged := append([]string{}, defaults[key]...)
		for _, extra := range extras {
			for _, domain := range extra {
				if !containsString(merged, domain) {
					merged = append(merged, domain)
				}
			}
		}
		return merged
	}
	return map[string][]string{
		"resourceDomains": merge("resourceDomains", overrides["resourceDomains"], api),
		"connectDomains":  merge("connectDomains", overrides["connectDomains"], api),
		"frameDomains":    merge("frameDomains", overrides["frameDomains"]),
	}, nil
}

func containsString(list []string, value string) bool {
	for _, item := range list {
		if item == value {
			return true
		}
	}
	return false
}

var uriHostUnsafe = regexp.MustCompile(`[^a-z0-9-]+`)

// defaultResourceURI is ui://<server name>/mcp-app.html, the name made safe for a URI host.
func defaultResourceURI(serverName string) (string, error) {
	host := strings.Trim(uriHostUnsafe.ReplaceAllString(strings.ToLower(serverName), "-"), "-")
	if host == "" {
		return "", newError("invalid_argument", "The server name has no letters or digits to build a ui:// URI from; set ResourceURI")
	}
	return "ui://" + host + "/" + widgetFile, nil
}

// toolUIMeta is the _meta a tool that opens the widget lists with (registerAppTool).
func toolUIMeta(resourceURI string) mcp.Meta {
	return mcp.Meta{"ui": map[string]any{"resourceUri": resourceURI}, resourceURIMetaKey: resourceURI}
}

// transportToolMeta is the _meta of a tool only the widget calls.
// ui.visibility ['app'] keeps it out of the model's tool list on MCP Apps
// hosts; audience 'ui' is what HideToolsByAudience filters on; ChatGPT needs
// openai/widgetAccessible to let the iframe call it and reads
// openai/visibility (default public) to hide it from the model.
func transportToolMeta(resourceURI string) mcp.Meta {
	return mcp.Meta{
		"ui":                      map[string]any{"resourceUri": resourceURI, "visibility": []any{"app"}},
		"audience":                "ui",
		"openai/widgetAccessible": true,
		"openai/visibility":       "private",
		resourceURIMetaKey:        resourceURI,
	}
}

// withResourceURIKey is registerAppTool's rule: a tool whose _meta names a UI
// resource also carries the flat ui/resourceUri key.
func withResourceURIKey(meta mcp.Meta) mcp.Meta {
	if meta == nil {
		return nil
	}
	ui, _ := meta["ui"].(map[string]any)
	resourceURI, ok := ui["resourceUri"].(string)
	if _, present := meta[resourceURIMetaKey]; !ok || present {
		return meta
	}
	out := mcp.Meta{}
	for key, value := range meta {
		out[key] = value
	}
	out[resourceURIMetaKey] = resourceURI
	return out
}

// ---- tool annotations ----------------------------------------------------

// ToolAnnotations are a tool's behaviour hints. A nil hint is left out of
// tools/list, so a host applies the MCP default; the MCP Go SDK's own
// mcp.ToolAnnotations always writes readOnlyHint and idempotentHint, which
// would turn "not said" into "false".
type ToolAnnotations struct {
	Title           string
	ReadOnlyHint    *bool
	DestructiveHint *bool
	IdempotentHint  *bool
	OpenWorldHint   *bool
}

// Hint is a *bool for a ToolAnnotations field.
func Hint(value bool) *bool { return &value }

func (a ToolAnnotations) wire() map[string]any {
	out := map[string]any{}
	if a.Title != "" {
		out["title"] = a.Title
	}
	for key, hint := range map[string]*bool{
		"readOnlyHint":    a.ReadOnlyHint,
		"destructiveHint": a.DestructiveHint,
		"idempotentHint":  a.IdempotentHint,
		"openWorldHint":   a.OpenWorldHint,
	} {
		if hint != nil {
			out[key] = *hint
		}
	}
	return out
}

// over is a with every hint other sets replaced.
func (a ToolAnnotations) over(other *ToolAnnotations) ToolAnnotations {
	if other == nil {
		return a
	}
	if other.Title != "" {
		a.Title = other.Title
	}
	for _, pair := range []struct{ to, from **bool }{
		{&a.ReadOnlyHint, &other.ReadOnlyHint},
		{&a.DestructiveHint, &other.DestructiveHint},
		{&a.IdempotentHint, &other.IdempotentHint},
		{&a.OpenWorldHint, &other.OpenWorldHint},
	} {
		if *pair.from != nil {
			*pair.to = *pair.from
		}
	}
	return a
}

// ---- tools/list ------------------------------------------------------------

// wireResult is a result written as raw JSON: tools/list as this server
// lists it (annotations as registered, hidden audiences left out).
type wireResult struct {
	mcp.ResultBase
	raw map[string]any
}

func (w *wireResult) MarshalJSON() ([]byte, error) { return marshalJS(w.raw) }

var chatGPTClient = regexp.MustCompile(`(?i)openai-mcp`)

// IsChatGPTRequest is defaultIsChatGptRequest: the User-Agent, else the client
// name from initialize, names ChatGPT's MCP client.
func IsChatGPTRequest(_ context.Context, req mcp.Request) bool {
	if extra := req.GetExtra(); extra != nil && extra.Header != nil {
		if chatGPTClient.MatchString(extra.Header.Get("User-Agent")) {
			return true
		}
	}
	if session, ok := req.GetSession().(*mcp.ServerSession); ok {
		if params := session.InitializeParams(); params != nil && params.ClientInfo != nil {
			return chatGPTClient.MatchString(params.ClientInfo.Name)
		}
	}
	return false
}

// listTools rewrites tools/list: each tool's annotations as registered, and
// tools whose _meta.audience is hidden left out unless bypass says this
// client gets the full list (ChatGPT checks an iframe's tools/call against
// the listed tools, so a hidden tool would fail there).
func (s *MCPServer) listTools(next mcp.MethodHandler) mcp.MethodHandler {
	return func(ctx context.Context, method string, req mcp.Request) (mcp.Result, error) {
		result, err := next(ctx, method, req)
		if err != nil || method != "tools/list" {
			return result, err
		}
		listed, ok := result.(*mcp.ListToolsResult)
		if !ok {
			return nil, newError("unexpected_result", fmt.Sprintf("tools/list answered with %T, not a tools list", result))
		}
		hide := len(s.hiddenAudiences) > 0 && !s.hideBypass(ctx, req)
		if len(s.hiddenAudiences) > 0 && !hide {
			s.bypassWarning.Do(func() {
				s.logger.Warn("HideToolsByAudience bypassed (ChatGPT or HideToolsBypass); returning the full tools/list")
			})
		}
		raw, err := toJSONValue(listed)
		if err != nil {
			return nil, err
		}
		fields := raw.(map[string]any)
		tools := []any{}
		for _, tool := range listed.Tools {
			if hide {
				if audience, ok := tool.Meta["audience"].(string); ok && s.hiddenAudiences[audience] {
					continue
				}
			}
			value, err := toJSONValue(tool)
			if err != nil {
				return nil, err
			}
			wire := value.(map[string]any)
			s.mu.Lock()
			annotations, registered := s.annotations[tool.Name]
			s.mu.Unlock()
			if registered {
				wire["annotations"] = annotations
			}
			tools = append(tools, wire)
		}
		fields["tools"] = tools
		return &wireResult{raw: fields}, nil
	}
}

// toJSONValue is v as encoding/json decodes it into any.
func toJSONValue(v any) (any, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return nil, err
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	return out, nil
}

// marshalJS is JSON.stringify(v): compact, and <, > and & left as they are.
func marshalJS(v any) ([]byte, error) {
	var buf strings.Builder
	encoder := json.NewEncoder(&buf)
	encoder.SetEscapeHTML(false)
	if err := encoder.Encode(v); err != nil {
		return nil, err
	}
	return []byte(strings.TrimSuffix(buf.String(), "\n")), nil
}

func jsonText(v any) (string, error) {
	raw, err := marshalJS(v)
	if err != nil {
		return "", &Error{Code: "invalid_argument", Message: "The tool's data cannot be written as JSON: " + err.Error()}
	}
	return string(raw), nil
}
