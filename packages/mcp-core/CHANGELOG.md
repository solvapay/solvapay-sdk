# @solvapay/mcp-core changelog

## 0.2.5

### Patch Changes

- 254498f: Preserve OAuth resource metadata in bearer auth by exposing `extra.resource`, instead of inferring MCP client identity from resource-only `aud` claims.

## 0.2.4

### Patch Changes

- 36ac2ad: `hideToolsByAudience` on `createSolvaPayMcpServer` and `createSolvaPayMcpFetch` is now ChatGPT-aware. The audience filter still trims `tools/list` for text-only hosts (Claude Desktop, MCPJam, Cursor) so the LLM only sees the four intent tools — `upgrade`, `manage_account`, `activate_plan`, `topup` — alongside your own merchant-registered data tools, but it now **automatically returns the full eleven-tool catalog to ChatGPT**. Without this, ChatGPT's Custom Connector gateway re-validates iframe-initiated `tools/call` against the cached `tools/list` and rejects any hidden tool with `MCP error -32000: MCP Resource not found`, breaking the embedded SolvaPay iframe.

  The auto-detection runs against `request.headers['user-agent']` and the post-`initialize` `clientInfo.name`, both matched against `/openai-mcp/i`. Verified live against `openai-mcp/1.0.0 (ChatGPT)` on goldberg-demo (probe 2026-05-04). The pattern is liberal enough to survive a UA bump to `openai-mcp/2.x` without code changes.

  Pass the new object form to extend or override the bypass:

  ```ts
  hideToolsByAudience: {
    audiences: ['ui'],
    bypassWhen: ctx => /openai-mcp|future-iframe-host/i.test(
      ctx.extra?.requestInfo?.headers?.['user-agent'] ?? '',
    ),
  }
  ```

  Or pass `bypassWhen: () => false` to apply the filter unconditionally on a known text-only deployment.

  The array shorthand (`hideToolsByAudience: ['ui']`) keeps working — it's just shorthand for `{ audiences: ['ui'] }` and gets the default ChatGPT-aware bypass for free. No migration needed for existing integrators.

  New exports from `@solvapay/mcp-core`: `defaultIsChatGptRequest`, `ApplyHideToolsByAudienceContext`, `ApplyHideToolsByAudienceOptions`, `HideToolsByAudienceBypass`. New export from `@solvapay/mcp`: `HideToolsByAudienceConfig`.

  > **Note on semver level**: this change adds public API surface, which by strict semver would warrant a `minor` bump on these pre-1.0 packages. It's released as `patch` because a minor bump on a 0.x package puts the `workspace:*` reference held by dependents (`@solvapay/react`, `@solvapay/react-supabase`, etc.) "out of range" of `^0.2.x`, which the changesets cascade then promotes to a _major_ bump on every dependent — accidentally publishing `@solvapay/react@2.0.0` and similar majors despite no breaking changes. Once the SDK adopts a different inter-package versioning strategy (e.g. `linked` or `workspace:^`), the next `hideToolsByAudience`-style API addition can ship at the proper `minor` level.

