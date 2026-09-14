package mcp

import (
	"context"
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

//go:embed mcp-app.html
var mcpAppHTML string

const MCPAppMIMEType = "text/html;profile=mcp-app"

func DefaultMCPAppHTML() string {
	return mcpAppHTML
}

func defaultWidgetHasRootMount() bool {
	return strings.Contains(mcpAppHTML, `id="root"`)
}

// widgetReadHandler serves the widget resource from the core envelope, then
// swaps in the host-supplied HTML body.
func (s *Server) widgetReadHandler() mcpsdk.ResourceHandler {
	return func(ctx context.Context, req *mcpsdk.ReadResourceRequest) (*mcpsdk.ReadResourceResult, error) {
		params := map[string]any{"uri": s.cfg.ResourceURI}
		if req != nil && req.Params != nil {
			if req.Params.URI != "" {
				params["uri"] = req.Params.URI
			}
			if req.Params.Meta != nil {
				params["_meta"] = req.Params.Meta
			}
		}
		rpc := map[string]any{
			"jsonrpc": "2.0",
			"id":      1,
			"method":  "resources/read",
			"params":  params,
		}
		var views any
		if len(s.cfg.Views) > 0 {
			views = s.cfg.Views
		}
		var api any
		if s.cfg.APIBaseURL != "" {
			api = s.cfg.APIBaseURL
		}
		raw, err := McpWidgetResource(
			ctx,
			rpc,
			s.cfg.ResourceURI,
			s.cfg.PublicBaseURL,
			s.cfg.ProductRef,
			views,
			s.cfg.CSP,
			api,
			s.cfg.Branding,
		)
		if err != nil {
			return nil, err
		}
		if len(raw) == 0 || string(raw) == "null" {
			return nil, fmt.Errorf("mcpWidgetResource returned no envelope")
		}
		var envelope map[string]any
		if err := json.Unmarshal(raw, &envelope); err != nil {
			return nil, err
		}
		result := asMap(envelope["result"])
		contents, _ := result["contents"].([]any)
		if len(contents) == 0 {
			return nil, fmt.Errorf("mcpWidgetResource omitted contents[0]")
		}
		first := asMap(contents[0])
		first["text"] = s.cfg.ReadHTML()
		contents[0] = first
		result["contents"] = contents
		outRaw, err := json.Marshal(result)
		if err != nil {
			return nil, err
		}
		var out mcpsdk.ReadResourceResult
		if err := json.Unmarshal(outRaw, &out); err != nil {
			return nil, err
		}
		return &out, nil
	}
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
