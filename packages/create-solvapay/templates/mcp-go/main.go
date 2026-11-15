// __SERVER_NAME__: a paid MCP server built with SolvaPay.
//
//	go run .    # MCP endpoint at http://localhost:$PORT/mcp
//
// Settings come from the environment. In development they are read from .env
// (written by `npx solvapay init`); in production, set them on the host.
package main

import (
	"log"
	"net/http"
	"os"
	"strings"

	solvapay "github.com/solvapay/solvapay-sdk/go"
)

func main() {
	if err := loadDotEnv(".env"); err != nil {
		log.Fatal(err)
	}
	required("SOLVAPAY_SECRET_KEY")
	required("SOLVAPAY_PRODUCT_REF")
	// Where MCP clients reach this server: your tunnel or deployed URL.
	// OAuth sign-in fails when it differs from the URL the client uses.
	publicBaseURL := required("PUBLIC_BASE_URL")
	port := required("PORT")

	client, err := solvapay.NewClient(solvapay.Config{})
	if err != nil {
		log.Fatal(err)
	}
	server, err := solvapay.NewMCPServer(solvapay.MCPServerOptions{
		Client:        client,
		PublicBaseURL: publicBaseURL,
		Name:          "__SERVER_NAME__",
	})
	if err != nil {
		log.Fatal(err)
	}
	if err := registerTools(server); err != nil {
		log.Fatal(err)
	}

	log.Printf("__SERVER_NAME__ on http://localhost:%s/mcp (public %s/mcp)", port, publicBaseURL)
	log.Fatal(http.ListenAndServe(":"+port, server.Handler()))
}

// required is a setting the server can't run without; a missing one stops it.
func required(name string) string {
	value := os.Getenv(name)
	if value == "" || strings.HasPrefix(value, "__") {
		log.Fatalf("%s is not set. Run `npx solvapay init`, or see .env.example.", name)
	}
	return value
}
