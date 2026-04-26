---
name: Fix McpApp icon preload warning
overview: Drop the "preloaded but not used" console warning on Claude by gating `McpApp`'s `<link rel="preload" as="image">` on the same condition `AppHeader` uses to mount — so we don't preload an image no `<img>` will ever consume.
todos:
  - id: gate-preload
    content: "In McpApp.tsx icon effect: import HOSTS_WITH_MERCHANT_CHROME, compute willRenderAppHeader from hostName, only insert the <link rel=\"preload\" as=\"image\"> when true, remove any stale managed preload tag otherwise, add hostName to deps"
    status: pending
  - id: test
    content: Add McpApp test asserting the preload tag is present for non-chrome hosts, absent for ChatGPT/Claude, and self-heals when hostName arrives late
    status: pending
  - id: changeset
    content: Add @solvapay/react patch changeset describing the host-aware preload skip
    status: pending
  - id: smoke
    content: Verify on Claude.ai (no warning) and MCPJam (still warm-cached, no initials flash)
    status: pending
isProject: false
---

# Fix McpApp merchant-icon preload warning on host-chrome hosts

## Symptom

Claude DevTools console, near every tool invocation:

```
The resource https://api-dev.solvapay.com/v1/ui/files/public/provider-assets/…/icons/…
was preloaded using link preload but not used within a few seconds from the window's load event.
Please make sure it has an appropriate `as` value and it is preloaded intentionally.
```

## Root cause

Two asymmetrically-gated pieces of wiring for the same asset:

- [`McpApp.tsx:393-402`](solvapay-sdk/packages/react/src/mcp/McpApp.tsx) unconditionally inserts `<link rel="preload" as="image" href={iconUrl}>` whenever `bootstrap.merchant.iconUrl` is set.
- [`AppHeader.tsx:191-194`](solvapay-sdk/packages/react/src/mcp/views/AppHeader.tsx) returns `null` when the host paints its own merchant chrome, matched by `HOSTS_WITH_MERCHANT_CHROME = /chatgpt|openai|claude/i` ([`AppHeader.tsx:54`](solvapay-sdk/packages/react/src/mcp/views/AppHeader.tsx)).

On Claude/ChatGPT/OpenAI, the preload is inserted but no `<img src={iconUrl}>` ever mounts to consume it → browser warns after a few seconds. (`as: 'image'` is already correct; the warning is strictly about non-consumption.)

The sibling `<link rel="icon">` at [`McpApp.tsx:381-385`](solvapay-sdk/packages/react/src/mcp/McpApp.tsx) is fine — browsers silently accept unused favicons, and some hosts still pick it up for their chrome strip.

## Fix (one file)

Gate the `<link rel="preload">` insertion on the same condition `AppHeader` uses to mount, and self-heal if `hostName` arrives after `iconUrl`.

In [`packages/react/src/mcp/McpApp.tsx`](solvapay-sdk/packages/react/src/mcp/McpApp.tsx):

1. Import `HOSTS_WITH_MERCHANT_CHROME` from `./views/AppHeader` (already exported via [`mcp/index.ts:101`](solvapay-sdk/packages/react/src/mcp/index.ts), so no new surface).
2. In the icon effect (lines 374-409):
   - Compute `const willRenderAppHeader = !hostName || !HOSTS_WITH_MERCHANT_CHROME.test(hostName)` — matches the render-time check that allows null hostName to render the header as a safe fallback.
   - Keep the `<link rel="icon">` insertion unconditional.
   - Insert the `<link rel="preload" as="image">` **only when `willRenderAppHeader`**.
   - When `!willRenderAppHeader`, remove any pre-existing managed preload tag (`data-solvapay-icon-preload`). Handles the handshake-after-bootstrap race where hostName arrives as `"Claude Desktop"` after we already inserted the preload.
3. Add `hostName` to the effect's dependency array so a late-arriving hostName re-runs the effect and cleans up.

That's the entire change — ~8 lines net, no new abstractions, no view-level edits, no context changes.

## Tests

Add a small test next to the existing `McpApp` tests (same file discovery as [`views/__tests__/AppHeader.test.tsx`](solvapay-sdk/packages/react/src/mcp/views/__tests__/AppHeader.test.tsx)) — or colocate in a new `McpApp.test.tsx` if none exists. Assert against `document.head`:

- Render `<McpApp>` with mocked bootstrap (iconUrl set) and `hostName="MCP Jam"` → `head` contains both `link[data-solvapay-favicon]` and `link[data-solvapay-icon-preload]`.
- Same with `hostName="Claude Desktop"` → `head` contains only `link[data-solvapay-favicon]`; no preload.
- Start with `hostName=null`, preload gets inserted; flip to `"Claude Desktop"` → preload removed on re-run.
- Start with `hostName="Claude Desktop"`, no preload; flip to `"MCP Jam"` → preload inserted.

(If wiring a full `McpApp` test rig is heavy, factor the icon-effect body into a tiny pure helper and unit-test that instead. Keep the fix itself inline either way.)

## Changeset

`@solvapay/react` patch: "Stop preloading the merchant icon on hosts that paint their own merchant chrome (ChatGPT / OpenAI / Claude) so those hosts no longer log a `preloaded but not used` console warning. The `<link rel=\"icon\">` favicon stays in place."

## Verification

1. `pnpm -F @solvapay/react test`
2. Run `examples/cloudflare-workers-mcp` and invoke a tool on:
   - **Claude.ai** → no `preloaded but not used` warning in console.
   - **MCPJam** → merchant icon in `AppHeader` still warm-cached (no initials flash on first paint); `head` still contains the preload tag.

## Out of scope

- The parallel Stripe CSP fix ([`claude_payment_form_csp_fix_e08bf43f.plan.md`](/.cursor/plans/claude_payment_form_csp_fix_e08bf43f.plan.md)) — ship independently.
- Changing what the `/v1/ui/files/public/provider-assets/…` endpoint serves — orthogonal.
- Using `fetchpriority="high"` on `<img>` instead of `<link rel="preload">` — weaker browser support and doesn't solve the problem on hosts where the `<img>` never mounts.