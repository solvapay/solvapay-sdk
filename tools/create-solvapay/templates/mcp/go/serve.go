package main

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"

	solvapay "github.com/solvapay/solvapay-go"
	solvapaymcp "github.com/solvapay/solvapay-go/mcp"
)

func requireLiveClient(ctx context.Context) (*solvapay.Client, string, error) {
	apiKey := os.Getenv("SOLVAPAY_SECRET_KEY")
	if apiKey == "" {
		return nil, "", fmt.Errorf("SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env")
	}
	product := os.Getenv("SOLVAPAY_PRODUCT_REF")
	if product == "" {
		product = os.Getenv("SOLVAPAY_PRODUCT")
	}
	if product == "" {
		return nil, "", fmt.Errorf("SOLVAPAY_PRODUCT_REF is missing — run `npx solvapay init`")
	}
	opts := []solvapay.Option{}
	if base := os.Getenv("SOLVAPAY_API_BASE_URL"); base != "" {
		opts = append(opts, solvapay.WithBaseURL(base))
	}
	client, err := solvapay.NewClient(ctx, apiKey, opts...)
	if err != nil {
		return nil, "", err
	}
	return client, product, nil
}

func requirePublicBaseURL() (string, error) {
	public := os.Getenv("MCP_PUBLIC_BASE_URL")
	if public == "" {
		return "", fmt.Errorf("MCP_PUBLIC_BASE_URL is required")
	}
	return public, nil
}

func newHTTPHandler(client *solvapay.Client, product, publicBaseURL string) (http.Handler, error) {
	srv, err := solvapaymcp.NewServer(context.Background(), client, solvapaymcp.ServerConfig{
		ProductRef:    product,
		PublicBaseURL: publicBaseURL,
		MCPPath:       "/mcp",
		ServerName:    "__SERVER_NAME__",
		ServerVersion: "0.1.0",
	})
	if err != nil {
		return nil, err
	}
	if err := registerTools(srv, product); err != nil {
		return nil, err
	}
	mcpHandler := solvapaymcp.NewStreamableHandler(srv)
	inner := http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/health":
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"status":"ok","server":"__SERVER_NAME__"}`))
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
