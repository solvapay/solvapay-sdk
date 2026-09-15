package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
)

func main() {
	if err := loadDotEnv(".env"); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "load .env: %v\n", err)
		os.Exit(1)
	}

	mode := flag.String("mode", "http", "http")
	flag.Parse()
	if *mode != "http" {
		fmt.Fprintf(os.Stderr, "unknown --mode %q (expected http)\n", *mode)
		os.Exit(1)
	}

	ctx := context.Background()
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
	handler, err := newHTTPHandler(client, product, public)
	if err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}

	addr := envOr("MCP_HOST", "127.0.0.1") + ":" + envOr("MCP_PORT", "3030")
	log.Printf("__SERVER_NAME__ listening on http://%s/mcp", addr)
	if err := http.ListenAndServe(addr, handler); err != nil {
		fmt.Fprintf(os.Stderr, "%v\n", err)
		os.Exit(1)
	}
}
