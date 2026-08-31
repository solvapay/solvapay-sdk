package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"

	solvapay "github.com/solvapay/solvapay-go"
)

func main() {
	if err := loadDotEnv(".env"); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "load .env: %v\n", err)
		os.Exit(1)
	}

	mode := flag.String("mode", "demo", "demo | serve | http")
	city := flag.String("city", "London", "city for demo mode")
	gate := flag.Bool("gate", false, "force a paywall result in demo mode")
	sourceKind := flag.String("source", envOr("WEATHER_MCP_SOURCE", "fixture"), "live | fixture")
	flag.Parse()

	ctx := context.Background()
	source, err := resolveSource(*sourceKind)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	switch *mode {
	case "demo":
		result, err := runDemo(ctx, demoOptions{
			withinLimits: !*gate,
			city:         *city,
			source:       source,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		enc := json.NewEncoder(os.Stdout)
		enc.SetIndent("", "  ")
		_ = enc.Encode(result)
	case "serve":
		client, product, err := requireLiveClient(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		defer func() { _ = client.Close(ctx) }()
		public, err := requirePublicBaseURL()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		if err := runStdio(ctx, client, product, public, source); err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
	case "http":
		client, product, err := requireLiveClient(ctx)
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		defer func() { _ = client.Close(ctx) }()
		public, err := requirePublicBaseURL()
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		handler, err := newHTTPHandler(client, httpServeConfig{
			ProductRef:    product,
			PublicBaseURL: public,
			Source:        source,
		})
		if err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
		addr := listenAddr()
		log.Printf("weather-mcp public origin: %s", public)
		log.Printf("weather-mcp MCP endpoint: %s/mcp", public)
		log.Printf("weather-mcp product: %s", product)
		log.Printf("listening on http://%s", addr)
		if err := http.ListenAndServe(addr, handler); err != nil {
			fmt.Fprintf(os.Stderr, "%v\n", err)
			os.Exit(1)
		}
	default:
		fmt.Fprintf(os.Stderr, "unknown --mode %q (want demo, serve, or http)\n", *mode)
		os.Exit(1)
	}
}

func requireLiveClient(ctx context.Context) (*solvapay.Client, string, error) {
	key, err := requireEnv("SOLVAPAY_SECRET_KEY")
	if err != nil {
		return nil, "", err
	}
	product, err := requireEnv("SOLVAPAY_PRODUCT")
	if err != nil {
		return nil, "", err
	}
	var opts []solvapay.Option
	if base := strings.TrimSpace(os.Getenv("SOLVAPAY_API_BASE_URL")); base != "" {
		opts = append(opts, solvapay.WithBaseURL(base))
	}
	client, err := solvapay.NewClient(ctx, key, opts...)
	if err != nil {
		return nil, "", err
	}
	return client, product, nil
}

func requireEnv(name string) (string, error) {
	value := strings.TrimSpace(os.Getenv(name))
	if value == "" {
		return "", fmt.Errorf("%s is required", name)
	}
	return value, nil
}

func envOr(name, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}

func listenAddr() string {
	host := envOr("MCP_HOST", "127.0.0.1")
	port := envOr("MCP_PORT", "3030")
	return host + ":" + port
}

func resolveSource(kind string) (Source, error) {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", "fixture":
		return newFixtureSource(), nil
	case "live":
		return newLiveSource(""), nil
	default:
		return nil, fmt.Errorf("unknown --source %q (want live or fixture)", kind)
	}
}
