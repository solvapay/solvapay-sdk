# Rust — Guerrilla Mail disposable inbox MCP

This example is a **receive-only disposable inbox**. The
[Guerrilla Mail JSON API](https://www.guerrillamail.com/GuerrillaMailAPI.html)
exposes `get_email_address`, `set_email_user`, `check_email`, `get_email_list`,
`fetch_email`, `del_email`, `forget_me`, and `extend`. There is no send or
compose endpoint. Anyone who knows the address can read the inbox.

Paywalled tools go through `solvapay::Client` and
`solvapay_mcp::McpHttpServer::register_payable`. Each call bills 1 unit of the
`requests` meter on `SOLVAPAY_PRODUCT`.

## Tools

| Tool             | Upstream                                                                | Returns                                                       |
| ---------------- | ----------------------------------------------------------------------- | ------------------------------------------------------------- |
| `inbox_open`     | `get_email_address` or `set_email_user` when `email_user` is set        | `address`, `expiresInSeconds`                                 |
| `inbox_list`     | `check_email` (optional `seq`) or `get_email_list` when `offset` is set | decoded subjects/excerpts; truncation note when `count` > 20  |
| `message_read`   | `fetch_email`                                                           | body with `res.php` image URLs unwrapped                      |
| `message_delete` | `del_email`                                                             | `deletedIds`; encodes `email_ids[]`                           |
| `inbox_extend`   | `extend`                                                                | remaining seconds, or an explicit note when `affected` is `0` |

All advertised arguments are `{"type":"string"}` with **no `required` array**.
That is the HTTP facade shape (`McpHttpServer::register_payable`), not the
rmcp-router `compile_input_schema` path. The handler still parses `email_id`,
`seq`, and `offset`.

Session state is keyed by the paying customer (`ctx.customer()`, from the JWT
`sub`). Passing the cookie back as a tool argument was rejected: it would leak
a session credential into model context.

## Live-probe findings

Recorded against `https://api.guerrillamail.com/ajax.php`:

1. **`https://api.guerrillamail.com/ajax.php` works.** The published doc's
   `http://` URL 301s to `https://www.guerrillamail.com/ajax.php`.
2. **Response bodies include `sid_token`**, matching the `PHPSESSID` cookie.
   This example sends `sid_token` as a request parameter and does not parse
   `Set-Cookie`.
3. **Published expiry math is wrong.** Remaining seconds is
   `3600 - (now - email_timestamp)`, clamped at 0. The doc writes
   `3600 - Current Timestamp - Email Timestamp`.
4. **`extend` is disabled on the live endpoint.** The body is the plaintext
   `this call has been disabled - call get_email_address instead`. Fixture
   tests still cover the documented `{ "affected": 1|0 }` shape. Live calls
   fail loudly (non-JSON).
5. **`check_email` / `get_email_list` `count` is a string**, and the welcome
   message can appear while `count` is `"0"`.
6. **`mail_subject` / `mail_excerpt` are HTML-entity encoded**
   (`&amp;`, `&#039;`). `fetch_email` bodies may point images at
   `/res.php?r=1&n=img&q=<urlencoded original>`.
7. **Poll interval.** The API does not publish a rate limit. Do not poll
   `inbox_list` faster than once every 15 seconds.

A disposable inbox is public. Do not put secrets in mail you send to it.

## Unit / gotcha reference

- Required query params on every call: `f`, `ip`, `agent`. Optional
  `sid_token` after the first successful call.
- `del_email` repeats `email_ids[]` (`email_ids%5B%5D=425&email_ids%5B%5D=426`).
- `extend` caps total lifetime at two hours from `email_timestamp`.
  `affected: 0` is never reported as success.
- `check_email` returns at most 20 rows. When `count` is greater than 20 the
  tool says the list is truncated.
- Sessions go idle after about 18 minutes; a rotated `sid_token` replaces the
  stored one and may imply a new address.
- Gate path still POSTs `/v1/sdk/usages` with outcome `paywall`. The example
  mock transport accepts that POST. Paywall copy needs `checkoutUrl` on the
  limits response.

## Modes

| Mode         | Command                                                                               | SolvaPay                    | Upstream     |
| ------------ | ------------------------------------------------------------------------------------- | --------------------------- | ------------ |
| Demo allow   | `cargo run --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml -- --mode demo` | Mock (`withinLimits: true`) | fixtures     |
| Demo paywall | `--mode demo --gate`                                                                  | Mock paywall                | fixtures     |
| HTTP         | `scripts/http.sh` or `pnpm mcp:guerrillamail`                                         | Real `Client::new`          | `MCP_SOURCE` |
| HTTP + ngrok | `pnpm mcp:guerrillamail:tunnel`                                                       | Real `Client::new`          | live         |

Streamable HTTP on `/mcp` (default `MCP_HOST=127.0.0.1`, `MCP_PORT=3030`) plus
OAuth discovery at `/.well-known/oauth-protected-resource` and `/oauth/*`.
`MCP_PUBLIC_BASE_URL` must be the origin MCPJam connects to — that value is
what the discovery documents advertise.

This process is the server behind the reserved `appmcp` origin
(`https://appmcp.<your-subdomain>.ngrok.app` → `127.0.0.1:3030`), same as
bitcoin-analytics, stock-research, and weather-mcp. Only one of those
examples can own the origin at a time.

```bash
# from repo root
cargo test --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml
cargo run --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml -- --mode demo
cargo run --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml -- --mode demo --gate
```

```bash
pnpm mcp:guerrillamail          # local http://127.0.0.1:3030/mcp
pnpm mcp:guerrillamail:tunnel   # https://appmcp.<your-subdomain>.ngrok.app/mcp
```

In MCPJam, connect to **`https://appmcp.<your-subdomain>.ngrok.app/mcp`** (tunnel)
or `http://127.0.0.1:3030/mcp` (local-only). Discovery documents still use
`MCP_PUBLIC_BASE_URL`, so local-only still requires that origin to match
whatever the client will fetch. `tools/call` needs
`Authorization: Bearer <JWT>`; the engine takes `customer_ref` from `sub`.

| Variable                  | Required     | Notes                                          |
| ------------------------- | ------------ | ---------------------------------------------- |
| `SOLVAPAY_SECRET_KEY`     | yes for HTTP | Sandbox secret                                 |
| `SOLVAPAY_PRODUCT`        | yes for HTTP | `prd_*` billed per tool call                   |
| `MCP_PUBLIC_BASE_URL`     | yes for HTTP | Required; your reserved ngrok origin           |
| `SOLVAPAY_API_BASE_URL`   | no           | Local stack: `http://localhost:3010`           |
| `MCP_HOST` / `MCP_PORT`   | no           | Default `127.0.0.1` / `3030`                   |
| `MCP_SOURCE`              | no           | `live` or `fixture`                            |
| `GUERRILLAMAIL_NGROK_URL` | no           | Same reserved origin as the other MCP examples |

## Tests

```bash
cargo test --manifest-path examples/rust/guerrillamail-mcp/Cargo.toml
```

CI never calls guerrillamail.com. `LiveSource` tests use wiremock.
