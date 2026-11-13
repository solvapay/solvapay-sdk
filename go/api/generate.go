// Package api is the HTTP client for the SolvaPay SDK API, generated from the
// committed spec (openapi/sdk-v1.json). Nothing here is edited by hand: run
// `go generate ./api` from go/ after `pnpm spec:sync`.
package api

//go:generate go run ../internal/specprep ../../openapi/sdk-v1.json .spec.prepared.json
//go:generate go tool oapi-codegen -config oapi-codegen.yaml .spec.prepared.json
