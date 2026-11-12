# solvapay

SolvaPay for Python: paywalls, usage billing, webhooks and paid MCP tools.

```bash
pip install solvapay            # API client, paywall, webhooks
pip install 'solvapay[mcp]'     # paid tools for the official MCP Python SDK
```

Python 3.10+. Typed (`py.typed`), async-first, with blocking twins for the API client.

## Configure

```bash
export SOLVAPAY_SECRET_KEY=sk_sandbox_...   # required
export SOLVAPAY_PRODUCT_REF=prd_...         # the product paid calls bill against
export SOLVAPAY_API_BASE_URL=...            # optional; defaults to https://api.solvapay.com
```

Run `npx solvapay init` to sign in and write these to `.env`.

## Make a function paid

```python
from solvapay import PaywallError, create_solvapay

solvapay = create_solvapay()

@solvapay.payable()
async def summarise(text: str, *, customer_ref: str) -> str:
    return text[:100]

try:
    summary = await summarise("...", customer_ref="user_123")
except PaywallError as error:
    print(error.gate["message"])   # what the customer should see, with a checkout link
```

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

app = mcp.http_app()   # serve with uvicorn; the MCP endpoint is /mcp
```

Customers sign in with SolvaPay over OAuth, and every bearer token is verified
with SolvaPay. A call over the customer's limit returns the paywall: a message
naming the next step, with a checkout link. See
[`examples/python-stock-research-mcp`](../examples/python-stock-research-mcp).

## Verify webhooks

```python
from solvapay import SolvaPayError, verify_webhook

try:
    event = verify_webhook(
        body=raw_body,                                  # bytes or str, exactly as received
        signature=request.headers["sv-signature"],
        secret=os.environ["SOLVAPAY_WEBHOOK_SECRET"],
    )
except SolvaPayError as error:
    ...  # error.code: webhook_signature_invalid, webhook_timestamp_out_of_tolerance, ...
```

## The API

Every SolvaPay API operation, generated from the API spec:

```python
from solvapay import AsyncApiClient

async with AsyncApiClient(api_key="sk_sandbox_...") as api:
    customer = await api.get_customer(reference="cus_123")
    balance = await api.get_customer_balance(reference="cus_123")
```

`ApiClient` is the blocking twin. Errors are `SolvaPayError` with a stable `code`
and the HTTP `status`; branch on those, not on the message.

## Same behaviour as the TypeScript SDK

The paywall, its messages and webhook verification are checked against the
TypeScript SDK on every change by a shared conformance suite
([`conformance/`](../conformance)). The API client is generated from the same
spec as the TypeScript types ([`openapi/`](../openapi)).
