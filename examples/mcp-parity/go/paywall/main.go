// The legacy paywall server in Go: customers sign in with SolvaPay, and
// get_quote is checked against their plan and billed one unit per call.
//
//	go run ./paywall    # http://127.0.0.1:3062/mcp
package main

import (
	"log"
	"net/http"

	"github.com/solvapay/solvapay-sdk/examples/mcp-parity/go/parity"
)

const port = "3062"

func main() {
	parity.LoadEnv()
	publicBaseURL := parity.Required("PAYWALL_GO_URL")
	server := parity.PaywallServer(publicBaseURL, "paywall-go")
	log.Printf("[paywall-go] http://127.0.0.1:%s/mcp, public %s/mcp", port, publicBaseURL)
	log.Fatal(http.ListenAndServe("127.0.0.1:"+port, server.Handler()))
}
