# Go facade — get merchant

Minimal example for [`github.com/solvapay/solvapay-go`](https://github.com/solvapay/solvapay-go) (Step 51). Offline `httptest` coverage for `run(...)`; live `.env` is optional.

This example’s `go.mod` uses a local `replace` so CI can build against the monorepo binding without a published tag. Real consumers should:

```bash
go get github.com/solvapay/solvapay-go@latest
```

## Offline test (CI-safe)

```bash
cd examples/go/get-merchant
go test ./...
```

## Setup (live run)

```bash
cp .env.example .env
# Edit .env with your sandbox secret and optional API base URL.
```

## Run

From the example directory:

```bash
go run .
```
