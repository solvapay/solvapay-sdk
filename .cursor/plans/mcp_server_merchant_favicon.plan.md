---
name: MCP server merchant favicon
overview: Serve a merchant-branded favicon at the MCP server root so Claude's connector UI (and any other crawler going through Google's t3.gstatic.com favicon proxy) stops rendering a generic placeholder and instead shows the provider's uploaded mark. Requires both a server-side serving path and confirming the merchant icon upload flow covers favicon-appropriate assets (32x32 / 48x48 / SVG).
todos:
  - id: serving-path
    content: Add a `/favicon.ico` route to the MCP server entry (starting with examples/mcp-checkout-app/src/index.ts) that redirects to the cached merchant iconUrl with long Cache-Control, or serves 204 No Content when branding hasn't resolved yet. Consider whether this belongs in the SDK (createMcpOAuthBridge or a new favicon middleware) so every MCP server using the SDK gets it for free.
    status: pending
  - id: upload-surface
    content: Audit the merchant asset upload flow. iconUrl today is set via the provider-branding dashboard, but the spec it satisfies (square, ≥48x48, preferably PNG/SVG) isn't enforced. Decide whether to a) reuse iconUrl as the favicon source with no upload changes, b) add a dedicated favicon asset slot with explicit size/format constraints, or c) auto-derive favicon from iconUrl via server-side resize.
    status: pending
  - id: sdk-csp
    content: If favicon is served from the MCP server origin, confirm nothing breaks under the CSP envelope mergeCsp emits. If redirected to api-dev.solvapay.com/v1/ui/files/public/provider-assets/..., confirm that origin is already in the resourceDomains set (it is, via apiBaseUrl — but double-check the favicon path specifically since it's fetched by a third-party proxy).
    status: pending
  - id: smoke
    content: Verify on Claude.ai — after connecting the MCP server, the Connectors list entry shows the merchant's branded favicon instead of the generic placeholder (may take a few minutes for Google's favicon proxy to re-probe). Verify favicon also appears in dev tools / tab icon for direct MCP server URL visits.
    status: pending
isProject: false
---

# MCP server merchant favicon

## Symptom

Claude's Settings → Connectors page lists each connected MCP server with a favicon fetched via Google's favicon proxy:

```
GET https://t3.gstatic.com/faviconV2?client=SOCIAL&type=FAVICON
  &fallback_opts=TYPE,SIZE,URL&url=http://tommy-local.ngrok.app&size=48
  → 404 Not Found
```

The proxy probes `https://<mcp-server>/favicon.ico` and parses the HTML for `<link rel="icon">`; neither exists on our example MCP server, so every deployment shows a generic grey placeholder in Claude's connector list next to the merchant's real name. Several other ngrok / Supabase URLs in the same screenshot fail identically — this is the industry-wide "no favicon = no branding" behaviour.

The widget inside the iframe already gets a merchant icon rendered by `<AppHeader>` (via `bootstrap.merchant.iconUrl`), but that lives inside Claude's iframe and doesn't reach the Connectors chrome.

## Scope

1. **Serving path**. The MCP server must answer `/favicon.ico` with either the merchant's icon bytes, a 302 redirect to the hosted asset URL, or a bundled fallback. Today [`examples/mcp-checkout-app/src/index.ts`](examples/mcp-checkout-app/src/index.ts) has no such route — the request falls through `createMcpOAuthBridge` middleware and lands in a catch-all 404. A quick fix is a one-off `app.get('/favicon.ico', …)` in that example; the better fix is to teach `@solvapay/mcp/express` (or a new middleware helper) to surface the cached branding.

2. **Upload surface**. `merchant.iconUrl` today is set via the provider-branding dashboard and returned by `GET /v1/sdk/merchant`. It's advertised as "square app icon / logomark" in the SDK's [`Merchant` type](packages/react/src/types/index.ts:95-100) but no size / mime enforcement happens at upload. If we reuse `iconUrl` as the favicon source the most common landscape-logo upload will render cropped or letterboxed in Claude's 48×48 chip. Decide:
   - Reuse `iconUrl` as-is. Cheapest; potentially ugly on servers that uploaded a wide logo.
   - Add a dedicated `favicon` asset slot with explicit constraints (32×32 / 48×48, PNG/ICO/SVG). Cleanest; requires dashboard + API work.
   - Auto-derive at serve time: server-side resize `iconUrl` on first request per deployment, cache the result. Middle ground; needs image pipeline.

3. **CSP / proxy reachability**. Google's favicon proxy ignores our iframe CSP (it fetches server-to-server), but if we 302 redirect to `api-dev.solvapay.com/v1/ui/files/public/provider-assets/…/icons/…` we want to be sure that URL is `cache: public` and doesn't require auth — otherwise the proxy stores our 401 and never re-probes. Spot-check against an existing deployment's asset URL.

## Out of scope (explicit)

- The current unrelated `<link rel="preload" as="image">` warning in the widget. That's tracked separately — it's internal to the widget iframe and Claude's connector chrome can't see it.
- Favicon fetch-path caching inside Claude. We can't influence Claude's cache TTL; we only control our own `Cache-Control` headers.
- OpenGraph / Twitter-card meta tags for the MCP server. Those are a separate SEO concern and Claude doesn't read them.

## Proposed sequencing

1. Land a one-file experimental fix in `mcp-checkout-app` that 302-redirects to `cachedBranding.iconUrl` (or returns 204 pre-branding). Confirm Claude's UI picks it up after Google's proxy re-probes.
2. If the 302-redirect approach holds, lift it into `@solvapay/mcp/express` as a `createFaviconMiddleware` so every SDK consumer gets it for free. Requires plumbing the branding cache through to the middleware.
3. In parallel, decide on the upload constraints. Do nothing if `iconUrl` is good enough; otherwise spec the dedicated favicon slot and split into its own branch on the backend side.

## Tests

Defer until approach is picked. If we land middleware:

- Middleware returns 302 with `Cache-Control: public, max-age=86400, immutable` when branding has an `iconUrl`.
- Returns 204 No Content when branding isn't yet resolved.
- Handles `/favicon.ico` case-insensitively if needed (some proxies request `/favicon.ICO`).
