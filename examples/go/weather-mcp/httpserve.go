package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"net/url"
	"strings"

	solvapay "github.com/solvapay/solvapay-go"
	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

type httpServeConfig struct {
	ProductRef    string
	PublicBaseURL string
	Source        Source
}

func newHTTPHandler(client *solvapay.Client, cfg httpServeConfig) (http.Handler, error) {
	if client == nil {
		return nil, fmt.Errorf("SolvaPay client is required")
	}
	if cfg.ProductRef == "" {
		return nil, fmt.Errorf("product ref is required")
	}
	if cfg.PublicBaseURL == "" {
		return nil, fmt.Errorf("public base URL is required")
	}
	if cfg.Source == nil {
		return nil, fmt.Errorf("weather source is required")
	}
	srv, err := newSolvaPayServer(context.Background(), client, cfg.ProductRef, cfg.PublicBaseURL, cfg.Source, nil)
	if err != nil {
		return nil, err
	}
	mcpHandler := solvapaymcp.NewStreamableHandler(srv)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","server":"weather-mcp"}`))
		case "/", "":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusNotFound)
			_ = json.NewEncoder(w).Encode(map[string]any{
				"error":       "not_found",
				"message":     "This is the origin root. The MCP endpoint is /mcp.",
				"mcpEndpoint": "/mcp",
			})
		default:
			log.Printf("%s %s", r.Method, r.URL.RequestURI())
			mcpHandler.ServeHTTP(w, r)
		}
	})
	return withCORS(inner), nil
}

func withCORS(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if origin := r.Header.Get("Origin"); origin != "" {
			w.Header().Set("Access-Control-Allow-Origin", origin)
			w.Header().Add("Vary", "Origin")
		}
		w.Header().Set("Access-Control-Expose-Headers", "WWW-Authenticate, Mcp-Session-Id")
		if r.Method == http.MethodOptions {
			w.Header().Set("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
			reqHeaders := r.Header.Get("Access-Control-Request-Headers")
			if reqHeaders == "" {
				reqHeaders = "authorization, content-type, mcp-session-id, mcp-protocol-version, mcp-method, mcp-name"
			}
			w.Header().Set("Access-Control-Allow-Headers", reqHeaders)
			w.Header().Set("Access-Control-Max-Age", "600")
			w.WriteHeader(http.StatusNoContent)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func requirePublicBaseURL() (string, error) {
	public, err := requireEnv("MCP_PUBLIC_BASE_URL")
	if err != nil {
		return "", err
	}
	if err := validatePublicBaseURL(public); err != nil {
		return "", err
	}
	return public, nil
}

func validatePublicBaseURL(raw string) error {
	if raw == "" {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL is required")
	}
	if strings.HasSuffix(raw, "/") {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL must not have a trailing slash")
	}
	parsed, err := url.Parse(raw)
	if err != nil {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL: %w", err)
	}
	if parsed.Scheme != "https" {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL must be https")
	}
	if parsed.Host == "" {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL must include a host")
	}
	if parsed.Path != "" && parsed.Path != "/" {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL must not include a path")
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" {
		return fmt.Errorf("MCP_PUBLIC_BASE_URL must be an origin only")
	}
	return nil
}
