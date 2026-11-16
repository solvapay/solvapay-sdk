# SolvaPay Go SDK

`github.com/solvapay/solvapay-sdk/go`: the SolvaPay API client, paywall,
webhooks, paid MCP tools and agent payments (preview) for Go. Go 1.26+.

```bash
go get github.com/solvapay/solvapay-sdk/go@latest
```

```go
import solvapay "github.com/solvapay/solvapay-sdk/go"
```

API reference: [pkg.go.dev/github.com/solvapay/solvapay-sdk/go](https://pkg.go.dev/github.com/solvapay/solvapay-sdk/go).

## With an AI coding agent

Install the SolvaPay skills, then ask your agent for what you want, naming the product to bill:

```bash
npx skills add solvapay/skills -a claude-code -y   # other agents: -a <agent>
```

> Add SolvaPay to this Go server so that `GET /forecast` is paid per call. Bill product `prd_…`.

Installed during a Claude Code session? It loads right away if `.claude/skills/` existed when the session started; otherwise type `/reload-skills`. Or skip the install: start the prompt with "First run `npx -y skills use solvapay/skills --skill app-integration` and follow the skill it prints."

The agent runs `npx -y solvapay@latest init --language go --product prd_…`; approve it. It opens your browser to sign in to SolvaPay and writes `SOLVAPAY_SECRET_KEY` and `SOLVAPAY_PRODUCT_REF` to `.env`. Create the product, with the plan that sets the price, in [SolvaPay Console](https://app.solvapay.com/products) first. If your server has no sign-in yet, decide how callers are identified first: the paywall bills your own user id.

## Same behaviour as the TypeScript SDK

The paywall, its messages, the MCP tools' narration and webhook verification
are checked against the TypeScript SDK on every change by a shared conformance
suite ([`conformance/`](../conformance)); the cases this module passes are
pinned in [`conformance.lock`](conformance.lock). The API client is generated
from the same spec as the TypeScript types ([`openapi/`](../openapi)).

## React web checkout

`NewWebHandler` serves the routes the `@solvapay/react` components call
(`/api/check-purchase`, `/api/create-payment-intent`, `/api/list-plans`, …),
so a React front end works with a Go backend. They answer as
`@solvapay/server/fetch`'s `solvapayRoutes()` does; the `web-routes`
conformance cases check it.

Identity comes only from your `GetUser`: verify the request with your own auth
there. The routes never read a user id from a header the browser sends.
Answer `nil, nil` when the request has no valid session (the route answers
401) and an error when the check itself failed (500).

```go
client, err := solvapay.NewClient(solvapay.Config{}) // SOLVAPAY_SECRET_KEY
if err != nil {
	log.Fatal(err)
}
routes, err := solvapay.NewWebHandler(solvapay.WebOptions{
	Client: client,
	GetUser: func(r *http.Request) (*solvapay.WebUser, error) {
		// sessionUser is your app's own session or token check.
		user, err := sessionUser(r)
		if err != nil || user == nil {
			return nil, err
		}
		return &solvapay.WebUser{ID: user.ID, Email: user.Email, Name: user.Name}, nil
	},
})
if err != nil {
	log.Fatal(err)
}
mux := http.NewServeMux()
mux.Handle("/api/", routes) // BasePath defaults to /api, React's default
log.Fatal(http.ListenAndServe(":8080", mux))
```

`WebUser.ID` is your user id: the SolvaPay customer is found by it (as its
`externalRef`) or created with it, the email and the name. `BasePath` moves
the routes, `ReturnURL` sets where hosted checkout returns (default: the
request's origin) and `CORSOrigins` limits which origins may call them from a
browser (default: any). Mount the webhook route yourself with `VerifyWebhook`.

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
