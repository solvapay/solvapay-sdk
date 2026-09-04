package main

import (
	"context"

	mcpsdk "github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-sdk/sdks/go"
	solvapaymcp "github.com/solvapay/solvapay-sdk/sdks/go/mcp"
)

func runStdio(ctx context.Context, client *solvapay.Client, product, publicBaseURL string, source Source) error {
	server, err := buildStdioServer(ctx, client, product, publicBaseURL, source)
	if err != nil {
		return err
	}
	return server.Run(ctx, &mcpsdk.StdioTransport{})
}

func buildStdioServer(ctx context.Context, client *solvapay.Client, product, publicBaseURL string, source Source) (*mcpsdk.Server, error) {
	srv, err := newSolvaPayServer(ctx, client, product, publicBaseURL, source, nil, "")
	if err != nil {
		return nil, err
	}
	return srv.MCP, nil
}

func newSolvaPayServer(
	ctx context.Context,
	client *solvapay.Client,
	product string,
	publicBaseURL string,
	source Source,
	getCustomerRef solvapaymcp.GetCustomerRef,
	hs256Secret string,
) (*solvapaymcp.Server, error) {
	srv, err := solvapaymcp.NewServer(ctx, client, solvapaymcp.ServerConfig{
		ProductRef:    product,
		PublicBaseURL: publicBaseURL,
		MCPPath:       "/mcp",
		ServerName:    "weather-mcp",
		ServerVersion: "v0.0.1",
		Hs256Secret:   hs256Secret,
	})
	if err != nil {
		return nil, err
	}
	if err := registerTools(srv, source, product, getCustomerRef); err != nil {
		return nil, err
	}
	return srv, nil
}
