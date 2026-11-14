// Package parity is what the Go parity servers share: settings from ../.env,
// and the tool.
package parity

import (
	"bufio"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
)

// AgentEstimate is what an agent's call to get_quote may cost; AgentCost is
// what it is charged.
const (
	AgentEstimate = "0.01"
	AgentCost     = 0.005
	Currency      = "USD"
)

// Quote is a made-up price from the symbol, the same in every language.
func Quote(symbol string) map[string]any {
	upper := strings.ToUpper(symbol)
	sum := 0
	for _, r := range upper {
		sum += int(r)
	}
	return map[string]any{"symbol": upper, "price": 100 + sum%900, "currency": "USD", "server": "go"}
}

// Required is a setting from ../.env; a missing one stops the server.
func Required(name string) string {
	value := os.Getenv(name)
	if value == "" {
		log.Fatalf("%s is not set. See examples/mcp-parity/README.md.", name)
	}
	return value
}

// LoadEnv sets KEY=value lines from examples/mcp-parity/.env, leaving
// variables already set alone. It is found from the working directory (go/
// or one of its commands).
func LoadEnv() {
	for _, path := range []string{filepath.Join("..", ".env"), filepath.Join("..", "..", ".env")} {
		file, err := os.Open(path)
		if os.IsNotExist(err) {
			continue
		}
		if err != nil {
			log.Fatal(err)
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
				log.Fatal(fmt.Errorf("%s: not KEY=value: %q", path, line))
			}
			key = strings.TrimSpace(key)
			if _, set := os.LookupEnv(key); !set {
				os.Setenv(key, strings.Trim(strings.TrimSpace(value), `"'`))
			}
		}
		if err := scanner.Err(); err != nil {
			log.Fatal(err)
		}
		return
	}
	log.Fatal("examples/mcp-parity/.env not found: cp .env.example .env")
}
