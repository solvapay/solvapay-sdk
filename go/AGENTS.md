# AGENTS.md — go/

The SolvaPay Go SDK (`github.com/solvapay/solvapay-sdk/go`). It must behave like
the TypeScript SDK; the conformance cases in `../conformance` say how.

- **Never edit `../conformance` or `../openapi` from here.** Those belong to the
  TypeScript SDK. If a case looks wrong, raise it; don't change it to pass.
- **Adopting cases:** make them pass (add a mapping in `conformance/ops_<area>_test.go`),
  then run `go run ./cmd/pin` (all suites) or `go run ./cmd/pin --only <suite>`.
  Cases newer than the pin are skipped as "not adopted"; a release needs
  `go run ./cmd/pin --check` to pass.
- **Generated, never by hand:** `api/api.gen.go` (`go generate ./api`, after
  `pnpm spec:sync`) and `conformance.lock`; `mcp_widget.html`, the MCP App
  widget built from `../mcp-app` (`node scripts/sync_widget.mjs`, `--check` in CI).
- **Errors** are `*solvapay.Error` with the same `Code` and `Status` as the other
  SDKs. Branch on codes, never on messages.
- Check before committing: `gofmt -l .` (empty), `go vet ./...`, `go test ./...`.
