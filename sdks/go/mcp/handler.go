package mcp

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"strings"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
)

// NewStreamableHandler mounts the official Streamable HTTP transport for
// [Server], with OAuth discovery/proxy routes and mcpAuthGate in front of
// /mcp. Stateless mode is required for MCP 2026-07-28.
func NewStreamableHandler(s *Server) http.Handler {
	streamable := mcpsdk.NewStreamableHTTPHandler(
		func(*http.Request) *mcpsdk.Server { return s.MCP },
		&mcpsdk.StreamableHTTPOptions{
			Stateless:                    true,
			PropagateRequestCancellation: true,
			DisableLocalhostProtection:   true,
			JSONResponse:                 true,
		},
	)
	mcp := withAuthGate(s, streamable)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		path := r.URL.Path
		if r.URL.RawQuery != "" {
			path = path + "?" + r.URL.RawQuery
		}
		if pathOnly(r.URL.Path) == s.cfg.MCPPath {
			mcp.ServeHTTP(w, r)
			return
		}
		s.handleOAuth(w, r, path)
	})
}

func withAuthGate(s *Server, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			next.ServeHTTP(w, r)
			return
		}
		raw, err := io.ReadAll(r.Body)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		_ = r.Body.Close()
		r.Body = io.NopCloser(bytes.NewReader(raw))

		var rpc struct {
			ID     json.RawMessage `json:"id"`
			Method string          `json:"method"`
		}
		_ = json.Unmarshal(raw, &rpc)
		method := rpc.Method
		if method == "" {
			method = r.Header.Get("Mcp-Method")
		}

		args := map[string]any{
			"publicBaseUrl": s.cfg.PublicBaseURL,
			"rpcMethod":     method,
			"authMode":      s.cfg.AuthMode,
			"mcpPath":       s.cfg.MCPPath,
		}
		if s.cfg.Hs256Secret != "" {
			args["hs256Secret"] = s.cfg.Hs256Secret
		}
		if s.cfg.JwksJSON != nil {
			args["jwksJson"] = s.cfg.JwksJSON
		}
		if auth := r.Header.Get("Authorization"); auth != "" {
			args["authHeader"] = auth
		}
		if len(rpc.ID) > 0 && string(rpc.ID) != "null" {
			var id any
			if err := json.Unmarshal(rpc.ID, &id); err == nil {
				args["jsonRpcId"] = id
			}
		}
		resolved, err := s.client.McpResolveAuth(r.Context(), args)
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		gate := asMap(resolved)
		if gate["kind"] != "allow" {
			applyNativeCors(w, r)
			status := asInt(gate["status"], 200)
			for k, v := range asStringMap(gate["headers"]) {
				w.Header().Set(k, v)
			}
			writeJSON(w, status, gate["body"])
			return
		}
		next.ServeHTTP(w, r)
	})
}

func (s *Server) handleOAuth(w http.ResponseWriter, r *http.Request, path string) {
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
	envelope, err := s.client.McpOauthRequest(r.Context(), map[string]any{
		"method":  r.Method,
		"path":    path,
		"headers": headers,
		"body":    string(body),
		"config": map[string]any{
			"publicBaseUrl": s.cfg.PublicBaseURL,
			"mcpPath":       s.cfg.MCPPath,
			"productRef":    s.cfg.ProductRef,
			"oauthPaths":    s.cfg.OauthPaths,
		},
	})
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	writeOAuth(w, envelope)
}

func applyNativeCors(w http.ResponseWriter, r *http.Request) {
	args := map[string]any{}
	if origin := r.Header.Get("Origin"); origin != "" {
		args["origin"] = origin
	}
	raw, err := CallSync(r.Context(), "mcpNativeCors", args)
	if err != nil {
		return
	}
	var result map[string]any
	if err := json.Unmarshal(raw, &result); err != nil {
		return
	}
	for k, v := range asStringMap(result["headers"]) {
		w.Header().Set(k, v)
	}
}
