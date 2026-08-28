package mcp

import (
	"context"
	"encoding/json"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

func installCatalogMiddleware(mcpServer *mcpsdk.Server, s *Server) {
	mcpServer.AddReceivingMiddleware(func(next mcpsdk.MethodHandler) mcpsdk.MethodHandler {
		return func(ctx context.Context, method string, req mcpsdk.Request) (mcpsdk.Result, error) {
			res, err := next(ctx, method, req)
			if err != nil {
				return res, err
			}
			if method == "tools/list" {
				if listed, ok := res.(*mcpsdk.ListToolsResult); ok {
					filtered, ferr := filterToolsByAudience(ctx, listed.Tools, s.cfg.HideAudiences, userAgentFromServerRequest(req))
					if ferr != nil {
						return nil, ferr
					}
					listed.Tools = filtered
				}
			}
			applyCatalogTTL(res)
			return res, nil
		}
	})
}

func applyCatalogTTL(res mcpsdk.Result) {
	switch r := res.(type) {
	case *mcpsdk.ListToolsResult:
		if r.TTLMs == 0 {
			r.TTLMs = defaultCatalogTTLMs
		}
	case *mcpsdk.ListResourcesResult:
		if r.TTLMs == 0 {
			r.TTLMs = defaultCatalogTTLMs
		}
	case *mcpsdk.ListPromptsResult:
		if r.TTLMs == 0 {
			r.TTLMs = defaultCatalogTTLMs
		}
	case *mcpsdk.ListResourceTemplatesResult:
		if r.TTLMs == 0 {
			r.TTLMs = defaultCatalogTTLMs
		}
	case *mcpsdk.ReadResourceResult:
		if r.TTLMs == 0 {
			r.TTLMs = defaultCatalogTTLMs
		}
	}
}

func filterToolsByAudience(ctx context.Context, tools []*mcpsdk.Tool, audiences []string, userAgent string) ([]*mcpsdk.Tool, error) {
	if len(audiences) == 0 || len(tools) == 0 {
		return tools, nil
	}
	payload := make([]map[string]any, 0, len(tools))
	for _, tool := range tools {
		item := map[string]any{"name": tool.Name}
		if tool.Meta != nil {
			item["_meta"] = map[string]any(tool.Meta)
		}
		payload = append(payload, item)
	}
	args := map[string]any{
		"tools":     payload,
		"audiences": audiences,
	}
	if userAgent != "" {
		args["userAgent"] = userAgent
	}
	raw, err := CallSync(ctx, "mcpHideToolsByAudience", args)
	if err != nil {
		return nil, err
	}
	var out struct {
		Tools []struct {
			Name string `json:"name"`
		} `json:"tools"`
	}
	if err := json.Unmarshal(raw, &out); err != nil {
		return nil, err
	}
	keep := map[string]struct{}{}
	for _, tool := range out.Tools {
		keep[tool.Name] = struct{}{}
	}
	filtered := make([]*mcpsdk.Tool, 0, len(out.Tools))
	for _, tool := range tools {
		if _, ok := keep[tool.Name]; ok {
			filtered = append(filtered, tool)
		}
	}
	return filtered, nil
}

func userAgentFromServerRequest(req mcpsdk.Request) string {
	extra := req.GetExtra()
	if extra == nil || extra.Header == nil {
		return ""
	}
	return extra.Header.Get("User-Agent")
}
