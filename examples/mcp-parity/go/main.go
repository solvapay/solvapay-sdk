// The parity server in Go: one paid tool, get_quote, on a SolvaPay MCP server
// whose customers sign in with SolvaPay.
//
//	go run .    # MCP endpoint: http://localhost:$GO_PORT/mcp
//
// Reads ../.env (see .env.example). Every value is required: a missing one
// stops the server.
package main

import (
	"bufio"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

func main() {
	if err := loadEnv(filepath.Join("..", ".env")); err != nil {
		log.Fatal(err)
	}
	for _, name := range []string{"SOLVAPAY_SECRET_KEY", "SOLVAPAY_API_BASE_URL", "SOLVAPAY_PRODUCT_REF"} {
		required(name)
	}
	publicBaseURL := required("GO_PUBLIC_BASE_URL")
	port := required("GO_PORT")

	client, err := solvapay.NewClient(solvapay.Config{})
	if err != nil {
		log.Fatal(err)
	}
	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
		Client:        client,
		PublicBaseURL: publicBaseURL,
		Name:          "mcp-parity-go",
		ResourceURI:   "ui://mcp-parity/mcp-app.html",
	})
	if err != nil {
		log.Fatal(err)
	}
	err = server.RegisterPayable("get_quote", solvapay.PaidTool{
		Title:       "Get quote",
		Description: "A made-up price for a ticker symbol. One unit per call.",
		InputSchema: map[string]any{
			"type":       "object",
			"properties": map[string]any{"symbol": map[string]any{"type": "string", "minLength": 1, "maxLength": 8}},
			"required":   []any{"symbol"},
		},
		Handler: func(_ context.Context, args json.RawMessage, rc *solvapay.ResponseContext) (*solvapay.ToolResponse, error) {
			var in struct{ Symbol string }
			if err := json.Unmarshal(args, &in); err != nil {
				return nil, err
			}
			return rc.Respond(quote(in.Symbol), solvapay.RespondOptions{}), nil
		},
	})
	if err != nil {
		log.Fatal(err)
	}

	log.Printf("[go] http://127.0.0.1:%s/mcp, public %s/mcp", port, publicBaseURL)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, server.Handler()))
}

// quote is a made-up price from the symbol, the same in every language.
func quote(symbol string) map[string]any {
	upper := strings.ToUpper(symbol)
	sum := 0
	for _, r := range upper {
		sum += int(r)
	}
	return map[string]any{"symbol": upper, "price": 100 + sum%900, "currency": "USD", "server": "go"}
}

func required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is not set. See examples/mcp-parity/README.md.", name)
	}
	return value
}

// loadEnv sets KEY=value lines from path, leaving variables already set alone.
func loadEnv(path string) error {
	file, err := os.Open(path)
	if os.IsNotExist(err) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s: not KEY=value: %q", path, line)
		}
		key = strings.TrimSpace(key)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`))
		}
	}
	return scanner.Err()
}
