package main

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-go"
)

func runStdio(ctx context.Context, client *solvapay.Client, product string, source Source) error {
	server := mcpsdk.NewServer(&mcpsdk.Implementation{Name: "weather-mcp", Version: "v0.0.1"}, nil)
	if err := registerTools(mcpServerRegistry{server: server, client: client}, source, product, nil); err != nil {
		return err
	}
	return server.Run(ctx, &mcpsdk.StdioTransport{})
}
