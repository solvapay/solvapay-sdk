# React web checkout on a Python or Go backend

One React page built from `@solvapay/react`, unchanged, running against two
backends:

- `backend-python/`: Starlette with `solvapay.web.routes()` (`solvapay[web]`)
- `backend-go/`: `net/http` with `solvapay.NewWebHandler`

The page lists a product's plans, checks out a plan with `PaymentForm`
(Stripe Elements), shows current purchases with cancel and reactivate renewal
for an active recurring one, shows the credit balance, tops it up with
`TopupForm`, turns auto-recharge on and off with `AutoRecharge`, and loads
history. Every call goes to `/api/*` on the page's own origin; the Vite dev
server proxies `/api` and `/auth` to whichever backend `BACKEND_URL` names.
Nothing in the frontend knows which language answers.

## Identity

The browser's only identity is a bearer token. The page signs in with
`POST /auth/demo-login` (`{ "userId": "..." }`), keeps the HS256 token it gets
back, and hands `SolvaPayProvider` an auth adapter whose `getToken()` returns
it. Each backend verifies that token in `get_user` (Python) or `GetUser` (Go)
and answers 401 without it. An `x-user-id` header is ignored.

**The demo login is for this demo only.** It signs a token for any id anyone
types. A real app signs people in with its own auth, and `get_user` /
`GetUser` verifies that auth (session cookie, its own JWT, ...).

## Run

You need a SolvaPay sandbox secret key and a product ref. Each backend reads
`.env` (copy `.env.example`):

```bash
SOLVAPAY_SECRET_KEY=sk_sandbox_...
SOLVAPAY_API_BASE_URL=https://api-dev.solvapay.com   # or https://api.solvapay.com
SOLVAPAY_PRODUCT_REF=prd_...
DEMO_JWT_SECRET=...                                   # openssl rand -hex 32
```

Python backend (port 4010), needs [uv](https://docs.astral.sh/uv/):

```bash
cd examples/react-web-checkout/backend-python
uv run python main.py
```

Go backend (port 4020), Go 1.26+:

```bash
cd examples/react-web-checkout/backend-go
go run .
```

Frontend (port 5173). From the repo root, build the workspace packages once
(`pnpm install && pnpm build:packages`), then:

```bash
cd examples/react-web-checkout
BACKEND_URL=http://127.0.0.1:4010 VITE_PRODUCT_REF=prd_... pnpm dev   # Python
BACKEND_URL=http://127.0.0.1:4020 VITE_PRODUCT_REF=prd_... pnpm dev   # Go
```

Or put `BACKEND_URL` and `VITE_PRODUCT_REF` in `examples/react-web-checkout/.env`
(see `.env.example`); a value in the shell wins. Open http://localhost:5173,
sign in with any id, and pay with a Stripe test card (`4242 4242 4242 4242`).

## Files

- `src/App.tsx`: the page, built only from `@solvapay/react` exports
- `vite.config.ts`: the `/api` and `/auth` proxy
- `backend-python/main.py`: demo login, `get_user`, `routes()` mounted at `/api`
- `backend-go/main.go`: demo login, `GetUser`, `NewWebHandler` mounted at `/api/`

## Proof run (14 Nov 2026, api-dev sandbox)

The same frontend, unchanged, against each backend. Only `BACKEND_URL` changed.

| Step | Python (`solvapay.web.routes`) | Go (`NewWebHandler`) |
| --- | --- | --- |
| Sign in, merchant, plan list, balance | Pass | Pass |
| Checkout Pro monthly ($20/month) with the Stripe test card | Pass (`succeeded`, purchase active) | Pass |
| Cancel renewal, then reactivate | Pass | Pass |
| Top up $10 | Pass (100,000 credits) | Pass |
| Save auto-recharge settings (`PUT`), turn off (`DELETE`) | Pass | Pass |
| History | Pass | Pass |
| No token, forged token, `x-user-id` without a token | 401 | 401 |

Two `@solvapay/react` front-end bugs showed up, with either backend:

- The drop-in `<TopupForm>` can't be submitted: it requires the buyer's country
  (and US state and ZIP) but renders no address fields. This example composes
  the form from `@solvapay/react/primitives` with `TopupForm.BusinessDetails`.
- `<AutoRecharge>`'s card step hangs on "Authorizing…": it hides the address
  fields in Stripe's Payment Element, then calls `stripe.confirmSetup()` without
  the country, and Stripe's `IntegrationError` is never shown. The settings save;
  the card authorization doesn't.
