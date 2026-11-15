// The agents server in Go. One /mcp serves two kinds of caller:
//
//   - An agent presenting a SolvaPay agent token or agent key goes to the
//     agent route. Each get_quote call is authorized by SolvaPay first (spend
//     policy, budget, balance, and the owner's approval when asked), then
//     completed at the cost it reports.
//
//   - Everyone else goes to the legacy paywall server behind it, as in the
//     paywall command.
//
//     go run ./agents    # http://127.0.0.1:3072/mcp
package main

import (
	"context"
	"encoding/json"
	"log"
	"net/http"
	"strconv"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	solvapay "github.com/solvapay/solvapay-sdk/go"
	sdkagents "github.com/solvapay/solvapay-sdk/go/agents"

	"github.com/solvapay/solvapay-sdk/examples/mcp-parity/go/parity"
)

const port = "3072"

type quoteArgs struct {
	Symbol string `json:"symbol" jsonschema:"A ticker symbol, 1 to 8 characters"`
}

func main() {
	parity.LoadEnv()
	secretKey := parity.Required("SOLVAPAY_SECRET_KEY")
	issuer := parity.Required("SOLVAPAY_AGENT_ISSUER")
	publicBaseURL := parity.Required("AGENTS_GO_URL")
	agentOAuth := parity.Required("AGENT_OAUTH")
	if agentOAuth != "on" && agentOAuth != "off" {
		log.Fatal("AGENT_OAUTH must be on or off")
	}
	maxWait, err := strconv.Atoi(parity.Required("APPROVAL_WAIT_SECONDS"))
	if err != nil {
		log.Fatalf("APPROVAL_WAIT_SECONDS: %v", err)
	}
	mcpResource := publicBaseURL + "/mcp"
	environment := sdkagents.SecretKeyEnvironment(secretKey)

	client, err := sdkagents.NewClient(solvapay.Config{APIKey: secretKey, APIBaseURL: parity.Required("SOLVAPAY_API_BASE_URL")})
	if err != nil {
		log.Fatal(err)
	}
	tokenOptions := sdkagents.TokenVerifierOptions{
		Issuer:      issuer,
		ProviderRef: parity.Required("SOLVAPAY_PROVIDER_REF"),
		Environment: environment,
		Keys:        &sdkagents.RemoteKeys{URL: parity.Required("SOLVAPAY_AGENT_JWKS_URL")},
	}
	if agentOAuth == "on" {
		// A host that signed in by OAuth holds a token for this resource.
		tokenOptions.Resource = mcpResource
	}
	tokens, err := sdkagents.NewTokenVerifier(tokenOptions)
	if err != nil {
		log.Fatal(err)
	}
	keys, err := sdkagents.NewKeyVerifier(sdkagents.KeyVerifierOptions{Client: client, Environment: environment})
	if err != nil {
		log.Fatal(err)
	}
	calls, err := sdkagents.NewCalls(sdkagents.CallsOptions{Client: client, MaxWaitSeconds: maxWait})
	if err != nil {
		log.Fatal(err)
	}
	routeOptions := sdkagents.MCPRouteOptions{
		Issuer:     issuer,
		Layer:      &sdkagents.AgentLayer{Tokens: tokens, Keys: keys},
		Calls:      calls,
		MCPPath:    "/mcp",
		ServerName: "agents-go",
		Tools: func(_ *mcp.Server, paid *sdkagents.PaidTools, _ *sdkagents.AgentRequest) {
			sdkagents.AddPaidTool(paid, sdkagents.PaidTool[quoteArgs]{
				Name:        "get_quote",
				Title:       "Get quote",
				Description: "A made-up price for a ticker symbol. Up to " + parity.AgentEstimate + " " + parity.Currency + " per call.",
				Item:        func(quoteArgs) string { return "get_quote" },
				Estimate: func(quoteArgs) sdkagents.Money {
					return sdkagents.Money{Amount: parity.AgentEstimate, Currency: parity.Currency}
				},
				Prompt: func(args quoteArgs) (string, bool) { return args.Symbol, true },
				Run: func(_ context.Context, args quoteArgs, _ sdkagents.PaidCall) (sdkagents.PaidToolRun, error) {
					text, err := json.Marshal(parity.Quote(args.Symbol))
					if err != nil {
						return sdkagents.PaidToolRun{}, err
					}
					return sdkagents.PaidToolRun{
						Status: 200,
						Cost:   &sdkagents.Cost{Amount: parity.AgentCost, Currency: parity.Currency},
						Result: &mcp.CallToolResult{Content: []mcp.Content{&mcp.TextContent{Text: string(text)}}},
					}, nil
				},
			})
		},
	}
	if agentOAuth == "on" {
		routeOptions.ProtectedResource = &sdkagents.ProtectedResource{Resource: mcpResource}
	}
	route, err := sdkagents.NewMCPRoute(routeOptions)
	if err != nil {
		log.Fatal(err)
	}

	customers := parity.PaywallServer(publicBaseURL, "agents-go")
	log.Printf("[agents-go] http://127.0.0.1:%s/mcp, public %s, agent OAuth %s", port, mcpResource, agentOAuth)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, route.Middleware(customers.Handler())))
}