- 9c66d68: Stamp a fresh `_meta["openai/widgetSessionId"]` UUID on every intent-tool response (`topup`, `upgrade`, `manage_account`, plus the `activate_plan` picker bootstrap). This is a forward-looking workaround for a separate ChatGPT MCP connector bug where the host returns `-32000 MCP Resource not found` on the second `tools/call` of a session even though the call never reaches the server. Stamping a UUID per invocation gives the host a routing key that changes every call, which the [OpenAI Apps SDK community thread](https://community.openai.com/t/connector-tool-calls-generating-fresh-mcp-session-each-invocation/1364975) reports unsticks the failure mode.

  Matches the shape used by [`openai/openai-apps-sdk-examples`'s `shopping_cart_python`](https://github.com/openai/openai-apps-sdk-examples) server. Safe on any host that doesn't consume the key. Removable once the upstream bug ships a fix.

## 0.2.3

### Patch Changes

- Updated dependencies [40db2c4]
  - @solvapay/core@1.0.9

## 0.2.2

### Patch Changes

- 4b3de6a: Resync stable manifests so dependents pin to stable `@solvapay/core` and `@solvapay/auth` instead of the leftover `1.0.8-preview.10` references that the previous release accidentally baked into `@solvapay/server@1.0.9`, `@solvapay/next@1.0.8`, `@solvapay/mcp-core@0.2.1`, and `@solvapay/mcp@0.2.1`.

  The root cause was that `core`, `auth`, `solvapay` (CLI), and `react-supabase` had pre-release `1.0.8-preview.X` strings sitting in their `package.json` `version` fields on `main` (leftovers from the pre-changesets preview workflow that the migration commit never reset). Because no changeset had touched those four since the migration, changesets-action never bumped them, and `pnpm publish` substituted every `workspace:*` reference in the recently-released siblings with that literal preview string.

  This changeset:
  - Resets `core`, `auth`, `solvapay`, and `react-supabase` to the last actually-published stable (`1.0.7`) so the patch bumps below land on `1.0.8`.
  - Forces a patch bump on `server`, `next`, `mcp-core`, and `mcp` so they re-publish with their workspace dep references substituted from the now-stable `1.0.8` siblings.

  The publish workflow has also been hardened to reject any workspace package that carries a pre-release version identifier on `main` before invoking `changesets/action`, and `scripts/verify-npm-publishes.mjs` now checks each freshly-published manifest for `dependencies` / `peerDependencies` values that resolve to pre-release identifiers — both of which would have caught this regression.

- Updated dependencies [4b3de6a]
  - @solvapay/core@1.0.8

## 0.2.1

### Patch Changes

- 7f33787: `buildSolvaPayDescriptors` accepts a new optional `apiBaseUrl` that is
  auto-appended to the resolved CSP's `resourceDomains` + `connectDomains`.
  Integrators who used to hand-extend `csp` to get merchant branding
  images rendering from their SolvaPay API origin can now drop the
  override entirely — pass the same value they pass to
  `createSolvaPay({ apiBaseUrl })` and the widget iframe's CSP envelope
  includes it automatically.

  `mergeCsp` grows the same optional second parameter. The origin is
  normalised via `new URL(apiBaseUrl).origin`, so trailing slashes /
  paths are stripped before insertion, and duplicates against
  integrator-supplied overrides are deduped through the existing `Set`
  merge.

  When `apiBaseUrl` is omitted the behaviour is unchanged — the Stripe
  baseline + integrator `csp` override still compose exactly as they did
  in `0.2.0`.

  See Phase 2a of `.cursor/plans/preview_iteration_+_promote_roadmap_88a4eaa0.plan.md`
  for the original footgun this closes (merchant logos blocked by CSP in
  the Goldberg smoke).

From `1.0.9` onwards this changelog is generated by
[changesets](https://github.com/changesets/changesets) — entries below
the inaugural release are maintained by hand.

## 0.2.1

### Added: `apiBaseUrl` auto-includes the SolvaPay API origin in CSP

`buildSolvaPayDescriptors` and `mergeCsp` accept a new optional
`apiBaseUrl`. When provided, the origin is appended to the resolved
CSP's `resourceDomains` + `connectDomains` so the widget iframe can
load merchant branding images (`GET /v1/files/public/provider-assets/...`)
and make XHR / fetch calls back to the SolvaPay API without the
integrator hand-extending `csp.resourceDomains`.

Pass the same `apiBaseUrl` value you pass to
`createSolvaPay({ apiBaseUrl })`. Origins are normalised via
`new URL(apiBaseUrl).origin` so trailing slashes and paths are
stripped, and duplicates against integrator-supplied overrides are
deduped through the existing `Set` merge.

When `apiBaseUrl` is omitted the behaviour is unchanged: the Stripe
baseline + integrator `csp` override still compose exactly as they
did in `0.2.0`.

Surfaced during the Goldberg `mcp-goldberg.solvapay.com` smoke, where
merchant logos served from `https://api-dev.solvapay.com/...` were
CSP-blocked inside the widget iframe. Integrators on that pattern can
now drop their `csp: { resourceDomains: [apiBaseUrl], connectDomains: [apiBaseUrl] }`
stopgap.

## 0.2.0

Two behaviour additions + one public-surface trim — released together
as a 0.x minor. Hand-set version (bypasses the Changesets peer-dep
cascade that would otherwise force `mcp-core` to `1.0.0` when
`@solvapay/server` bumps `1.0.7 → 1.0.8`). See
`.changeset/hand-set-versions-consolidation.md` for the full rationale.

### Added: `applyHideToolsByAudience` (shared helper for parallel adapters)

New exported helper — `applyHideToolsByAudience(server, audiences?)` —
that wraps the server's `tools/list` handler so any tool whose
`_meta.audience` matches one of the supplied values is dropped from
the response. The tools stay `enabled: true` so `tools/call` still
reaches their handlers; the helper only affects the `tools/list`
shape. Consumed by `@solvapay/mcp` (root + `./fetch`) so both parallel
adapters can apply the same filter without reimplementing the
`_requestHandlers` reach-in. See the matching
`CreateSolvaPayMcpServerOptions.hideToolsByAudience` on
`@solvapay/mcp@0.2.0` for the integrator-facing surface.

### Removed (breaking): text-only paywall surface

Per SEP-1865 / MCP Apps (2026-01-26) descriptor-advertising means the
host MUST open the iframe on every call. Stamping
`_meta.ui.resourceUri` on merchant payable data tools made silent
successes flash an empty widget next to every
`predict_direction` / `search_knowledge` result — the original "MCP
App: ui://…" empty box complaint. Paywall / nudge / activation
responses are now plain text narrations instead; the widget iframe
only opens when the user (or LLM) deliberately invokes one of the
three intent tools (`upgrade` / `manage_account` / `topup`) whose UX
genuinely is the iframe.

Removed public types / helpers:

- `BuildPayableHandlerContext.resourceUri` field.
- `SolvaPayMcpPaywallContent` type alias.
- `buildPaywallUiMeta` helper + `PaywallUiMeta`, `PaywallUiMetaInput`
  types (previously deprecated).
- `SolvaPayMcpViewKind` narrowed to `'checkout' | 'account' | 'topup'`
  — the `'paywall'` and `'nudge'` variants are gone.
- `BootstrapPayload` no longer carries the `paywall`, `nudge`, or
  `data` fields.

Migration: if you were constructing `BuildPayableHandlerContext`
manually, drop the `resourceUri` field. If you were reading
`paywall` / `nudge` / `data` off `BootstrapPayload`, the narration is
now on `content[0].text` via the `@solvapay/server` gate helpers
(`classifyPaywallState` + new `buildGateMessage`).

## 0.1.0

Inaugural release. Framework-neutral MCP contracts for the SolvaPay SDK:

- `MCP_TOOL_NAMES` + `buildSolvaPayDescriptors` — the canonical tool
  name map + schema-only descriptor builder consumed by every adapter
  (`@modelcontextprotocol/sdk`, `fastmcp`, raw JSON-RPC).
- `buildPayableHandler` — the runtime-agnostic payable wrapper that
  projects `@solvapay/server`'s paywall decision into an
  `{ isError, content }` envelope plus `_meta['solvapay.com/paywall']`.
- OAuth discovery JSON builders — `getOAuthProtectedResourceResponse`
  / `getOAuthAuthorizationServerResponse` return plain JSON; the Node
  and fetch OAuth bridges (`@solvapay/mcp-express`, `@solvapay/mcp-fetch`)
  own the HTTP framing.
- Bearer + JWT helpers — `getCustomerRefFromBearerAuthHeader`,
  `McpBearerAuthError`, `decodeJwtPayload` — the canonical shape every
  adapter uses to convert a `Authorization: Bearer …` header into a
  `customerRef`.
- Paywall meta, CSP, bootstrap payload types — the cross-boundary
  shapes `@solvapay/react`, `@solvapay/mcp`, and the fetch/express
  bridges all agree on.

Zero runtime dependency on `@modelcontextprotocol/*`.

### Peer dependencies

`@solvapay/server` is a **required** peer. Every barrel re-export
(`descriptors`, `bootstrap-payload`, `payable-handler`,
`paywall-meta`, `response-context`, `paywallToolResult`) resolves
runtime values from `@solvapay/server` (the merchant API `*Core`
functions, `PaywallError`, `isPaywallStructuredContent`, …), so
listing it as an optional peer would crash any import at module
resolution time with `ERR_MODULE_NOT_FOUND`. The peer shape —
instead of a direct dependency — preserves singleton semantics
across the adapter family (one `PaywallError` constructor, one
`SolvaPay` client instance) when `@solvapay/mcp`, `mcp-express`,
`mcp-fetch`, and app-level code all share a single hoisted
`@solvapay/server` install.

### Rename history

`@solvapay/mcp-core` is the rename of the old `@solvapay/mcp` package
(which in this reshuffle now holds the official `@modelcontextprotocol/sdk`
adapter). The old `@solvapay/mcp` name was never published to npm —
this is a clean first publish, no migration shim. Integrators who
imported framework-neutral types from the old `@solvapay/mcp` should
switch to `@solvapay/mcp-core`:

```diff
- import { MCP_TOOL_NAMES, buildSolvaPayDescriptors } from '@solvapay/mcp'
+ import { MCP_TOOL_NAMES, buildSolvaPayDescriptors } from '@solvapay/mcp-core'
```
