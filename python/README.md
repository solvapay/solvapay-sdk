# solvapay

SolvaPay for Python: paywalls, usage billing, webhooks and paid MCP tools.

```bash
pip install solvapay            # API client, paywall, webhooks
pip install 'solvapay[mcp]'     # paid tools for the official MCP Python SDK
pip install 'solvapay[web]'     # the routes @solvapay/react calls
```

Python 3.10+. Typed (`py.typed`), async-first, with blocking twins for the API client.

## With an AI coding agent

Install the SolvaPay skills before you start your agent (a skill installed during a session loads only in the next one), then ask for what you want, naming the product to bill:

```bash
npx skills add solvapay/skills -a claude-code -y   # other agents: -a <agent>
```

> Add SolvaPay to this FastAPI app so that `GET /forecast` is paid per call. Bill product `prd_…`.

Already in a session? Start the prompt with "First run `npx -y skills use solvapay/skills --skill app-integration` and follow the skill it prints."

The agent runs `npx -y solvapay@latest init --language python --product prd_…`; approve it. It opens your browser to sign in to SolvaPay and writes `SOLVAPAY_SECRET_KEY` and `SOLVAPAY_PRODUCT_REF` to `.env`. Create the product, with the plan that sets the price, in [SolvaPay Console](https://app.solvapay.com/products) first. If your app has no sign-in yet, decide how callers are identified first: the paywall bills your own user id.

## Configure

```bash
export SOLVAPAY_SECRET_KEY=sk_sandbox_...   # required
export SOLVAPAY_PRODUCT_REF=prd_...         # the product paid calls bill against
export SOLVAPAY_API_BASE_URL=...            # optional; defaults to https://api.solvapay.com
```

Copy the secret key and product reference from SolvaPay Console (Developers → API keys, and the product's page), or run `npx -y solvapay@latest init --language python --product prd_…`: it signs you in, writes both to `.env` and pins the SDK with uv or Poetry. The SDK reads environment variables, not `.env`; load it with `python-dotenv` or export them.

## Make a function paid

```python
import asyncio

from solvapay import PaywallError, create_solvapay

solvapay = create_solvapay()


@solvapay.payable()
async def summarise(text: str, *, customer_ref: str) -> str:
    return text[:100]


async def main() -> None:
    try:
        summary = await summarise("...", customer_ref="user_123")
        print(summary)
    except PaywallError as error:
        print(error.gate["message"])  # what the customer should see, with a checkout link


asyncio.run(main())
```

`SOLVAPAY_PRODUCT_REF` must be set before this module is imported: `@solvapay.payable()`
reads it when it decorates the function, so a missing product fails at import, not on the
first call.

`customer_ref` is your own user id: SolvaPay creates the customer on first use.
Each call is checked against the customer's plan, and billed when it succeeds.

## Paid MCP tools

```python
from solvapay import create_solvapay
from solvapay.mcp import ResponseContext, create_solvapay_mcp_server

mcp = create_solvapay_mcp_server(
    solvapay=create_solvapay(),
    public_base_url="https://research.example.com",
)


async def quote(symbol: str, ctx: ResponseContext):
    return ctx.respond({"symbol": symbol, "price": 101.5})


mcp.register_payable("quote", handler=quote, description="Latest price for a symbol.")

app = mcp.http_app()  # serve with uvicorn; the MCP endpoint is /mcp
```

Customers sign in with SolvaPay over OAuth, and every bearer token is verified
with SolvaPay. A call over the customer's limit returns the paywall: a message
naming the next step, with a checkout link. See
[`examples/python-stock-research-mcp`](../examples/python-stock-research-mcp).

The server also comes with SolvaPay's built-in tools, as the TypeScript server
does: `account` shows the customer's plan, balance and usage with a checkout,
top-up or account link (`view`: `checkout`, `account` or `topup`), and
`activate_plan` activates a plan by `planRef`. The `/upgrade`,
`/manage_account`, `/topup` and `/activate_plan` prompts and the
`docs://solvapay/overview.md` resource come with them. Pass `views=[...]` to
choose the views, or `views=[]` to leave `account` out.

### The checkout widget

On hosts that support MCP Apps (ChatGPT, Claude), `account` also opens
SolvaPay's checkout and account widget in the chat, the same one the TypeScript
SDK serves. It ships in this package (`solvapay/mcp/mcp-app.html`) and is
served at `ui://<name>/mcp-app.html` (`resource_uri=` to change it). Text-only
hosts get the same text as before; `mode: "text"` asks for text on any host.

The widget pays, tops up, cancels and reactivates renewals through six tools
only it calls: `create_payment_intent`, `process_payment`,
`create_hosted_session`, `set_renewal`, `attach_business_details` and
`get_history`. They are marked for the app (`_meta.ui.visibility: ["app"]`), so
MCP Apps hosts keep them from the model. For a host that lists them anyway,
`hide_tools_by_audience=["ui"]` leaves them out of `tools/list`; ChatGPT still
gets them, since its widget can only call listed tools.

Its Content Security Policy allows Stripe and the SolvaPay API. Add domains with
`csp={"connectDomains": [...], "resourceDomains": [...], "frameDomains": [...]}`.

### Paid by agents (preview)

`solvapay.agents.mcp.create_agent_mcp_route` serves an MCP server that SolvaPay
agents pay for per call: each paid tool call is authorized with SolvaPay before
it runs and completed at the cost the upstream reports. Install
`solvapay[agents,mcp]`.

Agent payments are a preview. SolvaPay turns them on per merchant, and live
agent payments aren't open yet, so build and test with a sandbox key.

## React web checkout

`solvapay.web.routes()` serves every route the `@solvapay/react` components
call (`/api/check-purchase`, `/api/create-payment-intent`, `/api/list-plans`,
…), answering as `@solvapay/server/fetch`'s `solvapayRoutes()` does, so the
React components work with a Python backend. Install `solvapay[web]`.

```python
from starlette.applications import Starlette
from starlette.requests import Request
from starlette.routing import Mount

from solvapay import create_solvapay
from solvapay.web import User, routes


async def get_user(request: Request) -> User | None:
    # Verify the request with your app's own auth: its session cookie or bearer
    # token, checked the way the rest of your app checks it.
    session = await my_app_session(request)  # your code
    if session is None:
        return None
    return User(id=session.user_id, email=session.email, name=session.name)


solvapay = create_solvapay()
app = Starlette(routes=[Mount("/api", app=routes(solvapay, get_user=get_user, base_path=""))])
```

In FastAPI, `app.mount("/api", routes(solvapay, get_user=get_user, base_path=""))`.

`get_user` is required and is the only source of identity: your user id becomes
the SolvaPay customer's `externalRef`, and the customer is created with the
email and name on first use. Answer `None` for a request without a signed-in
user; the routes refuse it with 401 before calling SolvaPay. Nothing the browser
sends is identity: an `x-user-id` header is ignored. `merchant`, `get-product`
and `list-plans` answer without a user, as in TypeScript.

`base_path` (default `/api`) is where the routes are below the mount point.
Another path answers 404, and a known path with the wrong method 405 with
`Allow`. The routes don't add CORS headers: serve them from your app's own
origin, or add Starlette's `CORSMiddleware`.

## Verify webhooks

```python
import os

from solvapay import SolvaPayError, verify_webhook

try:
    event = verify_webhook(
        body=raw_body,  # bytes or str, exactly as received
        signature=request.headers["sv-signature"],
        secret=os.environ["SOLVAPAY_WEBHOOK_SECRET"],
    )
except SolvaPayError as error:
    ...  # error.code: webhook_secret_missing, webhook_signature_invalid, webhook_timestamp_out_of_tolerance, ...
```

## The API

Every SolvaPay API operation, generated from the API spec:

```python
import asyncio

from solvapay import AsyncApiClient


async def main() -> None:
    async with AsyncApiClient(api_key="sk_sandbox_...") as api:
        customer = await api.get_customer(reference="cus_123")
        balance = await api.get_customer_balance(reference="cus_123")
        print(customer.email, balance)


asyncio.run(main())
```

`ApiClient` is the blocking twin. Errors are `SolvaPayError` with a stable `code`
and the HTTP `status`; branch on those, not on the message.

## Same behaviour as the TypeScript SDK

The paywall, its messages, the `account` and `activate_plan` narration, what
the widget's tools and the React web routes answer, and webhook verification are
checked against the TypeScript SDK on every change by a shared conformance suite
([`conformance/`](../conformance)). The API client is generated from the same
spec as the TypeScript types ([`openapi/`](../openapi)).

## Versions

`solvapay` has its own version line, starting at 0.1.0. Its numbers don't
follow the TypeScript packages: Python 0.3.0 and `@solvapay/server` 2.12.0 can
behave the same. What the two share is the conformance suite (the version this
package passes is pinned in [`conformance.lock`](conformance.lock)) and the API
spec.

Until 1.0.0, a minor release (0.x → 0.y) may change the API. Previews of the
next release are published from the `dev` branch as `<next>.devN`:

```bash
pip install --pre solvapay
```
