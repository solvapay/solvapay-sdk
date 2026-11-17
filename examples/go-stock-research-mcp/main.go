// Serves the stock research MCP server over streamable HTTP.
//
//	go run .
//
// Reads from the environment (or .env in the working directory):
//
//   - SOLVAPAY_SECRET_KEY    the merchant's secret key (sk_sandbox_… for testing)
//   - SOLVAPAY_PRODUCT_REF   the product the tools bill against
//   - SOLVAPAY_API_BASE_URL  optional; your local stack or https://api.solvapay.com
//   - PUBLIC_BASE_URL        where MCP clients reach this server (an ngrok URL)
//   - MCP_PORT               optional; defaults to 3031
//   - MARKET_DATA            optional; "fixtures" serves recorded data instead of the live APIs
package main

import (
	"bufio"
	"errors"
	"fmt"
	"log"
	"net/http"
	"os"
	"strings"
	"time"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

func main() {
	if err := loadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}
	server, err := buildServer()
	if err != nil {
		log.Fatal(err)
	}
	port := os.Getenv("MCP_PORT")
	if port == "" {
		port = "3031"
	}
	log.Printf("stock-research MCP on http://localhost:%s/mcp", port)
	log.Fatal(http.ListenAndServe(":"+port, logRequests(server.Handler())))
}

// logRequests logs each request's method, path and status, as uvicorn does
// for the Python example.
func logRequests(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
		next.ServeHTTP(rec, r)
		log.Printf("%s %s %d", r.Method, r.URL.Path, rec.status)
	})
}

type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(status int) {
	r.status = status
	r.ResponseWriter.WriteHeader(status)
}

// Flush keeps streamed (SSE) responses streaming through the recorder.
func (r *statusRecorder) Flush() {
	if f, ok := r.ResponseWriter.(http.Flusher); ok {
		f.Flush()
	}
}

func (r *statusRecorder) Unwrap() http.ResponseWriter { return r.ResponseWriter }

func buildServer() (*solvapay.MCPServer, error) {
	publicBaseURL, err := required("PUBLIC_BASE_URL")
	if err != nil {
		return nil, err
	}
	var source MarketDataSource = HTTPMarketData{Client: &http.Client{Timeout: 15 * time.Second}}
	if os.Getenv("MARKET_DATA") == "fixtures" {
		source = StubMarketData{Dir: "fixtures"}
	}
	client, err := solvapay.NewClient(solvapay.Config{}) // SOLVAPAY_SECRET_KEY, SOLVAPAY_API_BASE_URL
	if err != nil {
		return nil, err
	}
	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
		Client:        client, // ProductRef from SOLVAPAY_PRODUCT_REF
		PublicBaseURL: publicBaseURL,
		Name:          "stock-research",
		Instructions:  "Paid stock research tools. Educational research only, not financial advice.",
	})
	if err != nil {
		return nil, err
	}
	if err := registerTools(server, source, nil); err != nil {
		return nil, err
	}
	return server, nil
}

func required(name string) (string, error) {
	value := os.Getenv(name)
	if value == "" {
		return "", fmt.Errorf("%s is not set. See the README", name)
	}
	return value, nil
}

// loadDotEnv sets KEY=VALUE lines from path that the environment does not
// already set. A missing file is fine; a malformed line is not.
func loadDotEnv(path string) error {
	file, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer file.Close()
	scanner := bufio.NewScanner(file)
	for n := 1; scanner.Scan(); n++ {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			return fmt.Errorf("%s:%d: expected KEY=VALUE", path, n)
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		if _, set := os.LookupEnv(key); !set {
			os.Setenv(key, value)
		}
	}
	return scanner.Err()
}
