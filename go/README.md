# SolvaPay Go SDK

`github.com/solvapay/solvapay-sdk/go`: the SolvaPay API client, paywall,
webhooks, paid MCP tools and agent payments for Go. Go 1.26+.

```bash
go get github.com/solvapay/solvapay-sdk/go@latest
```

```go
import solvapay "github.com/solvapay/solvapay-sdk/go"
```

API reference: [pkg.go.dev/github.com/solvapay/solvapay-sdk/go](https://pkg.go.dev/github.com/solvapay/solvapay-sdk/go).

## Same behaviour as the TypeScript SDK

The paywall, its messages, the MCP tools' narration and webhook verification
are checked against the TypeScript SDK on every change by a shared conformance
suite ([`conformance/`](../conformance)); the cases this module passes are
pinned in [`conformance.lock`](conformance.lock). The API client is generated
from the same spec as the TypeScript types ([`openapi/`](../openapi)).

## Versions

The module has its own version line, starting at v0.1.0. Its numbers don't
follow the TypeScript packages; what the SDKs share is the conformance suite
and the API spec. Until v1.0.0, a minor release (v0.x → v0.y) may change the
API.

Releases are tagged `go/vX.Y.Z`. Previews of the next release are tagged from
the `dev` branch as `go/vX.Y.Z-dev.N`. `@latest` never picks a preview once a
release exists, so ask for one by its version:

```bash
go get github.com/solvapay/solvapay-sdk/go@v0.1.0-dev.12
```

Or take whatever is on `dev` right now, as a pseudo-version:

```bash
go get github.com/solvapay/solvapay-sdk/go@dev
```
