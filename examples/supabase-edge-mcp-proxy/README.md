# `@example/supabase-edge-mcp-proxy`

Cloudflare Worker proxy that fronts the [`supabase-edge-mcp`](../supabase-edge-mcp)
example on a custom subdomain (`mcp-goldberg.solvapay.com`). Exists
because Supabase's `/functions/v1/<name>/…` URL structure is
incompatible with [RFC 9728 "OAuth 2.0 Protected Resource Metadata"](https://datatracker.ietf.org/doc/html/rfc9728)
when the MCP server's resource URL has a path component — and both MCP
Inspector and ChatGPT's connector construct metadata URLs strictly per
RFC 9728 (`.well-known/<type>` inserted between host and resource
path).

The Worker remaps:

```
https://mcp-goldberg.solvapay.com/*
  → https://<proj>.supabase.co/functions/v1/mcp/*
```

so `https://mcp-goldberg.solvapay.com/.well-known/oauth-protected-resource`
hits the Supabase function's handler for that path. The SDK
(`@solvapay/mcp-fetch`) emits the right discovery URLs automatically
because the function's `MCP_PUBLIC_BASE_URL` secret is set to the
Worker's subdomain (no path).

## Deploy

```bash
cd examples/supabase-edge-mcp-proxy
pnpm install
pnpm exec wrangler login       # one-time browser OAuth with Cloudflare
pnpm deploy                    # = wrangler deploy
```

`wrangler deploy` creates:

1. The Worker `supabase-edge-mcp-proxy` under the account.
2. A custom-domain route binding `mcp-goldberg.solvapay.com` to the
   Worker (Cloudflare adds the DNS record automatically because
   `solvapay.com` is on Cloudflare DNS — verified via `dig +short
   solvapay.com NS` → `galilea.ns.cloudflare.com.`).

After deploy, update the Supabase function secret:

```bash
cd ../supabase-edge-mcp
supabase secrets set MCP_PUBLIC_BASE_URL=https://mcp-goldberg.solvapay.com
pnpm deploy   # redeploy so the OAuth metadata reflects the new URL
```

Verify:

```bash
curl -s https://mcp-goldberg.solvapay.com/.well-known/oauth-protected-resource | jq .
curl -s https://mcp-goldberg.solvapay.com/.well-known/oauth-authorization-server | jq .
```

Both should return 200 with the metadata pointing at
`https://mcp-goldberg.solvapay.com` as issuer / resource.

## Non-goals

- No auth enforcement in the Worker — that's the Supabase function's
  job.
- No caching — every request round-trips to Supabase. Fine for a demo
  and keeps bugs easier to chase; add `fetch`'s built-in cache for the
  well-known responses if load becomes a concern.
- No body rewriting. The function already emits URLs using the
  public-base-URL it was configured with, so nothing needs patching on
  the way back.
