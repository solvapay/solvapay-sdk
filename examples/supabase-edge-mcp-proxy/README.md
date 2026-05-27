# `@example/supabase-edge-mcp-proxy`

Cloudflare Worker proxy that fronts the [`supabase-edge-mcp`](../supabase-edge-mcp)
example on a **root URL** (no path). Exists because Supabase's
`/functions/v1/<name>/…` URL structure is incompatible with
[RFC 9728 "OAuth 2.0 Protected Resource Metadata"](https://datatracker.ietf.org/doc/html/rfc9728)
when the MCP server's resource URL has a path component — MCPJam, MCP
Inspector, and ChatGPT's connector construct metadata URLs strictly per
RFC 9728 (`.well-known/<type>` inserted between host and resource path).

The Worker remaps:

```
https://<your-worker-host>/*
  → https://<proj>.supabase.co/functions/v1/mcp/*
```

so `https://<your-worker-host>/.well-known/oauth-protected-resource`
hits the Supabase function's handler. Set the function's
`MCP_PUBLIC_BASE_URL` secret to the Worker host (no path) so OAuth
metadata uses the right issuer.

## Deploy (personal Cloudflare account)

You do **not** need the SolvaPay org account or `mcp-goldberg.solvapay.com`.
Use your own Cloudflare login and a `*.workers.dev` URL (or a domain you
control).

```bash
cd examples/supabase-edge-mcp-proxy
pnpm install

# 1. Log in to YOUR Cloudflare account.
pnpm exec wrangler login
pnpm exec wrangler whoami

# 2. Set the required env vars (Wrangler reads these from your shell or a
#    `.dev.vars` file in this directory):
export SUPABASE_PROJECT_REF=<your-project-ref>
export CLOUDFLARE_ACCOUNT_ID=<your-cloudflare-account-id>

# 3. One-time: register a workers.dev subdomain if prompted
#    https://dash.cloudflare.com/<your-account-id>/workers/onboarding

# 4. Deploy (no custom domain — uses workers.dev)
pnpm deploy
# → https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
```

Do **not** add a `solvapay.com` route unless you are deploying inside the SolvaPay org.

After deploy, point the Supabase function at the Worker URL:

```bash
cd ../supabase-edge-mcp
supabase secrets set MCP_PUBLIC_BASE_URL=https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
pnpm deploy   # redeploy so OAuth metadata reflects the new issuer
```

Verify:

```bash
WORKER=https://supabase-edge-mcp-proxy.<your-subdomain>.workers.dev
curl -s "$WORKER/.well-known/oauth-protected-resource" | jq .
curl -s "$WORKER/.well-known/oauth-authorization-server" | jq .
```

Both should return 200 with the Worker URL as `resource` / `issuer`.

Use that Worker URL in MCPJam — not the raw
`https://<proj>.supabase.co/functions/v1/mcp` URL.

## Optional — SolvaPay internal (`mcp-goldberg.solvapay.com`)

SolvaPay org deploys only. Requires the SolvaPay Cloudflare account and
DNS on `solvapay.com`. Set the org account ID and add the route to `wrangler.jsonc`:

```bash
export CLOUDFLARE_ACCOUNT_ID=<solvapay-org-account-id>
```

```jsonc
"routes": [{ "pattern": "mcp-goldberg.solvapay.com", "custom_domain": true }]
```

Then `MCP_PUBLIC_BASE_URL=https://mcp-goldberg.solvapay.com`.

## Non-goals

- No auth enforcement in the Worker — that's the Supabase function's job.
- No caching — every request round-trips to Supabase.
- No body rewriting. The function emits URLs from `MCP_PUBLIC_BASE_URL`.
