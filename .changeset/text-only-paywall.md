---
'@solvapay/mcp-core': minor
'@solvapay/mcp': minor
'@solvapay/react': minor
'@solvapay/server': minor
---

**Text-only paywall / nudge — widget iframe reserved for deliberate
intent-tool calls.**

Paywall, low-balance nudge, and activation-required responses from
merchant `registerPayable` tools are now plain text narrations
instead of widget surfaces. `content[0].text` names the recovery
intent tool (`upgrade` / `topup` / `activate_plan`) and inlines
`gate.checkoutUrl` for terminal-first hosts. `isError` stays `false`
and `structuredContent = gate` for programmatic consumers. The
SolvaPay widget iframe now only opens when the user (or LLM)
deliberately invokes one of the three SolvaPay intent tools —
`upgrade`, `manage_account`, `topup` — where the UX genuinely is the
iframe.

Why: descriptor-advertising `_meta.ui.resourceUri` means the host
MUST open the iframe on every call per SEP-1865 / MCP Apps
(2026-01-26). Stamping it on payable data tools made silent
successes flash an empty widget next to every `predict_direction` /
`search_knowledge` result — the original "MCP App: ui://…" empty box
complaint.

**Breaking changes:**

- `@solvapay/server` — gate `message` copy changed. `classifyPaywallState` +
  `buildGateMessage` (new, exported) now produce the narration; the
  previous "Pick a plan below to keep going" text is gone. Client code
  that asserted substrings on `gate.message` needs to update. The
  structured gate shape (`kind`, `checkoutUrl`, `plans`, `balance`,
  `productDetails`) is unchanged.
- `@solvapay/mcp` — `registerPayableTool` no longer accepts or honours
  the `resourceUri` option. One-line fix for direct callers: delete
  the `resourceUri` argument. The convenience
  `registerPayable({...})` binding inside
  `createSolvaPayMcpServer({ additionalTools })` already strips it
  transparently.
- `@solvapay/mcp-core` — `BuildPayableHandlerContext.resourceUri`
  removed. `SolvaPayMcpPaywallContent` removed. `SolvaPayMcpViewKind`
  narrowed to `'checkout' | 'account' | 'topup'`. `BootstrapPayload`
  loses the `paywall` / `nudge` / `data` fields.
  `buildPaywallUiMeta`, `PaywallUiMeta`, and `PaywallUiMetaInput`
  (previously deprecated) are removed outright.
- `@solvapay/react` — `McpPaywallView`, `McpNudgeView`, and
  `McpUpsellStrip` (plus their prop types) removed from the public
  surface along with the matching `McpAppViewOverrides` slots.
  `McpBootstrap` loses the `paywall` / `nudge` / `data` fields;
  `McpViewKind` narrows to the three remaining surfaces;
  `HostEntryClassification` collapses to `'intent' | 'other'`.

**Migration:**

Merchant handlers that previously returned
`ctx.respond(data, { nudge })` don't need to change — nudges are now
appended to `content[0].text` as a plain-text suffix automatically.
If you were importing the removed React views (`McpPaywallView` /
`McpNudgeView` / `McpUpsellStrip`) you can drop those imports
entirely; the paywall is now narrated in text and no widget mounts
for it.
