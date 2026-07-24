// get-merchant is a minimal SolvaPay Go SDK example (Step 51).
//
//	cp .env.example .env
//	go run .
package main

import (
	"context"
	"fmt"
	"os"
	"strings"

	solvapay "github.com/solvapay/solvapay-go"
)

func main() {
	if err := loadDotEnv(".env"); err != nil && !os.IsNotExist(err) {
		fmt.Fprintf(os.Stderr, "load .env: %v\n", err)
		os.Exit(1)
	}
	apiKey := os.Getenv("SOLVAPAY_SECRET_KEY")
	if apiKey == "" {
		fmt.Fprintln(os.Stderr, "SOLVAPAY_SECRET_KEY is missing — copy .env.example to .env")
		os.Exit(1)
	}
	ctx := context.Background()
	opts := []solvapay.Option{}
	if base := os.Getenv("SOLVAPAY_API_BASE_URL"); base != "" {
		opts = append(opts, solvapay.WithBaseURL(base))
	}
	client, err := solvapay.NewClient(ctx, apiKey, opts...)
	if err != nil {
		fmt.Fprintf(os.Stderr, "NewClient: %v\n", err)
		os.Exit(1)
	}
	defer func() { _ = client.Close(ctx) }()

	merchant, err := run(ctx, client)
	if err != nil {
		fmt.Fprintf(os.Stderr, "get merchant: %v\n", err)
		os.Exit(1)
	}
	fmt.Printf("merchant displayName=%v defaultCurrency=%v\n", merchant["displayName"], merchant["defaultCurrency"])
}

// loadDotEnv loads KEY=VALUE lines from path into the process env (no overrides).
func loadDotEnv(path string) error {
	raw, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	for _, line := range strings.Split(string(raw), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		key, value, ok := strings.Cut(line, "=")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.TrimSpace(value)
		if _, exists := os.LookupEnv(key); exists {
			continue
		}
		_ = os.Setenv(key, value)
	}
	return nil
}
